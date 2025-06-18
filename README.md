# CompliAgent-SG

A system that automates the comparison of regulatory documents with internal policies, identifies gaps, and suggests amendments using AWS services and AI capabilities.

## Project Overview

CompliAgent-SG uses a hybrid architecture leveraging:
- **AWS Step Functions** for clear, observable workflow orchestration
- **Amazon Bedrock** for AI capabilities
- **Amazon OpenSearch Serverless** for vector storage
- **WebSocket API** for real-time updates to the frontend

## Architecture

The system follows a workflow of:
1. **Document Ingestion**: EventBridge triggers Lambda to scrape MAS website for new regulations
2. **Document Processing**: Textract extracts text, which is chunked and vectorized
3. **Gap Analysis**: Step Functions orchestrates the comparison between regulations and policies
4. **Amendment Drafting**: User-triggered workflow generates policy amendment suggestions
5. **User Review**: Frontend displays gaps and amendments with real-time updates

## Directory Structure

```
/
├── infrastructure/        # CDK infrastructure code
│   └── cdk/              # CDK stacks
├── src/
│   ├── lambda/           # Lambda function code
│   │   ├── mas_monitor/  # MAS website scraper
│   │   ├── textract_processor/  # Document processing
│   │   ├── vectorize_content/   # Vector embedding
│   │   ├── opensearch_query/    # Vector search
│   │   ├── bedrock_gap_analysis/  # Gap analysis
│   │   ├── bedrock_draft_amendments/  # Amendment drafting
│   │   ├── api_handler/  # REST API handler
│   │   └── websocket_handler/  # WebSocket handler
│   └── frontend/         # React frontend code
├── q_prompts/            # Amazon Q Developer prompts
│   ├── 00_master_prompt.md
│   ├── 01_core_infrastructure.md
│   ├── 02_document_processing.md
│   ├── 03_analysis_workflows.md
│   ├── 04_api_layer.md
│   ├── 05_frontend_integration.md
│   └── 06_security_monitoring.md
└── PRD_iii.md           # Product Requirements Document
```

## Implementation Guide

Follow the Amazon Q Developer prompts in the `q_prompts` directory in sequence to implement the system:

1. Start with `00_master_prompt.md` to understand the overall architecture and implementation strategy
2. Follow each numbered prompt in sequence to build out the system components
3. Use Amazon Q Developer to generate code based on the prompts

## Implementation Timeline

- **Hours 0-4**: Core Infrastructure
- **Hours 4-8**: Document Processing
- **Hours 8-14**: Analysis Workflows
- **Hours 14-18**: API Layer
- **Hours 18-24**: Frontend & Integration

## Technologies Used

- **AWS CDK**: For infrastructure as code
- **Python 3.11**: For Lambda functions
- **Amazon Bedrock**: For AI capabilities (Claude 3)
- **Amazon OpenSearch Serverless**: For vector storage
- **AWS Step Functions**: For workflow orchestration
- **React**: For frontend development
- **AWS Amplify**: For frontend hosting and integration