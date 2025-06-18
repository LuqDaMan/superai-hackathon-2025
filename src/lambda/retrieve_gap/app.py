import json
import boto3
import logging
from datetime import datetime
import os
from typing import Dict, List, Optional

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')

# Environment variables
GAPS_TABLE_NAME = os.environ.get('GAPS_TABLE_NAME', 'CompliAgent-GapsTable')

class GapRetrievalService:
    """Service for retrieving compliance gaps from DynamoDB"""
    
    def __init__(self):
        self.gaps_table = dynamodb.Table(GAPS_TABLE_NAME)
    
    def get_gap_details(self, gap_id: str) -> Optional[Dict]:
        """Retrieve detailed information for a specific gap"""
        try:
            logger.info(f"Retrieving gap details for: {gap_id}")
            
            response = self.gaps_table.get_item(Key={'gapId': gap_id})
            
            if 'Item' in response:
                gap = response['Item']
                logger.info(f"Found gap: {gap.get('title', 'Unknown')}")
                return gap
            else:
                logger.warning(f"Gap not found: {gap_id}")
                return None
                
        except Exception as e:
            logger.error(f"Error retrieving gap {gap_id}: {str(e)}")
            raise
    
    def get_multiple_gaps(self, gap_ids: List[str]) -> List[Dict]:
        """Retrieve multiple gaps by their IDs"""
        try:
            logger.info(f"Retrieving {len(gap_ids)} gaps")
            
            gaps = []
            for gap_id in gap_ids:
                gap = self.get_gap_details(gap_id)
                if gap:
                    gaps.append(gap)
            
            logger.info(f"Retrieved {len(gaps)} gaps successfully")
            return gaps
            
        except Exception as e:
            logger.error(f"Error retrieving multiple gaps: {str(e)}")
            raise
    
    def get_gaps_by_status(self, status: str, limit: int = 50) -> List[Dict]:
        """Retrieve gaps by status"""
        try:
            logger.info(f"Retrieving gaps with status: {status}")
            
            response = self.gaps_table.query(
                IndexName='statusIndex',
                KeyConditionExpression='#status = :status',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={':status': status},
                Limit=limit,
                ScanIndexForward=False  # Most recent first
            )
            
            gaps = response.get('Items', [])
            logger.info(f"Found {len(gaps)} gaps with status {status}")
            return gaps
            
        except Exception as e:
            logger.error(f"Error retrieving gaps by status: {str(e)}")
            raise
    
    def get_gaps_by_regulation(self, regulation_id: str, limit: int = 50) -> List[Dict]:
        """Retrieve gaps by regulation ID"""
        try:
            logger.info(f"Retrieving gaps for regulation: {regulation_id}")
            
            response = self.gaps_table.query(
                IndexName='regulationIdIndex',
                KeyConditionExpression='regulationId = :regulation_id',
                ExpressionAttributeValues={':regulation_id': regulation_id},
                Limit=limit,
                ScanIndexForward=False  # Most recent first
            )
            
            gaps = response.get('Items', [])
            logger.info(f"Found {len(gaps)} gaps for regulation {regulation_id}")
            return gaps
            
        except Exception as e:
            logger.error(f"Error retrieving gaps by regulation: {str(e)}")
            raise
    
    def get_gaps_by_severity(self, severity: str, limit: int = 50) -> List[Dict]:
        """Retrieve gaps by severity level"""
        try:
            logger.info(f"Retrieving gaps with severity: {severity}")
            
            # Use scan with filter since severity is not indexed
            response = self.gaps_table.scan(
                FilterExpression='severity = :severity',
                ExpressionAttributeValues={':severity': severity},
                Limit=limit
            )
            
            gaps = response.get('Items', [])
            logger.info(f"Found {len(gaps)} gaps with severity {severity}")
            return gaps
            
        except Exception as e:
            logger.error(f"Error retrieving gaps by severity: {str(e)}")
            raise
    
    def get_high_priority_gaps(self, limit: int = 20) -> List[Dict]:
        """Retrieve high priority gaps (critical and high severity)"""
        try:
            logger.info("Retrieving high priority gaps")
            
            # Get critical gaps
            critical_gaps = self.get_gaps_by_severity('critical', limit // 2)
            
            # Get high severity gaps
            high_gaps = self.get_gaps_by_severity('high', limit // 2)
            
            # Combine and sort by creation date
            all_gaps = critical_gaps + high_gaps
            all_gaps.sort(key=lambda x: x.get('createdAt', ''), reverse=True)
            
            # Return top gaps up to limit
            priority_gaps = all_gaps[:limit]
            
            logger.info(f"Found {len(priority_gaps)} high priority gaps")
            return priority_gaps
            
        except Exception as e:
            logger.error(f"Error retrieving high priority gaps: {str(e)}")
            raise
    
    def get_gaps_for_amendment_drafting(self, limit: int = 10) -> List[Dict]:
        """Retrieve gaps that are ready for amendment drafting"""
        try:
            logger.info("Retrieving gaps ready for amendment drafting")
            
            # Get gaps with status 'identified' or 'acknowledged'
            identified_gaps = self.get_gaps_by_status('identified', limit // 2)
            acknowledged_gaps = self.get_gaps_by_status('acknowledged', limit // 2)
            
            # Combine and prioritize by severity
            all_gaps = identified_gaps + acknowledged_gaps
            
            # Sort by severity (critical > high > medium > low) and then by date
            severity_order = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}
            all_gaps.sort(key=lambda x: (
                severity_order.get(x.get('severity', 'medium'), 2),
                x.get('createdAt', '')
            ))
            
            # Return top gaps up to limit
            ready_gaps = all_gaps[:limit]
            
            logger.info(f"Found {len(ready_gaps)} gaps ready for amendment drafting")
            return ready_gaps
            
        except Exception as e:
            logger.error(f"Error retrieving gaps for amendment drafting: {str(e)}")
            raise
    
    def search_gaps(self, search_term: str, limit: int = 20) -> List[Dict]:
        """Search gaps by title or description"""
        try:
            logger.info(f"Searching gaps for term: {search_term}")
            
            # Use scan with filter to search in title and description
            response = self.gaps_table.scan(
                FilterExpression='contains(title, :search_term) OR contains(description, :search_term)',
                ExpressionAttributeValues={':search_term': search_term},
                Limit=limit
            )
            
            gaps = response.get('Items', [])
            logger.info(f"Found {len(gaps)} gaps matching search term")
            return gaps
            
        except Exception as e:
            logger.error(f"Error searching gaps: {str(e)}")
            raise
    
    def get_gap_summary_stats(self) -> Dict:
        """Get summary statistics for gaps"""
        try:
            logger.info("Calculating gap summary statistics")
            
            # Get all gaps (this could be optimized for large datasets)
            response = self.gaps_table.scan()
            all_gaps = response.get('Items', [])
            
            # Calculate statistics
            total_gaps = len(all_gaps)
            
            status_counts = {}
            severity_counts = {}
            gap_type_counts = {}
            
            for gap in all_gaps:
                # Count by status
                status = gap.get('status', 'unknown')
                status_counts[status] = status_counts.get(status, 0) + 1
                
                # Count by severity
                severity = gap.get('severity', 'unknown')
                severity_counts[severity] = severity_counts.get(severity, 0) + 1
                
                # Count by gap type
                gap_type = gap.get('gapType', 'unknown')
                gap_type_counts[gap_type] = gap_type_counts.get(gap_type, 0) + 1
            
            stats = {
                'total_gaps': total_gaps,
                'status_breakdown': status_counts,
                'severity_breakdown': severity_counts,
                'gap_type_breakdown': gap_type_counts,
                'calculated_at': datetime.utcnow().isoformat()
            }
            
            logger.info(f"Gap statistics calculated: {total_gaps} total gaps")
            return stats
            
        except Exception as e:
            logger.error(f"Error calculating gap statistics: {str(e)}")
            raise

def lambda_handler(event, context):
    """Main Lambda handler for retrieving gaps"""
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Initialize the gap retrieval service
        retrieval_service = GapRetrievalService()
        
        # Extract input parameters
        operation = event.get('operation', 'get')  # get, get_multiple, query, search, stats
        
        if operation == 'get':
            gap_id = event.get('gap_id')
            if not gap_id:
                raise ValueError("gap_id is required for get operation")
            
            result = retrieval_service.get_gap_details(gap_id)
            
            response = {
                'statusCode': 200,
                'body': {
                    'operation': 'get',
                    'gap_id': gap_id,
                    'gap': result,
                    'found': result is not None,
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
        
        elif operation == 'get_multiple':
            gap_ids = event.get('gap_ids', [])
            if not gap_ids:
                raise ValueError("gap_ids are required for get_multiple operation")
            
            result = retrieval_service.get_multiple_gaps(gap_ids)
            
            response = {
                'statusCode': 200,
                'body': {
                    'operation': 'get_multiple',
                    'requested_gap_ids': gap_ids,
                    'total_found': len(result),
                    'gaps': result,
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
        
        elif operation == 'query':
            query_type = event.get('query_type', 'status')  # status, regulation, severity, priority, ready
            query_value = event.get('query_value')
            limit = event.get('limit', 50)
            
            if query_type == 'status':
                if not query_value:
                    raise ValueError("query_value is required for status query")
                result = retrieval_service.get_gaps_by_status(query_value, limit)
            elif query_type == 'regulation':
                if not query_value:
                    raise ValueError("query_value is required for regulation query")
                result = retrieval_service.get_gaps_by_regulation(query_value, limit)
            elif query_type == 'severity':
                if not query_value:
                    raise ValueError("query_value is required for severity query")
                result = retrieval_service.get_gaps_by_severity(query_value, limit)
            elif query_type == 'priority':
                result = retrieval_service.get_high_priority_gaps(limit)
            elif query_type == 'ready':
                result = retrieval_service.get_gaps_for_amendment_drafting(limit)
            else:
                raise ValueError(f"Unsupported query_type: {query_type}")
            
            response = {
                'statusCode': 200,
                'body': {
                    'operation': 'query',
                    'query_type': query_type,
                    'query_value': query_value if query_value else f'{query_type}_query',
                    'total_results': len(result),
                    'gaps': result,
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
        
        elif operation == 'search':
            search_term = event.get('search_term')
            limit = event.get('limit', 20)
            
            if not search_term:
                raise ValueError("search_term is required for search operation")
            
            result = retrieval_service.search_gaps(search_term, limit)
            
            response = {
                'statusCode': 200,
                'body': {
                    'operation': 'search',
                    'search_term': search_term,
                    'total_results': len(result),
                    'gaps': result,
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
        
        elif operation == 'stats':
            result = retrieval_service.get_gap_summary_stats()
            
            response = {
                'statusCode': 200,
                'body': {
                    'operation': 'stats',
                    'statistics': result,
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
        
        else:
            raise ValueError(f"Unsupported operation: {operation}")
        
        logger.info(f"Gap retrieval operation completed: {operation}")
        return response
        
    except Exception as e:
        logger.error(f"Error in gap retrieval Lambda: {str(e)}")
        return {
            'statusCode': 500,
            'body': {
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }
        }
