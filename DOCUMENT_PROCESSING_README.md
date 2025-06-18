# CompliAgent-SG Document Processing Implementation

## ✅ **Phase 2 Complete: Document Processing (Hours 4-8)**

This phase implements the complete document processing pipeline for CompliAgent-SG, including MAS website scraping, document processing with Amazon Textract, and vectorization using Amazon Bedrock.

## 🏗️ **Architecture Overview**

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  MAS Website    │────▶│  Lambda         │────▶│  S3             │
│  (Regulations)  │     │  (Scraper)      │     │  (Raw Docs)     │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  SNS            │◀────│  Lambda         │◀────│  Textract       │
│  (Notification) │     │  (Processor)    │     │  (Text Extract) │
└────────┬────────┘     └─────────────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Lambda         │────▶│  Bedrock        │────▶│  OpenSearch     │
│  (Vectorize)    │     │  (Embeddings)   │     │  (Vector Store) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## 📦 **Components Implemented**

### 1. **MAS Website Scraper Lambda** (`mas_monitor`)
- **Function**: `CompliAgent-MasMonitor`
- **Runtime**: Python 3.10
- **Purpose**: Scrapes MAS website for new regulatory documents
- **Features**:
  - HTML parsing with BeautifulSoup
  - Document deduplication using DynamoDB tracking
  - Automatic PDF download to S3
  - Error handling and retry mechanisms
  - Daily scheduled execution via EventBridge

### 2. **Textract Processor Lambda** (`textract_processor`)
- **Function**: `CompliAgent-TextractProcessor`
- **Runtime**: Python 3.10
- **Purpose**: Processes documents using Amazon Textract
- **Features**:
  - Asynchronous PDF processing for large documents
  - Synchronous processing for images
  - SNS notifications for job completion
  - Text, table, and form extraction
  - Structured JSON output to S3

### 3. **Vectorization Lambda** (`vectorize_content`)
- **Function**: `CompliAgent-VectorizeContent`
- **Runtime**: Python 3.10
- **Purpose**: Generates embeddings and stores in OpenSearch
- **Features**:
  - Text chunking with overlap for better context
  - Amazon Bedrock Titan embeddings
  - OpenSearch Serverless integration
  - Metadata preservation
  - Batch processing capabilities

## 🗄️ **Infrastructure Resources**

### **S3 Buckets**
- `mas-docs-raw-{account}-{region}`: Raw regulatory documents
- `internal-docs-raw-{account}-{region}`: Internal policy documents  
- `processed-docs-json-{account}-{region}`: Processed document data

### **DynamoDB Tables**
- `CompliAgent-GapsTable`: Compliance gaps storage
- `CompliAgent-AmendmentsTable`: Amendment suggestions
- `CompliAgent-DocumentTracking`: Document processing tracking

### **OpenSearch Serverless**
- `vector-collection`: Vector search collection for document embeddings

### **SNS Topics**
- `CompliAgent-TextractCompletion`: Textract job completion notifications

### **EventBridge Rules**
- `CompliAgent-MasMonitorSchedule`: Daily MAS website scraping

## 🚀 **Deployment Instructions**

### **Prerequisites**
1. AWS CLI configured with appropriate credentials
2. Node.js 18+ installed
3. Python 3.10+ installed
4. AWS CDK CLI installed globally

### **Deploy the Infrastructure**

```bash
cd /Users/luqman/Desktop/superai_h/infrastructure/cdk
./deploy-document-processing.sh
```

Or manually:
```bash
# Install dependencies
npm install

# Install Lambda dependencies
cd ../../src/lambda/mas_monitor && pip install -r requirements.txt -t .
cd ../textract_processor && pip install -r requirements.txt -t .
cd ../vectorize_content && pip install -r requirements.txt -t .
cd ../../../infrastructure/cdk

# Build and deploy
npm run build
cdk deploy CompliAgent-SG
```

## 🧪 **Testing the Pipeline**

### **Run Automated Tests**
```bash
cd /Users/luqman/Desktop/superai_h
python test-document-processing.py
```

### **Manual Testing Steps**

1. **Test MAS Monitor**:
   ```bash
   aws lambda invoke --function-name CompliAgent-MasMonitor response.json
   ```

2. **Upload Test Document**:
   ```bash
   aws s3 cp test-document.pdf s3://mas-docs-raw-{account}-{region}/
   ```

3. **Monitor Processing**:
   - Check CloudWatch Logs for each Lambda function
   - Verify processed JSON in `processed-docs-json` bucket
   - Check OpenSearch for indexed vectors

## 📊 **Monitoring and Logging**

### **CloudWatch Logs**
- `/aws/lambda/CompliAgent-MasMonitor`
- `/aws/lambda/CompliAgent-TextractProcessor`
- `/aws/lambda/CompliAgent-VectorizeContent`

### **Key Metrics to Monitor**
- Lambda function duration and errors
- S3 bucket object counts
- DynamoDB read/write capacity
- OpenSearch indexing success rate

## 🔧 **Configuration**

### **Environment Variables**
- `MAS_DOCS_BUCKET`: S3 bucket for raw MAS documents
- `PROCESSED_DOCS_BUCKET`: S3 bucket for processed documents
- `TRACKING_TABLE`: DynamoDB table for document tracking
- `OPENSEARCH_ENDPOINT`: OpenSearch Serverless endpoint
- `SNS_TOPIC_ARN`: SNS topic for Textract notifications

### **IAM Permissions**
Each Lambda function has least-privilege IAM roles with permissions for:
- S3 read/write operations
- DynamoDB operations
- Textract API calls
- Bedrock model invocation
- OpenSearch operations
- KMS encryption/decryption

## 🔐 **Security Features**

- **Encryption**: All data encrypted at rest using KMS
- **Network Security**: OpenSearch Serverless with proper access policies
- **IAM**: Least-privilege roles for each component
- **Monitoring**: CloudWatch Logs and X-Ray tracing enabled

## 📋 **Next Steps**

After successful deployment of the document processing pipeline:

1. **Verify all Lambda functions are working**
2. **Test the complete pipeline with sample documents**
3. **Proceed to Phase 3: Analysis Workflows** using `03_analysis_workflows.md`
4. **Implement gap analysis and amendment drafting workflows**

## 🐛 **Troubleshooting**

### **Common Issues**

1. **Lambda Timeout**: Increase timeout for large document processing
2. **OpenSearch Access**: Verify data access policies are correctly configured
3. **S3 Permissions**: Ensure Lambda roles have proper S3 permissions
4. **Bedrock Access**: Verify Bedrock model access in your region

### **Debug Commands**
```bash
# Check Lambda logs
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/CompliAgent"

# Test Lambda function
aws lambda invoke --function-name CompliAgent-MasMonitor --payload '{}' response.json

# Check S3 bucket contents
aws s3 ls s3://mas-docs-raw-{account}-{region}/ --recursive
```

## 📈 **Performance Optimization**

- **Lambda Memory**: Adjust based on document size and processing needs
- **Batch Processing**: Process multiple documents in parallel
- **Chunking Strategy**: Optimize text chunk size for better embeddings
- **Caching**: Implement caching for frequently accessed documents

---

**Status**: ✅ **Document Processing Phase Complete**  
**Next Phase**: Analysis Workflows (Hours 8-14)
