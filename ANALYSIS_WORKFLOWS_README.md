# CompliAgent-SG Analysis Workflows Implementation

## ✅ **Phase 3 Complete: Analysis Workflows (Hours 8-14)**

This phase implements the complete analysis workflow system for CompliAgent-SG, including gap analysis and amendment drafting using Step Functions, Lambda functions, and Amazon Bedrock.

## 🏗️ **Architecture Overview**

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Step Functions │────▶│  OpenSearch     │────▶│  Bedrock        │
│  (Gap Analysis) │     │  Query Lambda   │     │  Gap Analysis   │
└─────────────────┘     └─────────────────┘     └─────────┬───────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  DynamoDB       │◀────│  Store Gaps     │◀────│  Gap Results    │
│  (Gaps Table)   │     │  Lambda         │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Step Functions │────▶│  Retrieve Gap   │────▶│  Bedrock        │
│  (Amendment)    │     │  Lambda         │     │  Draft Amend.   │
└─────────────────┘     └─────────────────┘     └─────────┬───────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  DynamoDB       │◀────│  Store Amend.   │◀────│  Amendment      │
│  (Amendments)   │     │  Lambda         │     │  Results        │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## 📦 **Components Implemented**

### 1. **Lambda Functions**

#### **OpenSearch Query Lambda** (`opensearch_query`)
- **Function**: `CompliAgent-OpenSearchQuery`
- **Purpose**: Query OpenSearch for relevant documents using vector and text search
- **Features**:
  - Vector similarity search using Bedrock Titan embeddings
  - Text-based search with fuzzy matching
  - Hybrid search combining vector and text results
  - Configurable result ranking and filtering

#### **Bedrock Gap Analysis Lambda** (`bedrock_gap_analysis`)
- **Function**: `CompliAgent-BedrockGapAnalysis`
- **Purpose**: Analyze compliance gaps using Claude 3
- **Features**:
  - Comprehensive gap analysis between regulations and policies
  - Structured JSON output with gap details
  - Severity and risk assessment
  - Specific regulatory reference mapping

#### **Bedrock Draft Amendments Lambda** (`bedrock_draft_amendments`)
- **Function**: `CompliAgent-BedrockDraftAmendments`
- **Purpose**: Draft policy amendments using Claude 3
- **Features**:
  - Professional policy language generation
  - Implementation guidance and monitoring requirements
  - Priority-based amendment recommendations
  - Compliance rationale and justification

#### **Store Gaps Lambda** (`store_gaps`)
- **Function**: `CompliAgent-StoreGaps`
- **Purpose**: Store identified gaps in DynamoDB
- **Features**:
  - Batch and single gap storage
  - Status tracking and updates
  - Query capabilities by status, regulation, severity
  - Metadata enrichment and validation

#### **Retrieve Gap Lambda** (`retrieve_gap`)
- **Function**: `CompliAgent-RetrieveGap`
- **Purpose**: Retrieve gap details from DynamoDB
- **Features**:
  - Single and multiple gap retrieval
  - Advanced querying by various criteria
  - High-priority gap identification
  - Search functionality across gap content

#### **Store Amendments Lambda** (`store_amendments`)
- **Function**: `CompliAgent-StoreAmendments`
- **Purpose**: Store amendment suggestions in DynamoDB
- **Features**:
  - Amendment lifecycle management
  - Approval workflow support
  - Complexity scoring and analysis
  - Review queue management

### 2. **Step Functions Workflows**

#### **Gap Analysis Workflow** (`CompliAgent-GapAnalysis`)
- **States**:
  1. **QueryVectorStore**: Search for relevant documents
  2. **AnalyzeGaps**: Identify compliance gaps using AI
  3. **StoreGaps**: Save identified gaps to database
- **Features**:
  - Error handling and retry logic
  - CloudWatch logging and tracing
  - 30-minute timeout protection

#### **Amendment Drafting Workflow** (`CompliAgent-AmendmentDrafting`)
- **States**:
  1. **RetrieveGapDetails**: Get gap information
  2. **DraftAmendments**: Generate amendment suggestions
  3. **StoreAmendments**: Save amendments to database
- **Features**:
  - Automated amendment generation
  - Professional policy language
  - Implementation guidance

## 🗄️ **Data Models**

### **Gap Data Structure**
```json
{
  "gap_id": "GAP-001",
  "title": "Missing Data Retention Policy",
  "description": "Regulatory requirement for 7-year data retention not addressed",
  "regulatory_reference": "MAS Notice 123, Section 4.2",
  "policy_reference": "Data Management Policy v2.1",
  "gap_type": "missing_requirement",
  "severity": "high",
  "risk_level": "high",
  "impact_description": "Non-compliance with regulatory requirements",
  "recommended_action": "Update policy to include retention requirement",
  "status": "identified",
  "created_at": "2024-01-01T00:00:00Z"
}
```

### **Amendment Data Structure**
```json
{
  "amendment_id": "AMD-001",
  "gap_id": "GAP-001",
  "amendment_type": "policy_update",
  "target_policy": "Data Management Policy",
  "amendment_title": "Data Retention Requirements",
  "amendment_text": "Section 4.2 Data Retention: All customer data must be retained...",
  "rationale": "Addresses regulatory requirement for 7-year data retention",
  "implementation_notes": "Coordinate with IT for backup system updates",
  "compliance_monitoring": "Annual audit of data retention practices",
  "effective_date_recommendation": "90 days from approval",
  "priority": "high",
  "status": "draft"
}
```

## 🚀 **Deployment Instructions**

### **Prerequisites**
1. Core infrastructure and document processing pipeline deployed
2. Documents indexed in OpenSearch Serverless
3. Amazon Bedrock access enabled for Claude 3 and Titan models

### **Deploy Analysis Workflows**

```bash
cd /Users/luqman/Desktop/superai_h/infrastructure/cdk

# Install Lambda dependencies
cd ../../src/lambda/opensearch_query && pip install -r requirements.txt -t .
cd ../bedrock_gap_analysis && pip install -r requirements.txt -t .
cd ../bedrock_draft_amendments && pip install -r requirements.txt -t .
cd ../store_gaps && pip install -r requirements.txt -t .
cd ../retrieve_gap && pip install -r requirements.txt -t .
cd ../store_amendments && pip install -r requirements.txt -t .
cd ../../../infrastructure/cdk

# Deploy the updated stack
npm run build
cdk deploy CompliAgent-SG
```

## 🧪 **Testing the Workflows**

### **Run Automated Tests**
```bash
cd /Users/luqman/Desktop/superai_h
python test-analysis-workflows.py
```

### **Manual Testing**

#### **1. Test Gap Analysis Workflow**
```bash
# Start gap analysis workflow
aws stepfunctions start-execution \
  --state-machine-arn "arn:aws:states:REGION:ACCOUNT:stateMachine:CompliAgent-GapAnalysis" \
  --input '{
    "query_text": "data retention requirements",
    "regulatory_documents": [...],
    "internal_policies": [...]
  }'
```

#### **2. Test Amendment Drafting Workflow**
```bash
# Start amendment drafting workflow
aws stepfunctions start-execution \
  --state-machine-arn "arn:aws:states:REGION:ACCOUNT:stateMachine:CompliAgent-AmendmentDrafting" \
  --input '{
    "operation": "query",
    "query_type": "ready",
    "limit": 5
  }'
```

#### **3. Test Individual Lambda Functions**
```bash
# Test OpenSearch query
aws lambda invoke --function-name CompliAgent-OpenSearchQuery \
  --payload '{"query_text":"compliance policy","search_type":"hybrid"}' \
  response.json

# Test gap analysis
aws lambda invoke --function-name CompliAgent-BedrockGapAnalysis \
  --payload '{"regulatory_documents":[...],"internal_policies":[...]}' \
  response.json
```

## 📊 **Monitoring and Observability**

### **CloudWatch Metrics**
- Lambda function duration and errors
- Step Functions execution success/failure rates
- DynamoDB read/write capacity utilization
- Bedrock model invocation costs

### **CloudWatch Logs**
- `/aws/lambda/CompliAgent-OpenSearchQuery`
- `/aws/lambda/CompliAgent-BedrockGapAnalysis`
- `/aws/lambda/CompliAgent-BedrockDraftAmendments`
- `/aws/lambda/CompliAgent-StoreGaps`
- `/aws/lambda/CompliAgent-RetrieveGap`
- `/aws/lambda/CompliAgent-StoreAmendments`
- `/aws/stepfunctions/CompliAgent-GapAnalysis`
- `/aws/stepfunctions/CompliAgent-AmendmentDrafting`

### **X-Ray Tracing**
- End-to-end request tracing
- Performance bottleneck identification
- Service dependency mapping

## 🔧 **Configuration**

### **Environment Variables**
- `OPENSEARCH_ENDPOINT`: OpenSearch Serverless endpoint
- `OPENSEARCH_INDEX`: Document index name (default: 'documents')
- `CLAUDE_MODEL_ID`: Bedrock Claude model ID
- `GAPS_TABLE_NAME`: DynamoDB gaps table name
- `AMENDMENTS_TABLE_NAME`: DynamoDB amendments table name

### **IAM Permissions**
Each Lambda function has least-privilege IAM roles with permissions for:
- Bedrock model invocation (Claude 3, Titan Embeddings)
- OpenSearch Serverless operations
- DynamoDB read/write operations
- KMS encryption/decryption
- CloudWatch Logs

## 🔐 **Security Features**

- **Encryption**: All data encrypted at rest using KMS
- **Access Control**: Least-privilege IAM policies
- **Network Security**: VPC endpoints for service communication
- **Audit Trail**: CloudTrail logging for all API calls
- **Data Privacy**: No PII stored in logs or temporary data

## 📋 **Usage Examples**

### **Identify Compliance Gaps**
```python
import boto3

stepfunctions = boto3.client('stepfunctions')

# Start gap analysis
response = stepfunctions.start_execution(
    stateMachineArn='arn:aws:states:region:account:stateMachine:CompliAgent-GapAnalysis',
    input=json.dumps({
        'query_text': 'customer data protection requirements',
        'search_type': 'hybrid',
        'size': 10
    })
)
```

### **Draft Policy Amendments**
```python
# Start amendment drafting
response = stepfunctions.start_execution(
    stateMachineArn='arn:aws:states:region:account:stateMachine:CompliAgent-AmendmentDrafting',
    input=json.dumps({
        'operation': 'query',
        'query_type': 'ready',
        'limit': 5
    })
)
```

### **Query Gaps by Severity**
```python
import boto3

lambda_client = boto3.client('lambda')

response = lambda_client.invoke(
    FunctionName='CompliAgent-RetrieveGap',
    Payload=json.dumps({
        'operation': 'query',
        'query_type': 'severity',
        'query_value': 'critical',
        'limit': 10
    })
)
```

## 🐛 **Troubleshooting**

### **Common Issues**

1. **OpenSearch Connection Errors**
   - Verify OpenSearch Serverless collection is active
   - Check data access policies
   - Validate IAM permissions

2. **Bedrock Access Denied**
   - Ensure Bedrock model access is enabled in your region
   - Verify IAM permissions for bedrock:InvokeModel
   - Check model availability

3. **Step Functions Timeout**
   - Increase timeout values for complex analyses
   - Optimize Lambda function performance
   - Consider breaking large analyses into smaller chunks

### **Debug Commands**
```bash
# Check Lambda function logs
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/CompliAgent"

# Check Step Functions execution
aws stepfunctions describe-execution --execution-arn <execution-arn>

# Test OpenSearch connectivity
aws opensearchserverless list-collections
```

## 📈 **Performance Optimization**

- **Lambda Memory**: Adjust based on document size and complexity
- **Batch Processing**: Process multiple gaps/amendments together
- **Caching**: Implement caching for frequently accessed data
- **Parallel Processing**: Use Step Functions parallel states for independent operations

---

**Status**: ✅ **Analysis Workflows Phase Complete**  
**Next Phase**: API Layer (Hours 14-18) - `04_api_layer.md`
