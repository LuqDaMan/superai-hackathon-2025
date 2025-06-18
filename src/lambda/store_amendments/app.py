import json
import boto3
import logging
from datetime import datetime
import os
from typing import Dict, List

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')

# Environment variables
AMENDMENTS_TABLE_NAME = os.environ.get('AMENDMENTS_TABLE_NAME', 'CompliAgent-AmendmentsTable')

class AmendmentStorageService:
    """Service for storing policy amendments in DynamoDB"""
    
    def __init__(self):
        self.amendments_table = dynamodb.Table(AMENDMENTS_TABLE_NAME)
    
    def store_amendments(self, amendments: List[Dict]) -> Dict:
        """Store multiple amendments in DynamoDB"""
        try:
            logger.info(f"Storing {len(amendments)} amendments in DynamoDB")
            
            stored_amendments = []
            failed_amendments = []
            
            for amendment in amendments:
                try:
                    # Prepare amendment data for DynamoDB
                    amendment_item = self._prepare_amendment_item(amendment)
                    
                    # Store in DynamoDB
                    self.amendments_table.put_item(Item=amendment_item)
                    stored_amendments.append(amendment_item['amendmentId'])
                    
                    logger.info(f"Stored amendment: {amendment_item['amendmentId']}")
                    
                except Exception as e:
                    logger.error(f"Failed to store amendment {amendment.get('amendment_id', 'unknown')}: {str(e)}")
                    failed_amendments.append({
                        'amendment_id': amendment.get('amendment_id', 'unknown'),
                        'error': str(e)
                    })
            
            result = {
                'total_amendments': len(amendments),
                'stored_successfully': len(stored_amendments),
                'failed_to_store': len(failed_amendments),
                'stored_amendment_ids': stored_amendments,
                'failed_amendments': failed_amendments
            }
            
            logger.info(f"Amendment storage completed: {len(stored_amendments)} stored, {len(failed_amendments)} failed")
            return result
            
        except Exception as e:
            logger.error(f"Error in amendment storage: {str(e)}")
            raise
    
    def store_single_amendment(self, amendment: Dict) -> Dict:
        """Store a single amendment in DynamoDB"""
        try:
            # Prepare amendment data for DynamoDB
            amendment_item = self._prepare_amendment_item(amendment)
            
            # Store in DynamoDB
            self.amendments_table.put_item(Item=amendment_item)
            
            logger.info(f"Stored single amendment: {amendment_item['amendmentId']}")
            
            return {
                'amendment_id': amendment_item['amendmentId'],
                'status': 'stored',
                'stored_at': amendment_item['storedAt']
            }
            
        except Exception as e:
            logger.error(f"Error storing single amendment: {str(e)}")
            raise
    
    def update_amendment_status(self, amendment_id: str, status: str, 
                              approved_by: str = None, 
                              approval_notes: str = None) -> Dict:
        """Update the status of an existing amendment"""
        try:
            update_expression = "SET #status = :status, updatedAt = :updated_at"
            expression_attribute_names = {"#status": "status"}
            expression_attribute_values = {
                ":status": status,
                ":updated_at": datetime.utcnow().isoformat()
            }
            
            if approved_by:
                update_expression += ", approvedBy = :approved_by"
                expression_attribute_values[":approved_by"] = approved_by
            
            if approval_notes:
                update_expression += ", approvalNotes = :approval_notes"
                expression_attribute_values[":approval_notes"] = approval_notes
            
            if status == 'approved':
                update_expression += ", approvedAt = :approved_at"
                expression_attribute_values[":approved_at"] = datetime.utcnow().isoformat()
            
            response = self.amendments_table.update_item(
                Key={'amendmentId': amendment_id},
                UpdateExpression=update_expression,
                ExpressionAttributeNames=expression_attribute_names,
                ExpressionAttributeValues=expression_attribute_values,
                ReturnValues='ALL_NEW'
            )
            
            logger.info(f"Updated amendment status: {amendment_id} -> {status}")
            return response['Attributes']
            
        except Exception as e:
            logger.error(f"Error updating amendment status: {str(e)}")
            raise
    
    def get_amendment(self, amendment_id: str) -> Dict:
        """Retrieve a specific amendment from DynamoDB"""
        try:
            response = self.amendments_table.get_item(Key={'amendmentId': amendment_id})
            
            if 'Item' in response:
                return response['Item']
            else:
                return None
                
        except Exception as e:
            logger.error(f"Error retrieving amendment {amendment_id}: {str(e)}")
            raise
    
    def query_amendments_by_gap(self, gap_id: str, limit: int = 50) -> List[Dict]:
        """Query amendments by gap ID"""
        try:
            response = self.amendments_table.query(
                IndexName='gapIdIndex',
                KeyConditionExpression='gapId = :gap_id',
                ExpressionAttributeValues={':gap_id': gap_id},
                Limit=limit,
                ScanIndexForward=False  # Most recent first
            )
            
            return response.get('Items', [])
            
        except Exception as e:
            logger.error(f"Error querying amendments by gap: {str(e)}")
            raise
    
    def query_amendments_by_status(self, status: str, limit: int = 50) -> List[Dict]:
        """Query amendments by status"""
        try:
            response = self.amendments_table.query(
                IndexName='statusIndex',
                KeyConditionExpression='#status = :status',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={':status': status},
                Limit=limit,
                ScanIndexForward=False  # Most recent first
            )
            
            return response.get('Items', [])
            
        except Exception as e:
            logger.error(f"Error querying amendments by status: {str(e)}")
            raise
    
    def get_amendments_for_review(self, limit: int = 20) -> List[Dict]:
        """Get amendments that are pending review"""
        try:
            return self.query_amendments_by_status('draft', limit)
            
        except Exception as e:
            logger.error(f"Error getting amendments for review: {str(e)}")
            raise
    
    def _prepare_amendment_item(self, amendment: Dict) -> Dict:
        """Prepare amendment data for DynamoDB storage"""
        try:
            amendment_item = {
                'amendmentId': amendment.get('amendment_id', ''),
                'gapId': amendment.get('gap_id', ''),
                'amendmentType': amendment.get('amendment_type', 'policy_update'),
                'targetPolicy': amendment.get('target_policy', ''),
                'amendmentTitle': amendment.get('amendment_title', ''),
                'amendmentText': amendment.get('amendment_text', ''),
                'rationale': amendment.get('rationale', ''),
                'implementationNotes': amendment.get('implementation_notes', ''),
                'complianceMonitoring': amendment.get('compliance_monitoring', ''),
                'effectiveDateRecommendation': amendment.get('effective_date_recommendation', ''),
                'priority': amendment.get('priority', 'medium'),
                'status': amendment.get('status', 'draft'),
                'version': amendment.get('version', '1.0'),
                'createdAt': amendment.get('drafted_at', datetime.utcnow().isoformat()),
                'storedAt': datetime.utcnow().isoformat(),
                'approvedBy': amendment.get('approved_by'),
                'approvedAt': amendment.get('approved_at'),
                'approvalNotes': amendment.get('approval_notes'),
                'metadata': {
                    'source': 'automated_drafting',
                    'drafting_version': '1.0',
                    'word_count': len(amendment.get('amendment_text', '').split()),
                    'complexity_score': self._calculate_complexity_score(amendment.get('amendment_text', ''))
                }
            }
            
            # Remove None values
            amendment_item = {k: v for k, v in amendment_item.items() if v is not None}
            
            return amendment_item
            
        except Exception as e:
            logger.error(f"Error preparing amendment item: {str(e)}")
            raise
    
    def _calculate_complexity_score(self, text: str) -> float:
        """Calculate a simple complexity score for the amendment text"""
        try:
            if not text:
                return 0.0
            
            # Simple complexity metrics
            word_count = len(text.split())
            sentence_count = len([s for s in text.split('.') if s.strip()])
            
            if sentence_count == 0:
                return 0.0
            
            avg_words_per_sentence = word_count / sentence_count
            
            # Normalize to 0-1 scale (assuming 20 words per sentence is high complexity)
            complexity = min(avg_words_per_sentence / 20.0, 1.0)
            
            return round(complexity, 2)
            
        except Exception:
            return 0.5  # Default medium complexity

def lambda_handler(event, context):
    """Main Lambda handler for storing amendments"""
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Initialize the amendment storage service
        storage_service = AmendmentStorageService()
        
        # Extract input data
        amendments = event.get('amendments', [])
        operation = event.get('operation', 'store')  # store, update_status, get, query
        
        if operation == 'store':
            if not amendments:
                raise ValueError("amendments are required for store operation")
            
            # Store amendments
            if len(amendments) == 1:
                result = storage_service.store_single_amendment(amendments[0])
            else:
                result = storage_service.store_amendments(amendments)
            
            response = {
                'statusCode': 200,
                'body': {
                    'operation': 'store',
                    'result': result,
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
        
        elif operation == 'update_status':
            amendment_id = event.get('amendment_id')
            status = event.get('status')
            approved_by = event.get('approved_by')
            approval_notes = event.get('approval_notes')
            
            if not amendment_id or not status:
                raise ValueError("amendment_id and status are required for update_status operation")
            
            result = storage_service.update_amendment_status(
                amendment_id, status, approved_by, approval_notes
            )
            
            response = {
                'statusCode': 200,
                'body': {
                    'operation': 'update_status',
                    'amendment_id': amendment_id,
                    'updated_amendment': result,
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
        
        elif operation == 'get':
            amendment_id = event.get('amendment_id')
            
            if not amendment_id:
                raise ValueError("amendment_id is required for get operation")
            
            result = storage_service.get_amendment(amendment_id)
            
            response = {
                'statusCode': 200,
                'body': {
                    'operation': 'get',
                    'amendment_id': amendment_id,
                    'amendment': result,
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
        
        elif operation == 'query':
            query_type = event.get('query_type', 'status')  # status, gap, or review
            query_value = event.get('query_value')
            limit = event.get('limit', 50)
            
            if query_type == 'status':
                if not query_value:
                    raise ValueError("query_value is required for status query")
                result = storage_service.query_amendments_by_status(query_value, limit)
            elif query_type == 'gap':
                if not query_value:
                    raise ValueError("query_value (gap_id) is required for gap query")
                result = storage_service.query_amendments_by_gap(query_value, limit)
            elif query_type == 'review':
                result = storage_service.get_amendments_for_review(limit)
            else:
                raise ValueError(f"Unsupported query_type: {query_type}")
            
            response = {
                'statusCode': 200,
                'body': {
                    'operation': 'query',
                    'query_type': query_type,
                    'query_value': query_value if query_type != 'review' else 'pending_review',
                    'total_results': len(result),
                    'amendments': result,
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
        
        else:
            raise ValueError(f"Unsupported operation: {operation}")
        
        logger.info(f"Amendment storage operation completed: {operation}")
        return response
        
    except Exception as e:
        logger.error(f"Error in amendment storage Lambda: {str(e)}")
        return {
            'statusCode': 500,
            'body': {
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }
        }
