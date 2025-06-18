# Amazon Q Developer Prompt: CompliAgent-SG Document Processing

## Task
Implement the document processing pipeline for CompliAgent-SG, including the MAS website scraper, Textract processing, and vectorization components.

## Requirements
1. Create a Lambda function (func-mas-monitor) to:
   - Scrape the MAS website for regulatory documents
   - Parse HTML to identify new documents
   - Download PDFs to the mas-docs-raw S3 bucket
   - Use Python 3.11 runtime

2. Set up an EventBridge scheduled rule (mas-monitor-schedule) to:
   - Trigger the func-mas-monitor Lambda daily
   - Configure with a 24-hour schedule

3. Create a Lambda function (func-textract-processor) to:
   - Process documents with Amazon Textract
   - Configure asynchronous processing
   - Set up SNS notification for job completion
   - Use Python 3.11 runtime

4. Create an SNS topic (sns-textract-completion) for:
   - Notification of Textract job completion
   - Triggering the vectorization process

5. Create a Lambda function (func-vectorize-content) to:
   - Process Textract output
   - Generate embeddings using Amazon Bedrock (Titan Embeddings G1)
   - Store vectors in OpenSearch Serverless
   - Use Python 3.11 runtime

## Expected Output
- Lambda functions with appropriate IAM permissions
- EventBridge rule for scheduled execution
- SNS topic for notifications
- S3 event triggers for document processing

## Additional Notes
- Use boto3 for AWS service interactions
- Implement error handling and retry mechanisms
- Add logging for monitoring and debugging
- Structure the code for maintainability