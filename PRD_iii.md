# Technical Specification: CompliAgent-SG (Optimized Architecture)

This document outlines an optimized technical architecture for the CompliAgent-SG system, combining the strengths of both Bedrock Agents and Step Functions approaches to create a solution that can be implemented within a 24-hour timeframe.

## 1. System Architecture Overview

The system uses a hybrid architecture that leverages:
- **AWS Step Functions** for clear, observable workflow orchestration
- **Amazon Bedrock** for AI capabilities without complex agent setup
- **Amazon OpenSearch Serverless** for vector storage (faster setup than Kendra)
- **WebSocket API** for real-time updates to the frontend

### 1.1 High-Level Workflow

1. **Document Ingestion**: EventBridge triggers Lambda to scrape MAS website for new regulations
2. **Document Processing**: Textract extracts text, which is chunked and vectorized
3. **Gap Analysis**: Step Functions orchestrates the comparison between regulations and policies
4. **Amendment Drafting**: User-triggered workflow generates policy amendment suggestions
5. **User Review**: Frontend displays gaps and amendments with real-time updates

## 2. AWS Service Components

### 2.1 Data Ingestion & Processing

| Service | Component | Purpose | Configuration |
|---------|-----------|---------|---------------|
| **Amazon S3** | mas-docs-raw | Raw regulatory documents | Standard bucket with versioning |
| | internal-docs-raw | Internal policy documents | Standard bucket with versioning |
| | processed-docs-json | Processed document data | Standard bucket |
| **Amazon EventBridge** | mas-monitor-schedule | Daily check for new regulations | Scheduled rule (24h) |
| **AWS Lambda** | func-mas-monitor | Scrape MAS website | Python 3.11 runtime |
| | func-textract-processor | Process documents with Textract | Python 3.11 runtime |
| **Amazon Textract** | Document Analysis | Extract text from documents | Asynchronous processing |
| **Amazon SNS** | sns-textract-completion | Notification for job completion | Standard topic |

### 2.2 Knowledge Core (RAG System)

| Service | Component | Purpose | Configuration |
|---------|-----------|---------|---------------|
| **AWS Lambda** | func-vectorize-content | Create embeddings | Python 3.11 runtime |
| **Amazon Bedrock** | Embedding Model | Generate vector embeddings | Titan Embeddings G1 |
| **Amazon OpenSearch Serverless** | vector-collection | Store and query vectors | Vector search enabled |

### 2.3 Workflow Orchestration

| Service | Component | Purpose | Configuration |
|---------|-----------|---------|---------------|
| **AWS Step Functions** | sfn-gap-analysis | Orchestrate gap analysis | Standard workflow |
| | sfn-amendment-drafting | Orchestrate amendment drafting | Express workflow |
| **AWS Lambda** | func-opensearch-query | Query vector database | Python 3.11 runtime |
| | func-bedrock-gap-analysis | Analyze gaps using Claude 3 | Python 3.11 runtime |
| | func-bedrock-draft-amendments | Draft amendments using Claude 3 | Python 3.11 runtime |
| **Amazon Bedrock** | Foundation Models | Text generation and analysis | Claude 3 Sonnet/Haiku |

### 2.4 Data Storage

| Service | Component | Purpose | Configuration |
|---------|-----------|---------|---------------|
| **Amazon DynamoDB** | GapsTable | Store identified gaps | On-demand capacity |
| | AmendmentsTable | Store amendment suggestions | On-demand capacity |

### 2.5 API & Frontend

| Service | Component | Purpose | Configuration |
|---------|-----------|---------|---------------|
| **Amazon API Gateway** | REST API | Handle frontend requests | Lambda proxy integration |
| | WebSocket API | Real-time updates | Lambda integration |
| **AWS Lambda** | func-api-handler | Process API requests | Python 3.11 runtime |
| | func-websocket-handler | Handle WebSocket connections | Python 3.11 runtime |
| **AWS Amplify** | Web Application | Host frontend application | Static web hosting |
| **Amazon Cognito** | User Pool | User authentication | Email authentication |

## 3. Core Data Models

### 3.1 GapsTable (DynamoDB)

| Attribute | Type | Description |
|-----------|------|-------------|
| `gapId` | String (Partition Key) | Unique identifier for the gap |
| `regulationId` | String | Reference to the source regulation |
| `internalPolicyRef` | String | Reference to the internal policy document |
| `gapDescription` | String | Description of the identified gap |
| `status` | String | Current status: NEW, ACKNOWLEDGED, DISMISSED |
| `createdAt` | Timestamp | When the gap was identified |
| `acknowledgedBy` | String (nullable) | User who acknowledged the gap |

### 3.2 AmendmentsTable (DynamoDB)

| Attribute | Type | Description |
|-----------|------|-------------|
| `amendmentId` | String (Partition Key) | Unique identifier for the amendment |
| `gapId` | String (GSI) | Foreign key to GapsTable |
| `suggestedText` | String | The proposed amendment text |
| `status` | String | Current status: SUGGESTED, APPROVED, REJECTED |
| `createdAt` | Timestamp | When the amendment was generated |
| `approvedBy` | String (nullable) | User who approved the amendment |

## 4. API Interface

### 4.1 REST API Endpoints

| Method | Endpoint | Description | Response |
|--------|----------|-------------|----------|
| **GET** | `/gaps` | Fetch all identified gaps | 200 OK with gap objects |
| **POST** | `/gaps/{gapId}/acknowledge` | Acknowledge a gap | 202 Accepted |
| **GET** | `/amendments?gapId={gapId}` | Fetch amendments for a gap | 200 OK with amendment objects |
| **POST** | `/amendments/{amendmentId}/approve` | Approve an amendment | 200 OK |

### 4.2 WebSocket API

- **Connection**: `/ws` endpoint for real-time updates
- **Message Types**: Gap notifications, amendment status updates
- **Authentication**: Cognito-based authorization

## 5. Step Functions Workflows

### 5.1 Gap Analysis Workflow

```json
{
  "Comment": "Gap Analysis Workflow",
  "StartAt": "QueryVectorStore",
  "States": {
    "QueryVectorStore": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:func-opensearch-query",
      "Next": "AnalyzeGaps"
    },
    "AnalyzeGaps": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:func-bedrock-gap-analysis",
      "Next": "StoreGaps"
    },
    "StoreGaps": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:func-store-gaps",
      "End": true
    }
  }
}
```

### 5.2 Amendment Drafting Workflow

```json
{
  "Comment": "Amendment Drafting Workflow",
  "StartAt": "RetrieveGapDetails",
  "States": {
    "RetrieveGapDetails": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:func-retrieve-gap",
      "Next": "DraftAmendments"
    },
    "DraftAmendments": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:func-bedrock-draft-amendments",
      "Next": "StoreAmendments"
    },
    "StoreAmendments": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT:function:func-store-amendments",
      "End": true
    }
  }
}
```

## 6. Core Lambda Functions

| Function Name | Trigger | Purpose | Key Logic |
|---------------|---------|---------|-----------|
| `func-mas-monitor` | EventBridge | Scrape MAS website | - HTTP requests to MAS site<br>- Parse HTML for new documents<br>- Download PDFs to S3 |
| `func-textract-processor` | S3 Event | Process documents | - Start Textract job<br>- Configure SNS notification |
| `func-vectorize-content` | SNS | Create embeddings | - Process Textract output<br>- Generate embeddings via Bedrock<br>- Store in OpenSearch |
| `func-opensearch-query` | Step Functions | Query vector store | - Convert query to embedding<br>- Search OpenSearch<br>- Return relevant documents |
| `func-bedrock-gap-analysis` | Step Functions | Analyze gaps | - Construct prompt with context<br>- Call Bedrock Claude 3<br>- Parse response for gaps |
| `func-bedrock-draft-amendments` | Step Functions | Draft amendments | - Construct prompt with gap details<br>- Call Bedrock Claude 3<br>- Format amendment suggestions |
| `func-api-handler` | API Gateway | Handle REST requests | - Route based on path/method<br>- Query/update DynamoDB<br>- Trigger Step Functions |
| `func-websocket-handler` | WebSocket API | Handle connections | - Manage connections in DynamoDB<br>- Broadcast updates to clients |

## 7. Implementation Strategy (24-Hour Timeline)

### 7.1 Phase 1: Core Infrastructure (Hours 0-4)
- Set up S3 buckets and DynamoDB tables
- Create IAM roles with least-privilege permissions
- Deploy OpenSearch Serverless collection

### 7.2 Phase 2: Document Processing (Hours 4-8)
- Implement MAS website scraper Lambda
- Set up Textract processing pipeline
- Create vectorization Lambda function

### 7.3 Phase 3: Analysis Workflows (Hours 8-14)
- Implement Step Functions workflows
- Create Lambda functions for gap analysis
- Create Lambda functions for amendment drafting

### 7.4 Phase 4: API Layer (Hours 14-18)
- Set up API Gateway endpoints
- Implement API handler Lambda
- Configure WebSocket API for real-time updates

### 7.5 Phase 5: Frontend & Integration (Hours 18-24)
- Create minimal React frontend
- Implement authentication with Cognito
- Deploy with Amplify
- Test end-to-end workflow

## 8. Security & Monitoring

### 8.1 Security
- IAM roles with least-privilege permissions
- KMS encryption for sensitive data
- Cognito authentication for frontend users

### 8.2 Monitoring
- CloudWatch Logs for all Lambda functions
- Step Functions execution visualization
- X-Ray tracing for request flows
- Custom CloudWatch metrics for business KPIs

## 9. Development Acceleration with Amazon Q Developer

- Use Amazon Q to generate Lambda function code
- Generate IAM policies with appropriate permissions
- Create CloudFormation/CDK templates for infrastructure
- Debug and optimize Lambda functions