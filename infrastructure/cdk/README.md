# CompliAgent-SG Infrastructure

This directory contains the AWS CDK infrastructure code for the CompliAgent-SG system.

## Prerequisites

1. **AWS CLI configured** with appropriate credentials
2. **Node.js 18+** installed
3. **AWS CDK CLI** installed globally: `npm install -g aws-cdk`

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Bootstrap CDK (if not done before):
   ```bash
   cdk bootstrap
   ```

## Deployment

1. Build the TypeScript code:
   ```bash
   npm run build
   ```

2. Review the changes:
   ```bash
   npm run diff
   ```

3. Deploy the infrastructure:
   ```bash
   npm run deploy
   ```

## Resources Created

### S3 Buckets
- `mas-docs-raw-{account}-{region}`: Raw regulatory documents from MAS
- `internal-docs-raw-{account}-{region}`: Internal policy documents
- `processed-docs-json-{account}-{region}`: Processed document data

### DynamoDB Tables
- `CompliAgent-GapsTable`: Stores identified compliance gaps
- `CompliAgent-AmendmentsTable`: Stores amendment suggestions

### OpenSearch Serverless
- `vector-collection`: Vector search collection for document embeddings

### IAM Roles
- `MasScraperRole`: For MAS website scraper Lambda
- `TextractProcessorRole`: For document processing Lambda
- `VectorizeRole`: For vectorization Lambda
- `GapAnalysisRole`: For gap analysis Lambda
- `AmendmentDraftingRole`: For amendment drafting Lambda
- `ApiHandlerRole`: For API handler Lambda
- `StepFunctionsRole`: For Step Functions workflows

### Security
- KMS key for encryption of all sensitive data
- Least-privilege IAM policies
- OpenSearch Serverless security policies

## Cleanup

To destroy all resources:
```bash
npm run destroy
```

**Warning**: This will delete all data. Make sure to backup any important information before running this command.

## Next Steps

After deploying the core infrastructure:
1. Proceed to implement the document processing Lambda functions
2. Set up the Step Functions workflows
3. Create the API layer
4. Deploy the frontend application
