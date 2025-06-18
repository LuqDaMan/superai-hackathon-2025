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
apigateway_client = boto3.client('apigatewaymanagementapi')

# Environment variables
CONNECTIONS_TABLE_NAME = os.environ.get('CONNECTIONS_TABLE_NAME', 'CompliAgent-WebSocketConnections')
WEBSOCKET_API_ENDPOINT = os.environ.get('WEBSOCKET_API_ENDPOINT')

class WebSocketHandler:
    """Handler for WebSocket connections and messaging"""
    
    def __init__(self):
        self.connections_table = dynamodb.Table(CONNECTIONS_TABLE_NAME)
        
        # Initialize API Gateway Management API client with endpoint
        if WEBSOCKET_API_ENDPOINT:
            self.apigateway_client = boto3.client(
                'apigatewaymanagementapi',
                endpoint_url=WEBSOCKET_API_ENDPOINT
            )
        else:
            self.apigateway_client = None
    
    def handle_connection(self, event: Dict) -> Dict:
        """Handle WebSocket connection events"""
        try:
            route_key = event.get('requestContext', {}).get('routeKey', '')
            connection_id = event.get('requestContext', {}).get('connectionId', '')
            
            logger.info(f"Handling WebSocket event: {route_key} for connection {connection_id}")
            
            if route_key == '$connect':
                return self._handle_connect(event)
            elif route_key == '$disconnect':
                return self._handle_disconnect(event)
            elif route_key == 'message':
                return self._handle_message(event)
            else:
                logger.warning(f"Unknown route key: {route_key}")
                return self._success_response()
                
        except Exception as e:
            logger.error(f"Error handling WebSocket connection: {str(e)}")
            return self._error_response(500, "Internal server error")
    
    def _handle_connect(self, event: Dict) -> Dict:
        """Handle new WebSocket connection"""
        try:
            connection_id = event.get('requestContext', {}).get('connectionId', '')
            
            # Extract user information from query parameters or headers
            query_params = event.get('queryStringParameters') or {}
            user_id = query_params.get('userId', 'anonymous')
            user_role = query_params.get('userRole', 'user')
            
            # Store connection information
            self.connections_table.put_item(
                Item={
                    'connectionId': connection_id,
                    'userId': user_id,
                    'userRole': user_role,
                    'connectedAt': datetime.utcnow().isoformat(),
                    'lastActivity': datetime.utcnow().isoformat(),
                    'status': 'connected'
                }
            )
            
            logger.info(f"WebSocket connection established: {connection_id} for user {user_id}")
            
            # Send welcome message
            welcome_message = {
                'type': 'connection',
                'status': 'connected',
                'message': 'Connected to CompliAgent-SG real-time updates',
                'timestamp': datetime.utcnow().isoformat()
            }
            
            self._send_message_to_connection(connection_id, welcome_message)
            
            return self._success_response()
            
        except Exception as e:
            logger.error(f"Error handling connect: {str(e)}")
            return self._error_response(500, "Connection failed")
    
    def _handle_disconnect(self, event: Dict) -> Dict:
        """Handle WebSocket disconnection"""
        try:
            connection_id = event.get('requestContext', {}).get('connectionId', '')
            
            # Remove connection from table
            self.connections_table.delete_item(
                Key={'connectionId': connection_id}
            )
            
            logger.info(f"WebSocket connection closed: {connection_id}")
            
            return self._success_response()
            
        except Exception as e:
            logger.error(f"Error handling disconnect: {str(e)}")
            return self._success_response()  # Always return success for disconnect
    
    def _handle_message(self, event: Dict) -> Dict:
        """Handle incoming WebSocket messages"""
        try:
            connection_id = event.get('requestContext', {}).get('connectionId', '')
            body = event.get('body', '{}')
            
            try:
                message = json.loads(body)
            except json.JSONDecodeError:
                return self._send_error_to_connection(connection_id, "Invalid JSON message")
            
            message_type = message.get('type', '')
            
            logger.info(f"Received message type '{message_type}' from connection {connection_id}")
            
            # Update last activity
            self._update_connection_activity(connection_id)
            
            # Handle different message types
            if message_type == 'ping':
                return self._handle_ping(connection_id)
            elif message_type == 'subscribe':
                return self._handle_subscribe(connection_id, message)
            elif message_type == 'unsubscribe':
                return self._handle_unsubscribe(connection_id, message)
            else:
                return self._send_error_to_connection(connection_id, f"Unknown message type: {message_type}")
                
        except Exception as e:
            logger.error(f"Error handling message: {str(e)}")
            return self._error_response(500, "Message handling failed")
    
    def _handle_ping(self, connection_id: str) -> Dict:
        """Handle ping message"""
        pong_message = {
            'type': 'pong',
            'timestamp': datetime.utcnow().isoformat()
        }
        
        self._send_message_to_connection(connection_id, pong_message)
        return self._success_response()
    
    def _handle_subscribe(self, connection_id: str, message: Dict) -> Dict:
        """Handle subscription to specific topics"""
        try:
            topics = message.get('topics', [])
            
            # Update connection with subscribed topics
            self.connections_table.update_item(
                Key={'connectionId': connection_id},
                UpdateExpression='SET subscribedTopics = :topics, lastActivity = :activity',
                ExpressionAttributeValues={
                    ':topics': topics,
                    ':activity': datetime.utcnow().isoformat()
                }
            )
            
            response_message = {
                'type': 'subscription',
                'status': 'subscribed',
                'topics': topics,
                'timestamp': datetime.utcnow().isoformat()
            }
            
            self._send_message_to_connection(connection_id, response_message)
            
            logger.info(f"Connection {connection_id} subscribed to topics: {topics}")
            
            return self._success_response()
            
        except Exception as e:
            logger.error(f"Error handling subscribe: {str(e)}")
            return self._send_error_to_connection(connection_id, "Subscription failed")
    
    def _handle_unsubscribe(self, connection_id: str, message: Dict) -> Dict:
        """Handle unsubscription from topics"""
        try:
            topics_to_remove = message.get('topics', [])
            
            # Get current subscriptions
            response = self.connections_table.get_item(Key={'connectionId': connection_id})
            
            if 'Item' in response:
                current_topics = response['Item'].get('subscribedTopics', [])
                updated_topics = [topic for topic in current_topics if topic not in topics_to_remove]
                
                # Update connection
                self.connections_table.update_item(
                    Key={'connectionId': connection_id},
                    UpdateExpression='SET subscribedTopics = :topics, lastActivity = :activity',
                    ExpressionAttributeValues={
                        ':topics': updated_topics,
                        ':activity': datetime.utcnow().isoformat()
                    }
                )
                
                response_message = {
                    'type': 'unsubscription',
                    'status': 'unsubscribed',
                    'topics': topics_to_remove,
                    'remainingTopics': updated_topics,
                    'timestamp': datetime.utcnow().isoformat()
                }
                
                self._send_message_to_connection(connection_id, response_message)
                
                logger.info(f"Connection {connection_id} unsubscribed from topics: {topics_to_remove}")
            
            return self._success_response()
            
        except Exception as e:
            logger.error(f"Error handling unsubscribe: {str(e)}")
            return self._send_error_to_connection(connection_id, "Unsubscription failed")
    
    def broadcast_update(self, topic: str, update_data: Dict) -> Dict:
        """Broadcast update to all subscribed connections"""
        try:
            # Get all active connections
            response = self.connections_table.scan(
                FilterExpression='#status = :status',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={':status': 'connected'}
            )
            
            connections = response.get('Items', [])
            successful_sends = 0
            failed_sends = 0
            
            message = {
                'type': 'update',
                'topic': topic,
                'data': update_data,
                'timestamp': datetime.utcnow().isoformat()
            }
            
            for connection in connections:
                connection_id = connection['connectionId']
                subscribed_topics = connection.get('subscribedTopics', [])
                
                # Check if connection is subscribed to this topic
                if topic in subscribed_topics or 'all' in subscribed_topics:
                    if self._send_message_to_connection(connection_id, message):
                        successful_sends += 1
                    else:
                        failed_sends += 1
            
            logger.info(f"Broadcast to topic '{topic}': {successful_sends} successful, {failed_sends} failed")
            
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'message': 'Broadcast completed',
                    'topic': topic,
                    'successful_sends': successful_sends,
                    'failed_sends': failed_sends
                })
            }
            
        except Exception as e:
            logger.error(f"Error broadcasting update: {str(e)}")
            return self._error_response(500, f"Broadcast failed: {str(e)}")
    
    def _send_message_to_connection(self, connection_id: str, message: Dict) -> bool:
        """Send message to a specific WebSocket connection"""
        try:
            if not self.apigateway_client:
                logger.error("API Gateway Management API client not initialized")
                return False
            
            self.apigateway_client.post_to_connection(
                ConnectionId=connection_id,
                Data=json.dumps(message)
            )
            
            return True
            
        except self.apigateway_client.exceptions.GoneException:
            # Connection is no longer available, remove it
            logger.info(f"Connection {connection_id} is gone, removing from table")
            try:
                self.connections_table.delete_item(Key={'connectionId': connection_id})
            except Exception:
                pass
            return False
            
        except Exception as e:
            logger.error(f"Error sending message to connection {connection_id}: {str(e)}")
            return False
    
    def _send_error_to_connection(self, connection_id: str, error_message: str) -> Dict:
        """Send error message to connection"""
        error_msg = {
            'type': 'error',
            'message': error_message,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        self._send_message_to_connection(connection_id, error_msg)
        return self._success_response()
    
    def _update_connection_activity(self, connection_id: str):
        """Update last activity timestamp for connection"""
        try:
            self.connections_table.update_item(
                Key={'connectionId': connection_id},
                UpdateExpression='SET lastActivity = :activity',
                ExpressionAttributeValues={
                    ':activity': datetime.utcnow().isoformat()
                }
            )
        except Exception as e:
            logger.warning(f"Failed to update activity for connection {connection_id}: {str(e)}")
    
    def _success_response(self) -> Dict:
        """Create a successful WebSocket response"""
        return {'statusCode': 200}
    
    def _error_response(self, status_code: int, message: str) -> Dict:
        """Create an error WebSocket response"""
        return {
            'statusCode': status_code,
            'body': json.dumps({
                'error': message,
                'timestamp': datetime.utcnow().isoformat()
            })
        }

def lambda_handler(event, context):
    """Main Lambda handler for WebSocket events"""
    try:
        logger.info(f"Received WebSocket event: {json.dumps(event)}")
        
        # Check if this is a broadcast request (from SNS or direct invocation)
        if 'Records' in event:
            # Handle SNS message for broadcasting
            handler = WebSocketHandler()
            results = []
            
            for record in event['Records']:
                if record.get('EventSource') == 'aws:sns':
                    message = json.loads(record['Sns']['Message'])
                    topic = message.get('topic', 'general')
                    data = message.get('data', {})
                    
                    result = handler.broadcast_update(topic, data)
                    results.append(result)
            
            return results[0] if results else {'statusCode': 200}
        
        elif 'topic' in event and 'data' in event:
            # Direct broadcast invocation
            handler = WebSocketHandler()
            return handler.broadcast_update(event['topic'], event['data'])
        
        else:
            # Regular WebSocket connection event
            handler = WebSocketHandler()
            return handler.handle_connection(event)
            
    except Exception as e:
        logger.error(f"Unhandled error in WebSocket handler: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': 'Internal server error',
                'timestamp': datetime.utcnow().isoformat()
            })
        }
