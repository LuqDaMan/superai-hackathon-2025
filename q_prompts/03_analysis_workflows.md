# Amazon Q Developer Prompt: CompliAgent-SG Analysis Workflows

## Task
Implement the Step Functions workflows and Lambda functions for gap analysis and amendment drafting in the CompliAgent-SG system.

## Requirements
1. Create a Step Functions workflow (sfn-gap-analysis) with the following states:
   - QueryVectorStore: Calls func-opensearch-query Lambda
   - AnalyzeGaps: Calls func-bedrock-gap-analysis Lambda
   - StoreGaps: Calls func-store-gaps Lambda

2. Create a Step Functions workflow (sfn-amendment-drafting) with the following states:
   - RetrieveGapDetails: Calls func-retrieve-gap Lambda
   - DraftAmendments: Calls func-bedrock-draft-amendments Lambda
   - StoreAmendments: Calls func-store-amendments Lambda

3. Implement the following Lambda functions:
   - func-opensearch-query:
     - Convert query to embedding
     - Search OpenSearch
     - Return relevant documents
   
   - func-bedrock-gap-analysis:
     - Construct prompt with context
     - Call Bedrock Claude 3
     - Parse response for gaps
   
   - func-bedrock-draft-amendments:
     - Construct prompt with gap details
     - Call Bedrock Claude 3
     - Format amendment suggestions
   
   - func-store-gaps:
     - Store identified gaps in DynamoDB
   
   - func-retrieve-gap:
     - Retrieve gap details from DynamoDB
   
   - func-store-amendments:
     - Store amendment suggestions in DynamoDB

## Expected Output
- Step Functions workflows defined in JSON or using AWS CDK
- Lambda functions with appropriate IAM permissions
- Integration between Step Functions and Lambda functions

## Additional Notes
- Use Python 3.11 runtime for all Lambda functions
- Implement error handling and retry mechanisms
- Add logging for monitoring and debugging
- Structure the code for maintainability