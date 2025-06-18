# CompliAgent-SG Implementation Guide

This guide provides a step-by-step approach to implementing the CompliAgent-SG system based on the PRD.

## Project Setup

We've created a structured project with:

1. **Amazon Q Developer Prompts**: A series of prompts in the `q_prompts` directory that guide the implementation process.
2. **Project Structure**: A directory structure that organizes the code for different components of the system.
3. **Sample Implementations**: Initial code for key components to demonstrate the implementation approach.

## Implementation Steps

### 1. Core Infrastructure (Hours 0-4)

Use the `01_core_infrastructure.md` prompt to:
- Set up S3 buckets for document storage
- Create DynamoDB tables for gaps and amendments
- Deploy OpenSearch Serverless for vector search
- Configure IAM roles and KMS encryption

Sample implementation: `infrastructure/cdk/core-infrastructure-stack.ts`

### 2. Document Processing (Hours 4-8)

Use the `02_document_processing.md` prompt to:
- Implement the MAS website scraper Lambda
- Set up the Textract processing pipeline
- Create the vectorization Lambda

Sample implementation: `src/lambda/mas_monitor/app.py`

### 3. Analysis Workflows (Hours 8-14)

Use the `03_analysis_workflows.md` prompt to:
- Implement Step Functions workflows for gap analysis and amendment drafting
- Create Lambda functions for OpenSearch queries and Bedrock interactions
- Set up DynamoDB operations for storing results

### 4. API Layer (Hours 14-18)

Use the `04_api_layer.md` prompt to:
- Set up API Gateway endpoints for REST operations
- Implement WebSocket API for real-time updates
- Create Lambda functions for API handling
- Configure Cognito for authentication

### 5. Frontend & Integration (Hours 18-24)

Use the `05_frontend_integration.md` prompt to:
- Create a React frontend application
- Implement authentication with Cognito
- Set up API integrations
- Deploy with Amplify

### 6. Security & Monitoring

Use the `06_security_monitoring.md` prompt to:
- Configure IAM roles with least-privilege permissions
- Set up KMS encryption for sensitive data
- Implement CloudWatch Logs and X-Ray tracing
- Create custom CloudWatch metrics

## Using Amazon Q Developer

1. Start with the master prompt (`00_master_prompt.md`) to understand the overall architecture.
2. Work through each prompt in sequence, using Amazon Q Developer to generate code and configurations.
3. Implement, test, and refine each component before moving to the next.
4. Refer to `USING_AMAZON_Q_PROMPTS.md` for detailed guidance on working with the prompts.

## Testing the System

After implementation, test the system with the following workflow:
1. Upload sample regulatory documents to the mas-docs-raw S3 bucket
2. Upload sample internal policy documents to the internal-docs-raw S3 bucket
3. Trigger the gap analysis workflow
4. Review identified gaps in the frontend
5. Trigger the amendment drafting workflow for selected gaps
6. Review and approve amendments in the frontend

## Next Steps

After completing the initial implementation:
1. Refine the AI prompts for better gap analysis and amendment suggestions
2. Optimize the vector search for improved relevance
3. Enhance the frontend with additional features and visualizations
4. Set up monitoring and alerting for production use