# CompliAgent-SG API Layer Implementation

## ✅ **Phase 4 Complete: API Layer (Hours 14-18)**

This phase implements the complete API layer for CompliAgent-SG, including REST API endpoints, authentication, and WebSocket support for real-time updates.

## 🏗️ **Architecture Overview**

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Frontend       │────▶│  API Gateway    │────▶│  Lambda         │
│  Application    │     │  (REST API)     │     │  (API Handler)  │
└─────────────────┘     └─────────────────┘     └─────────┬───────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Cognito        │◀────│  Authentication │────▶│  DynamoDB       │
│  User Pool      │     │  & Authorization│     │  (Data Layer)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  WebSocket      │────▶│  Lambda         │────▶│  Step Functions │
│  Connections    │     │  (WS Handler)   │     │  (Workflows)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## 📦 **Components Implemented**

### 1. **REST API Endpoints**

#### **Authentication Required Endpoints**
- `GET /gaps` - Fetch all identified compliance gaps
  - Query parameters: `status`, `severity`, `regulationId`, `limit`
  - Returns paginated list of gaps with filtering

- `POST /gaps/{gapId}/acknowledge` - Acknowledge a specific gap
  - Body: `{"acknowledgedBy": "user", "notes": "optional notes"}`
  - Updates gap status to 'acknowledged'

- `GET /amendments` - Fetch policy amendments
  - Query parameters: `gapId`, `status`, `limit`
  - Returns amendments with optional filtering

- `POST /amendments/{amendmentId}/approve` - Approve an amendment
  - Body: `{"approvedBy": "user", "approvalNotes": "optional notes"}`
  - Updates amendment status to 'approved'

- `POST /analysis/start` - Start gap analysis workflow
  - Body: `{"queryText": "search terms", "searchType": "hybrid", "size": 10}`
  - Triggers Step Functions gap analysis workflow

- `POST /amendments/draft` - Start amendment drafting workflow
  - Body: `{"gapIds": ["GAP-001", "GAP-002"], "organizationContext": "context"}`
  - Triggers Step Functions amendment drafting workflow

#### **Public Endpoints**
- `GET /health` - Health check endpoint
  - Returns service status and version information
  - No authentication required

### 2. **API Handler Lambda** (`api_handler`)
- **Function**: `CompliAgent-ApiHandler`
- **Purpose**: Process all REST API requests with routing and business logic
- **Features**:
  - Request routing based on HTTP method and path
  - DynamoDB integration for data operations
  - Step Functions workflow triggering
  - CORS support for frontend integration
  - Comprehensive error handling and logging
  - JSON response formatting with proper HTTP status codes

### 3. **WebSocket Handler Lambda** (`websocket_handler`)
- **Function**: `CompliAgent-WebSocketHandler`
- **Purpose**: Handle real-time WebSocket connections and messaging
- **Features**:
  - Connection lifecycle management (connect/disconnect)
  - Topic-based subscription system
  - Real-time message broadcasting
  - Connection persistence in DynamoDB
  - Ping/pong heartbeat support
  - Error handling for stale connections

### 4. **Authentication & Authorization**

#### **Amazon Cognito User Pool**
- **Pool Name**: `CompliAgent-SG-Users`
- **Features**:
  - Email-based authentication
  - Strong password policy (8+ chars, mixed case, numbers, symbols)
  - Email verification for new users
  - Account recovery via email
  - OAuth 2.0 support with authorization code flow

#### **API Gateway Authorizer**
- **Type**: Cognito User Pools Authorizer
- **Integration**: Validates JWT tokens from Cognito
- **Scope**: Applied to all protected endpoints

### 5. **Data Storage**

#### **WebSocket Connections Table**
- **Table**: `CompliAgent-WebSocketConnections`
- **Purpose**: Track active WebSocket connections
- **Schema**:
  ```json
  {
    "connectionId": "string (PK)",
    "userId": "string",
    "userRole": "string",
    "connectedAt": "ISO timestamp",
    "lastActivity": "ISO timestamp",
    "subscribedTopics": ["array of topics"],
    "status": "connected|disconnected",
    "ttl": "number (auto-cleanup)"
  }
  ```

## 🚀 **API Endpoints Reference**

### **Authentication**
All protected endpoints require a valid JWT token in the Authorization header:
```
Authorization: Bearer <jwt-token>
```

### **GET /gaps**
Retrieve compliance gaps with optional filtering.

**Query Parameters:**
- `status` (optional): Filter by gap status (identified, acknowledged, resolved)
- `severity` (optional): Filter by severity (critical, high, medium, low)
- `regulationId` (optional): Filter by specific regulation
- `limit` (optional): Maximum number of results (default: 50)

**Response:**
```json
{
  "gaps": [
    {
      "gapId": "GAP-001",
      "title": "Missing Data Retention Policy",
      "description": "Regulatory requirement not addressed",
      "severity": "high",
      "status": "identified",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 1,
  "filters": {
    "status": "identified",
    "severity": null,
    "regulationId": null
  }
}
```

### **POST /gaps/{gapId}/acknowledge**
Acknowledge a specific compliance gap.

**Request Body:**
```json
{
  "acknowledgedBy": "john.doe@company.com",
  "notes": "Gap acknowledged, will address in next policy review"
}
```

**Response:**
```json
{
  "message": "Gap acknowledged successfully",
  "gap": {
    "gapId": "GAP-001",
    "status": "acknowledged",
    "acknowledgedBy": "john.doe@company.com",
    "acknowledgedAt": "2024-01-01T12:00:00Z"
  }
}
```

### **GET /amendments**
Retrieve policy amendments with optional filtering.

**Query Parameters:**
- `gapId` (optional): Filter by specific gap ID
- `status` (optional): Filter by amendment status (draft, approved, implemented)
- `limit` (optional): Maximum number of results (default: 50)

**Response:**
```json
{
  "amendments": [
    {
      "amendmentId": "AMD-001",
      "gapId": "GAP-001",
      "amendmentTitle": "Data Retention Requirements",
      "amendmentText": "Section 4.2 Data Retention: All customer data...",
      "status": "draft",
      "priority": "high"
    }
  ],
  "total": 1
}
```

### **POST /analysis/start**
Start the gap analysis workflow.

**Request Body:**
```json
{
  "queryText": "data retention requirements",
  "searchType": "hybrid",
  "size": 10,
  "analysisContext": "Focus on customer data protection"
}
```

**Response:**
```json
{
  "message": "Gap analysis started successfully",
  "executionArn": "arn:aws:states:region:account:execution:workflow:execution-id",
  "requestId": "uuid-request-id"
}
```

## 🔌 **WebSocket API**

### **Connection**
Connect to WebSocket API:
```
wss://api-id.execute-api.region.amazonaws.com/prod
```

### **Authentication**
Pass user credentials as query parameters:
```
wss://api-id.execute-api.region.amazonaws.com/prod?userId=user123&userRole=admin
```

### **Message Format**
All WebSocket messages use JSON format:

#### **Subscribe to Topics**
```json
{
  "type": "subscribe",
  "topics": ["gaps", "amendments", "analysis"]
}
```

#### **Unsubscribe from Topics**
```json
{
  "type": "unsubscribe",
  "topics": ["gaps"]
}
```

#### **Ping/Pong**
```json
{
  "type": "ping"
}
```

#### **Real-time Updates**
Server sends updates to subscribed clients:
```json
{
  "type": "update",
  "topic": "gaps",
  "data": {
    "action": "created",
    "gap": {
      "gapId": "GAP-002",
      "title": "New compliance gap identified"
    }
  },
  "timestamp": "2024-01-01T12:00:00Z"
}
```

## 🚀 **Deployment Instructions**

### **Prerequisites**
1. Core infrastructure and analysis workflows deployed
2. AWS CLI configured with appropriate permissions

### **Deploy API Layer**

```bash
cd /Users/luqman/Desktop/superai_h/infrastructure/cdk

# Install Lambda dependencies
cd ../../src/lambda/api_handler && pip install -r requirements.txt -t .
cd ../websocket_handler && pip install -r requirements.txt -t .
cd ../../../infrastructure/cdk

# Deploy the updated stack
npm run build
cdk deploy CompliAgent-SG
```

### **Post-Deployment Setup**

1. **Create Cognito User**:
   ```bash
   # Run the test script to create a test user
   python test-api-layer.py
   # Choose 'y' when prompted to create test user
   ```

2. **Get API Endpoint**:
   ```bash
   # Get the API Gateway endpoint from AWS Console or CLI
   aws apigateway get-rest-apis --query 'items[?name==`CompliAgent-SG-API`].{id:id,name:name}'
   ```

3. **Test API Health**:
   ```bash
   curl -X GET https://your-api-id.execute-api.region.amazonaws.com/prod/health
   ```

## 🧪 **Testing the API Layer**

### **Run Automated Tests**
```bash
cd /Users/luqman/Desktop/superai_h
python test-api-layer.py
```

### **Manual API Testing**

#### **1. Test Health Endpoint**
```bash
curl -X GET https://your-api-id.execute-api.region.amazonaws.com/prod/health
```

#### **2. Authenticate with Cognito**
```bash
# Use AWS CLI or SDK to get JWT token
aws cognito-idp admin-initiate-auth \
  --user-pool-id your-user-pool-id \
  --client-id your-client-id \
  --auth-flow ADMIN_NO_SRP_AUTH \
  --auth-parameters USERNAME=test@example.com,PASSWORD=TempPassword123!
```

#### **3. Test Protected Endpoints**
```bash
# Get gaps
curl -X GET \
  -H "Authorization: Bearer your-jwt-token" \
  https://your-api-id.execute-api.region.amazonaws.com/prod/gaps

# Acknowledge a gap
curl -X POST \
  -H "Authorization: Bearer your-jwt-token" \
  -H "Content-Type: application/json" \
  -d '{"acknowledgedBy":"test@example.com","notes":"Testing"}' \
  https://your-api-id.execute-api.region.amazonaws.com/prod/gaps/GAP-001/acknowledge
```

#### **4. Test WebSocket Connection**
```javascript
// JavaScript WebSocket client example
const ws = new WebSocket('wss://your-api-id.execute-api.region.amazonaws.com/prod?userId=test&userRole=user');

ws.onopen = function() {
  // Subscribe to topics
  ws.send(JSON.stringify({
    type: 'subscribe',
    topics: ['gaps', 'amendments']
  }));
};

ws.onmessage = function(event) {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};
```

## 📊 **Monitoring and Observability**

### **CloudWatch Metrics**
- API Gateway request count and latency
- Lambda function duration and errors
- Cognito authentication success/failure rates
- WebSocket connection counts

### **CloudWatch Logs**
- `/aws/lambda/CompliAgent-ApiHandler`
- `/aws/lambda/CompliAgent-WebSocketHandler`
- `/aws/apigateway/CompliAgent-SG-API`

### **API Gateway Logging**
- Request/response logging enabled
- Execution logging for debugging
- CloudWatch metrics for monitoring

## 🔐 **Security Features**

### **Authentication & Authorization**
- JWT-based authentication via Cognito
- Strong password policies
- Email verification for new users
- Token-based API access control

### **API Security**
- CORS configuration for frontend integration
- Request throttling (100 req/sec, 200 burst)
- Input validation and sanitization
- Comprehensive error handling without information leakage

### **Data Protection**
- All data encrypted at rest using KMS
- Secure transmission via HTTPS/WSS
- No sensitive data in logs
- Connection cleanup for WebSocket sessions

## 🔧 **Configuration**

### **Environment Variables**
- `GAPS_TABLE_NAME`: DynamoDB gaps table name
- `AMENDMENTS_TABLE_NAME`: DynamoDB amendments table name
- `GAP_ANALYSIS_STATE_MACHINE_ARN`: Step Functions workflow ARN
- `CONNECTIONS_TABLE_NAME`: WebSocket connections table name
- `WEBSOCKET_API_ENDPOINT`: WebSocket API endpoint URL

### **API Gateway Settings**
- Stage: `prod`
- Throttling: 100 requests/second, 200 burst
- CORS: Enabled for all origins (configure for production)
- Logging: INFO level with data tracing

## 🐛 **Troubleshooting**

### **Common Issues**

1. **Authentication Errors**
   - Verify Cognito user pool configuration
   - Check JWT token validity and format
   - Ensure proper Authorization header format

2. **CORS Issues**
   - Verify CORS configuration in API Gateway
   - Check preflight OPTIONS requests
   - Ensure proper headers in frontend requests

3. **WebSocket Connection Failures**
   - Check WebSocket endpoint URL
   - Verify connection parameters
   - Monitor connection table for stale entries

### **Debug Commands**
```bash
# Check API Gateway logs
aws logs describe-log-groups --log-group-name-prefix "/aws/apigateway"

# Test Lambda function directly
aws lambda invoke --function-name CompliAgent-ApiHandler --payload '{"httpMethod":"GET","path":"/health"}' response.json

# Check Cognito user pool
aws cognito-idp describe-user-pool --user-pool-id your-pool-id
```

## 📈 **Performance Optimization**

- **Lambda Cold Starts**: Provisioned concurrency for high-traffic endpoints
- **API Caching**: Enable caching for frequently accessed data
- **Database Optimization**: Use appropriate DynamoDB indexes
- **Connection Management**: Implement WebSocket connection pooling

---

**Status**: ✅ **API Layer Phase Complete**  
**Next Phase**: Frontend Integration (Hours 18-24) - `05_frontend_integration.md`
