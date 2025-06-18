# Amazon Q Developer Prompt: CompliAgent-SG Security & Monitoring

## Task
Implement security measures and monitoring for the CompliAgent-SG system.

## Requirements
1. Set up IAM roles with least-privilege permissions for:
   - Lambda functions
   - Step Functions workflows
   - API Gateway
   - Cognito

2. Configure KMS encryption for:
   - S3 buckets
   - DynamoDB tables
   - OpenSearch Serverless collection

3. Set up CloudWatch Logs for:
   - Lambda functions
   - API Gateway
   - Step Functions

4. Implement X-Ray tracing for:
   - API requests
   - Lambda functions
   - Step Functions workflows

5. Create custom CloudWatch metrics for:
   - Number of identified gaps
   - Amendment approval rate
   - Processing time for documents
   - API response times

## Expected Output
- IAM policies with least-privilege permissions
- KMS encryption configuration
- CloudWatch Logs configuration
- X-Ray tracing setup
- Custom CloudWatch metrics and dashboards

## Additional Notes
- Follow AWS security best practices
- Implement proper error handling and logging
- Create alarms for critical metrics
- Document security measures