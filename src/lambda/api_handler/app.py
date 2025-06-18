import json
import boto3
import logging
from datetime import datetime
import os
from typing import Dict, List, Optional
import uuid

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')
stepfunctions_client = boto3.client('stepfunctions')

# Environment variables
GAPS_TABLE_NAME = os.environ.get('GAPS_TABLE_NAME', 'CompliAgent-GapsTable')
AMENDMENTS_TABLE_NAME = os.environ.get('AMENDMENTS_TABLE_NAME', 'CompliAgent-AmendmentsTable')
GAP_ANALYSIS_STATE_MACHINE_ARN = os.environ.get('GAP_ANALYSIS_STATE_MACHINE_ARN')
AMENDMENT_DRAFTING_STATE_MACHINE_ARN = os.environ.get('AMENDMENT_DRAFTING_STATE_MACHINE_ARN')

class APIHandler:
    """Main API handler for CompliAgent-SG REST API"""
    
    def __init__(self):
        self.gaps_table = dynamodb.Table(GAPS_TABLE_NAME)
        self.amendments_table = dynamodb.Table(AMENDMENTS_TABLE_NAME)
    
    def handle_request(self, event: Dict) -> Dict:
        """Route and handle API requests"""
        try:
            # Extract request information
            http_method = event.get('httpMethod', '')
            path = event.get('path', '')
            path_parameters = event.get('pathParameters') or {}
            query_parameters = event.get('queryStringParameters') or {}
            body = event.get('body')
            
            # Parse body if present
            request_body = {}
            if body:
                try:
                    request_body = json.loads(body)
                except json.JSONDecodeError:
                    return self._error_response(400, "Invalid JSON in request body")
            
            logger.info(f"Processing {http_method} {path}")
            
            # Route to appropriate handler
            if path == '/gaps' and http_method == 'GET':
                return self._get_gaps(query_parameters)
            
            elif path.startswith('/gaps/') and path.endswith('/acknowledge') and http_method == 'POST':
                gap_id = path.split('/')[2]
                return self._acknowledge_gap(gap_id, request_body)
            
            elif path == '/amendments' and http_method == 'GET':
                return self._get_amendments(query_parameters)
            
            elif path.startswith('/amendments/') and path.endswith('/approve') and http_method == 'POST':
                amendment_id = path.split('/')[2]
                return self._approve_amendment(amendment_id, request_body)
            
            elif path == '/analysis/start' and http_method == 'POST':
                return self._start_gap_analysis(request_body)
            
            elif path == '/amendments/draft' and http_method == 'POST':
                return self._start_amendment_drafting(request_body)
            
            elif path == '/health' and http_method == 'GET':
                return self._health_check()
            
            else:
                return self._error_response(404, f"Endpoint not found: {http_method} {path}")
                
        except Exception as e:
            logger.error(f"Error handling request: {str(e)}")
            return self._error_response(500, "Internal server error")
    
    def _get_gaps(self, query_params: Dict) -> Dict:
        """Get gaps with optional filtering"""
        try:
            # Extract query parameters
            status = query_params.get('status')
            severity = query_params.get('severity')
            regulation_id = query_params.get('regulationId')
            limit = int(query_params.get('limit', 50))
            
            gaps = []
            
            if status:
                # Query by status using GSI
                response = self.gaps_table.query(
                    IndexName='statusIndex',
                    KeyConditionExpression='#status = :status',
                    ExpressionAttributeNames={'#status': 'status'},
                    ExpressionAttributeValues={':status': status},
                    Limit=limit,
                    ScanIndexForward=False
                )
                gaps = response.get('Items', [])
            
            elif regulation_id:
                # Query by regulation ID using GSI
                response = self.gaps_table.query(
                    IndexName='regulationIdIndex',
                    KeyConditionExpression='regulationId = :regulation_id',
                    ExpressionAttributeValues={':regulation_id': regulation_id},
                    Limit=limit,
                    ScanIndexForward=False
                )
                gaps = response.get('Items', [])
            
            else:
                # Scan all gaps (with optional severity filter)
                scan_kwargs = {'Limit': limit}
                
                if severity:
                    scan_kwargs['FilterExpression'] = 'severity = :severity'
                    scan_kwargs['ExpressionAttributeValues'] = {':severity': severity}
                
                response = self.gaps_table.scan(**scan_kwargs)
                gaps = response.get('Items', [])
            
            # Convert Decimal types to native Python types for JSON serialization
            gaps = self._convert_decimals(gaps)
            
            return self._success_response({
                'gaps': gaps,
                'total': len(gaps),
                'filters': {
                    'status': status,
                    'severity': severity,
                    'regulationId': regulation_id
                },
                'timestamp': datetime.utcnow().isoformat()
            })
            
        except Exception as e:
            logger.error(f"Error getting gaps: {str(e)}")
            return self._error_response(500, f"Error retrieving gaps: {str(e)}")
    
    def _acknowledge_gap(self, gap_id: str, request_body: Dict) -> Dict:
        """Acknowledge a gap"""
        try:
            acknowledged_by = request_body.get('acknowledgedBy', 'Unknown')
            notes = request_body.get('notes', '')
            
            # Update gap status
            response = self.gaps_table.update_item(
                Key={'gapId': gap_id},
                UpdateExpression='SET #status = :status, acknowledgedBy = :acknowledged_by, acknowledgedAt = :acknowledged_at, notes = :notes, updatedAt = :updated_at',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={
                    ':status': 'acknowledged',
                    ':acknowledged_by': acknowledged_by,
                    ':acknowledged_at': datetime.utcnow().isoformat(),
                    ':notes': notes,
                    ':updated_at': datetime.utcnow().isoformat()
                },
                ReturnValues='ALL_NEW'
            )
            
            updated_gap = self._convert_decimals(response['Attributes'])
            
            logger.info(f"Gap {gap_id} acknowledged by {acknowledged_by}")
            
            return self._success_response({
                'message': 'Gap acknowledged successfully',
                'gap': updated_gap,
                'timestamp': datetime.utcnow().isoformat()
            })
            
        except Exception as e:
            logger.error(f"Error acknowledging gap {gap_id}: {str(e)}")
            return self._error_response(500, f"Error acknowledging gap: {str(e)}")
    
    def _get_amendments(self, query_params: Dict) -> Dict:
        """Get amendments with optional filtering"""
        try:
            gap_id = query_params.get('gapId')
            status = query_params.get('status')
            limit = int(query_params.get('limit', 50))
            
            amendments = []
            
            if gap_id:
                # Query by gap ID using GSI
                response = self.amendments_table.query(
                    IndexName='gapIdIndex',
                    KeyConditionExpression='gapId = :gap_id',
                    ExpressionAttributeValues={':gap_id': gap_id},
                    Limit=limit,
                    ScanIndexForward=False
                )
                amendments = response.get('Items', [])
            
            elif status:
                # Query by status using GSI
                response = self.amendments_table.query(
                    IndexName='statusIndex',
                    KeyConditionExpression='#status = :status',
                    ExpressionAttributeNames={'#status': 'status'},
                    ExpressionAttributeValues={':status': status},
                    Limit=limit,
                    ScanIndexForward=False
                )
                amendments = response.get('Items', [])
            
            else:
                # Scan all amendments
                response = self.amendments_table.scan(Limit=limit)
                amendments = response.get('Items', [])
            
            # Convert Decimal types
            amendments = self._convert_decimals(amendments)
            
            return self._success_response({
                'amendments': amendments,
                'total': len(amendments),
                'filters': {
                    'gapId': gap_id,
                    'status': status
                },
                'timestamp': datetime.utcnow().isoformat()
            })
            
        except Exception as e:
            logger.error(f"Error getting amendments: {str(e)}")
            return self._error_response(500, f"Error retrieving amendments: {str(e)}")
    
    def _approve_amendment(self, amendment_id: str, request_body: Dict) -> Dict:
        """Approve an amendment"""
        try:
            approved_by = request_body.get('approvedBy', 'Unknown')
            approval_notes = request_body.get('approvalNotes', '')
            
            # Update amendment status
            response = self.amendments_table.update_item(
                Key={'amendmentId': amendment_id},
                UpdateExpression='SET #status = :status, approvedBy = :approved_by, approvedAt = :approved_at, approvalNotes = :approval_notes, updatedAt = :updated_at',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={
                    ':status': 'approved',
                    ':approved_by': approved_by,
                    ':approved_at': datetime.utcnow().isoformat(),
                    ':approval_notes': approval_notes,
                    ':updated_at': datetime.utcnow().isoformat()
                },
                ReturnValues='ALL_NEW'
            )
            
            updated_amendment = self._convert_decimals(response['Attributes'])
            
            logger.info(f"Amendment {amendment_id} approved by {approved_by}")
            
            return self._success_response({
                'message': 'Amendment approved successfully',
                'amendment': updated_amendment,
                'timestamp': datetime.utcnow().isoformat()
            })
            
        except Exception as e:
            logger.error(f"Error approving amendment {amendment_id}: {str(e)}")
            return self._error_response(500, f"Error approving amendment: {str(e)}")
    
    def _start_gap_analysis(self, request_body: Dict) -> Dict:
        """Start gap analysis workflow"""
        try:
            if not GAP_ANALYSIS_STATE_MACHINE_ARN:
                return self._error_response(500, "Gap analysis workflow not configured")
            
            # Prepare input for Step Functions
            workflow_input = {
                'query_text': request_body.get('queryText', ''),
                'search_type': request_body.get('searchType', 'hybrid'),
                'size': request_body.get('size', 10),
                'analysis_context': request_body.get('analysisContext', ''),
                'requestId': str(uuid.uuid4()),
                'timestamp': datetime.utcnow().isoformat()
            }
            
            # Start Step Functions execution
            response = stepfunctions_client.start_execution(
                stateMachineArn=GAP_ANALYSIS_STATE_MACHINE_ARN,
                name=f"gap-analysis-{int(datetime.utcnow().timestamp())}",
                input=json.dumps(workflow_input)
            )
            
            execution_arn = response['executionArn']
            
            logger.info(f"Started gap analysis workflow: {execution_arn}")
            
            return self._success_response({
                'message': 'Gap analysis started successfully',
                'executionArn': execution_arn,
                'requestId': workflow_input['requestId'],
                'timestamp': datetime.utcnow().isoformat()
            })
            
        except Exception as e:
            logger.error(f"Error starting gap analysis: {str(e)}")
            return self._error_response(500, f"Error starting gap analysis: {str(e)}")
    
    def _start_amendment_drafting(self, request_body: Dict) -> Dict:
        """Start amendment drafting workflow"""
        try:
            if not AMENDMENT_DRAFTING_STATE_MACHINE_ARN:
                return self._error_response(500, "Amendment drafting workflow not configured")
            
            gap_ids = request_body.get('gapIds', [])
            if not gap_ids:
                return self._error_response(400, "gapIds are required")
            
            # Prepare input for Step Functions
            workflow_input = {
                'operation': 'get_multiple',
                'gap_ids': gap_ids,
                'organization_context': request_body.get('organizationContext', ''),
                'requestId': str(uuid.uuid4()),
                'timestamp': datetime.utcnow().isoformat()
            }
            
            # Start Step Functions execution
            response = stepfunctions_client.start_execution(
                stateMachineArn=AMENDMENT_DRAFTING_STATE_MACHINE_ARN,
                name=f"amendment-drafting-{int(datetime.utcnow().timestamp())}",
                input=json.dumps(workflow_input)
            )
            
            execution_arn = response['executionArn']
            
            logger.info(f"Started amendment drafting workflow: {execution_arn}")
            
            return self._success_response({
                'message': 'Amendment drafting started successfully',
                'executionArn': execution_arn,
                'requestId': workflow_input['requestId'],
                'gapIds': gap_ids,
                'timestamp': datetime.utcnow().isoformat()
            })
            
        except Exception as e:
            logger.error(f"Error starting amendment drafting: {str(e)}")
            return self._error_response(500, f"Error starting amendment drafting: {str(e)}")
    
    def _health_check(self) -> Dict:
        """Health check endpoint"""
        return self._success_response({
            'status': 'healthy',
            'service': 'CompliAgent-SG API',
            'timestamp': datetime.utcnow().isoformat(),
            'version': '1.0.0'
        })
    
    def _convert_decimals(self, obj):
        """Convert DynamoDB Decimal types to native Python types"""
        if isinstance(obj, list):
            return [self._convert_decimals(item) for item in obj]
        elif isinstance(obj, dict):
            return {key: self._convert_decimals(value) for key, value in obj.items()}
        elif hasattr(obj, '__class__') and obj.__class__.__name__ == 'Decimal':
            if obj % 1 == 0:
                return int(obj)
            else:
                return float(obj)
        else:
            return obj
    
    def _success_response(self, data: Dict) -> Dict:
        """Create a successful API response"""
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
            },
            'body': json.dumps(data)
        }
    
    def _error_response(self, status_code: int, message: str) -> Dict:
        """Create an error API response"""
        return {
            'statusCode': status_code,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
            },
            'body': json.dumps({
                'error': message,
                'timestamp': datetime.utcnow().isoformat()
            })
        }

def lambda_handler(event, context):
    """Main Lambda handler for API requests"""
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Handle CORS preflight requests
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
                },
                'body': ''
            }
        
        # Initialize API handler and process request
        api_handler = APIHandler()
        response = api_handler.handle_request(event)
        
        logger.info(f"Response: {response['statusCode']}")
        return response
        
    except Exception as e:
        logger.error(f"Unhandled error in lambda_handler: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'timestamp': datetime.utcnow().isoformat()
            })
        }
