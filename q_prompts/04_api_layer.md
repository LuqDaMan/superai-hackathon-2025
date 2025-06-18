# Amazon Q Developer Prompt: CompliAgent-SG API Layer

## Task
Implement the API layer for CompliAgent-SG, including REST API endpoints and WebSocket API for real-time updates.

## Requirements
1. Set up an API Gateway REST API with the following endpoints:
   - GET /gaps: Fetch all identified gaps
   - POST /gaps/{gapId}/acknowledge: Acknowledge a gap
   - GET /amendments?gapId={gapId}: Fetch amendments for a gap
   - POST /amendments/{amendmentId}/approve: Approve an amendment

2. Create a Lambda function (func-api-handler) to:
   - Process API requests
   - Route based on path/method
   - Query/update DynamoDB
   - Trigger Step Functions workflows
   - Use Python 3.11 runtime

3. Set up a WebSocket API with:
   - /ws endpoint for real-time updates
   - Support for connection management
   - Message broadcasting capability

4. Create a Lambda function (func-websocket-handler) to:
   - Handle WebSocket connections
   - Manage connections in DynamoDB
   - Broadcast updates to clients
   - Use Python 3.11 runtime

5. Configure Amazon Cognito for:
   - User authentication
   - API authorization
   - Email-based authentication

## Expected Output
- API Gateway REST API with Lambda proxy integration
- WebSocket API with Lambda integration
- Lambda functions with appropriate IAM permissions
- Cognito User Pool for authentication

## Additional Notes
- Implement CORS support for frontend integration
- Add request validation
- Implement error handling
- Add logging for monitoring and debugging
- Structure the code for maintainability