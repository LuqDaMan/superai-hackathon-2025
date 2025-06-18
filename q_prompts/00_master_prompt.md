# Amazon Q Developer Prompt: CompliAgent-SG Master Implementation Guide

## Project Overview
CompliAgent-SG is a system that automates the comparison of regulatory documents with internal policies, identifies gaps, and suggests amendments. The system uses a hybrid architecture leveraging AWS Step Functions for workflow orchestration, Amazon Bedrock for AI capabilities, and Amazon OpenSearch Serverless for vector storage.

## Implementation Sequence
Follow these prompts in sequence to implement the CompliAgent-SG system:

1. **Core Infrastructure (01_core_infrastructure.md)**
   - Set up S3 buckets, DynamoDB tables, and OpenSearch Serverless
   - Create IAM roles with least-privilege permissions

2. **Document Processing (02_document_processing.md)**
   - Implement MAS website scraper Lambda
   - Set up Textract processing pipeline
   - Create vectorization Lambda function

3. **Analysis Workflows (03_analysis_workflows.md)**
   - Implement Step Functions workflows
   - Create Lambda functions for gap analysis
   - Create Lambda functions for amendment drafting

4. **API Layer (04_api_layer.md)**
   - Set up API Gateway endpoints
   - Implement API handler Lambda
   - Configure WebSocket API for real-time updates

5. **Frontend & Integration (05_frontend_integration.md)**
   - Create minimal React frontend
   - Implement authentication with Cognito
   - Deploy with Amplify
   - Test end-to-end workflow

6. **Security & Monitoring (06_security_monitoring.md)**
   - Configure IAM roles and policies
   - Set up KMS encryption
   - Implement CloudWatch Logs and X-Ray tracing
   - Create custom CloudWatch metrics

## Architecture Diagram
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
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Step Functions │────▶│  Lambda         │────▶│  Bedrock        │
│  (Workflow)     │     │  (Query/Analyze)│     │  (Claude 3)     │
└────────┬────────┘     └─────────────────┘     └────────┬────────┘
         │                                               │
         ▼                                               ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  DynamoDB       │◀────│  API Gateway    │◀────│  Cognito        │
│  (Data Store)   │     │  (REST/WS)      │     │  (Auth)         │
└────────┬────────┘     └────────┬────────┘     └─────────────────┘
         │                       │
         └───────────────────────┘
                     │
                     ▼
               ┌─────────────────┐
               │  React Frontend │
               │  (Amplify)      │
               └─────────────────┘
```

## Key Technologies
- **AWS CDK**: For infrastructure as code
- **Python 3.11**: For Lambda functions
- **Amazon Bedrock**: For AI capabilities (Claude 3)
- **Amazon OpenSearch Serverless**: For vector storage
- **AWS Step Functions**: For workflow orchestration
- **React**: For frontend development
- **AWS Amplify**: For frontend hosting and integration

## Implementation Timeline
- **Hours 0-4**: Core Infrastructure
- **Hours 4-8**: Document Processing
- **Hours 8-14**: Analysis Workflows
- **Hours 14-18**: API Layer
- **Hours 18-24**: Frontend & Integration

## Success Criteria
- Successful scraping of MAS website for regulatory documents
- Accurate extraction and vectorization of document content
- Effective identification of gaps between regulations and policies
- Quality amendment suggestions for addressing identified gaps
- Responsive and intuitive user interface
- Secure and monitored system