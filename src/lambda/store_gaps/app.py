import json
import boto3
import logging
from datetime import datetime
import os
from typing import Dict, List
from decimal import Decimal

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')

# Environment variables
GAPS_TABLE_NAME = os.environ.get('GAPS_TABLE_NAME', 'CompliAgent-GapsTable')

class GapStorageService:
    """Service for storing compliance gaps in DynamoDB"""
    
    def __init__(self):
        self.gaps_table = dynamodb.Table(GAPS_TABLE_NAME)
    
    def store_gaps(self, gaps: List[Dict]) -> Dict:
        """Store multiple gaps in DynamoDB"""
        try:
            logger.info(f"Storing {len(gaps)} gaps in DynamoDB")
            
            stored_gaps = []
            failed_gaps = []
            
            for gap in gaps:
                try:
                    # Prepare gap data for DynamoDB
                    gap_item = self._prepare_gap_item(gap)
                    
                    # Store in DynamoDB
                    self.gaps_table.put_item(Item=gap_item)
                    stored_gaps.append(gap_item['gapId'])
                    
                    logger.info(f"Stored gap: {gap_item['gapId']}")
                    
                except Exception as e:
                    logger.error(f"Failed to store gap {gap.get('gap_id', 'unknown')}: {str(e)}")
                    failed_gaps.append({
                        'gap_id': gap.get('gap_id', 'unknown'),
                        'error': str(e)
                    })
            
            result = {
                'total_gaps': len(gaps),
                'stored_successfully': len(stored_gaps),
                'failed_to_store': len(failed_gaps),
                'stored_gap_ids': stored_gaps,
                'failed_gaps': failed_gaps
            }
            
            logger.info(f"Gap storage completed: {len(stored_gaps)} stored, {len(failed_gaps)} failed")
            return result
            
        except Exception as e:
            logger.error(f"Error in gap storage: {str(e)}")
            raise
    
    def store_single_gap(self, gap: Dict) -> Dict:
        """Store a single gap in DynamoDB"""
        try:
            # Prepare gap data for DynamoDB
            gap_item = self._prepare_gap_item(gap)
            
            # Store in DynamoDB
            self.gaps_table.put_item(Item=gap_item)
            
            logger.info(f"Stored single gap: {gap_item['gapId']}")
            
            return {
                'gap_id': gap_item['gapId'],
                'status': 'stored',
                'stored_at': gap_item['storedAt']
            }
            
        except Exception as e:
            logger.error(f"Error storing single gap: {str(e)}")
            raise
    
    def update_gap_status(self, gap_id: str, status: str, 
                         acknowledged_by: str = None) -> Dict:
        """Update the status of an existing gap"""
        try:
            update_expression = "SET #status = :status, updatedAt = :updated_at"
            expression_attribute_names = {"#status": "status"}
            expression_attribute_values = {
                ":status": status,
                ":updated_at": datetime.utcnow().isoformat()
            }
            
            if acknowledged_by:
                update_expression += ", acknowledgedBy = :acknowledged_by"
                expression_attribute_values[":acknowledged_by"] = acknowledged_by
            
            response = self.gaps_table.update_item(
                Key={'gapId': gap_id},
                UpdateExpression=update_expression,
                ExpressionAttributeNames=expression_attribute_names,
                ExpressionAttributeValues=expression_attribute_values,
                ReturnValues='ALL_NEW'
            )
            
            logger.info(f"Updated gap status: {gap_id} -> {status}")
            return response['Attributes']
            
        except Exception as e:
            logger.error(f"Error updating gap status: {str(e)}")
            raise
    
    def get_gap(self, gap_id: str) -> Dict:
        """Retrieve a specific gap from DynamoDB"""
        try:
            response = self.gaps_table.get_item(Key={'gapId': gap_id})
            
            if 'Item' in response:
                return response['Item']
            else:
                return None
                
        except Exception as e:
            logger.error(f"Error retrieving gap {gap_id}: {str(e)}")
            raise
    
    def query_gaps_by_status(self, status: str, limit: int = 50) -> List[Dict]:
        """Query gaps by status"""
        try:
            response = self.gaps_table.query(
                IndexName='statusIndex',
                KeyConditionExpression='#status = :status',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={':status': status},
                Limit=limit,
                ScanIndexForward=False  # Most recent first
            )
            
            return response.get('Items', [])
            
        except Exception as e:
            logger.error(f"Error querying gaps by status: {str(e)}")
            raise
    
    def query_gaps_by_regulation(self, regulation_id: str, limit: int = 50) -> List[Dict]:
        """Query gaps by regulation ID"""
        try:
            response = self.gaps_table.query(
                IndexName='regulationIdIndex',
                KeyConditionExpression='regulationId = :regulation_id',
                ExpressionAttributeValues={':regulation_id': regulation_id},
                Limit=limit,
                ScanIndexForward=False  # Most recent first
            )
            
            return response.get('Items', [])
            
        except Exception as e:
            logger.error(f"Error querying gaps by regulation: {str(e)}")
            raise
    
    def _prepare_gap_item(self, gap: Dict) -> Dict:
        """Prepare gap data for DynamoDB storage"""
        try:
            # Convert any float values to Decimal for DynamoDB
            gap_item = {
                'gapId': gap.get('gap_id', ''),
                'title': gap.get('title', ''),
                'description': gap.get('description', ''),
                'regulationId': self._extract_regulation_id(gap.get('regulatory_reference', '')),
                'regulatoryReference': gap.get('regulatory_reference', ''),
                'internalPolicyRef': gap.get('policy_reference', ''),
                'gapType': gap.get('gap_type', 'missing_requirement'),
                'severity': gap.get('severity', 'medium'),
                'riskLevel': gap.get('risk_level', 'medium'),
                'impactDescription': gap.get('impact_description', ''),
                'recommendedAction': gap.get('recommended_action', ''),
                'status': gap.get('status', 'identified'),
                'createdAt': gap.get('identified_at', datetime.utcnow().isoformat()),
                'storedAt': datetime.utcnow().isoformat(),
                'acknowledgedBy': gap.get('acknowledged_by'),
                'metadata': {
                    'source': 'automated_analysis',
                    'analysis_version': '1.0',
                    'confidence_score': gap.get('confidence_score', 0.8)
                }
            }
            
            # Remove None values
            gap_item = {k: v for k, v in gap_item.items() if v is not None}
            
            return gap_item
            
        except Exception as e:
            logger.error(f"Error preparing gap item: {str(e)}")
            raise
    
    def _extract_regulation_id(self, regulatory_reference: str) -> str:
        """Extract a regulation ID from the regulatory reference"""
        try:
            if not regulatory_reference:
                return 'UNKNOWN'
            
            # Simple extraction logic - can be enhanced
            # Look for patterns like "MAS Notice 123", "Regulation ABC", etc.
            import re
            
            # Try to find MAS Notice pattern
            mas_match = re.search(r'MAS\s+Notice\s+(\w+)', regulatory_reference, re.IGNORECASE)
            if mas_match:
                return f"MAS-NOTICE-{mas_match.group(1)}"
            
            # Try to find general regulation pattern
            reg_match = re.search(r'Regulation\s+(\w+)', regulatory_reference, re.IGNORECASE)
            if reg_match:
                return f"REG-{reg_match.group(1)}"
            
            # Fallback: use first few words
            words = regulatory_reference.split()[:3]
            return '-'.join(words).upper()
            
        except Exception:
            return 'UNKNOWN'

def lambda_handler(event, context):
    """Main Lambda handler for storing gaps"""
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Initialize the gap storage service
        storage_service = GapStorageService()
        
        # Extract input data
        gaps = event.get('gaps', [])
        operation = event.get('operation', 'store')  # store, update_status, get, query
        
        if operation == 'store':
            if not gaps:
                raise ValueError("gaps are required for store operation")
            
            # Store gaps
            if len(gaps) == 1:
                result = storage_service.store_single_gap(gaps[0])
            else:
                result = storage_service.store_gaps(gaps)
            
            response = {
                'statusCode': 200,
                'body': {
                    'operation': 'store',
                    'result': result,
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
        
        elif operation == 'update_status':
            gap_id = event.get('gap_id')
            status = event.get('status')
            acknowledged_by = event.get('acknowledged_by')
            
            if not gap_id or not status:
                raise ValueError("gap_id and status are required for update_status operation")
            
            result = storage_service.update_gap_status(gap_id, status, acknowledged_by)
            
            response = {
                'statusCode': 200,
                'body': {
                    'operation': 'update_status',
                    'gap_id': gap_id,
                    'updated_gap': result,
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
        
        elif operation == 'get':
            gap_id = event.get('gap_id')
            
            if not gap_id:
                raise ValueError("gap_id is required for get operation")
            
            result = storage_service.get_gap(gap_id)
            
            response = {
                'statusCode': 200,
                'body': {
                    'operation': 'get',
                    'gap_id': gap_id,
                    'gap': result,
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
        
        elif operation == 'query':
            query_type = event.get('query_type', 'status')  # status or regulation
            query_value = event.get('query_value')
            limit = event.get('limit', 50)
            
            if not query_value:
                raise ValueError("query_value is required for query operation")
            
            if query_type == 'status':
                result = storage_service.query_gaps_by_status(query_value, limit)
            elif query_type == 'regulation':
                result = storage_service.query_gaps_by_regulation(query_value, limit)
            else:
                raise ValueError(f"Unsupported query_type: {query_type}")
            
            response = {
                'statusCode': 200,
                'body': {
                    'operation': 'query',
                    'query_type': query_type,
                    'query_value': query_value,
                    'total_results': len(result),
                    'gaps': result,
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
        
        else:
            raise ValueError(f"Unsupported operation: {operation}")
        
        logger.info(f"Gap storage operation completed: {operation}")
        return response
        
    except Exception as e:
        logger.error(f"Error in gap storage Lambda: {str(e)}")
        return {
            'statusCode': 500,
            'body': {
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }
        }
