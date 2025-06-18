# Amazon Q Developer Prompt: CompliAgent-SG Core Infrastructure

## Task
Create the core infrastructure for the CompliAgent-SG system using AWS CDK in TypeScript.

## Requirements
1. Set up three S3 buckets:
   - mas-docs-raw: For raw regulatory documents with versioning enabled
   - internal-docs-raw: For internal policy documents with versioning enabled
   - processed-docs-json: For processed document data

2. Create two DynamoDB tables with on-demand capacity:
   - GapsTable with the following attributes:
     - gapId (String, Partition Key)
     - regulationId (String)
     - internalPolicyRef (String)
     - gapDescription (String)
     - status (String)
     - createdAt (Timestamp)
     - acknowledgedBy (String, nullable)
   
   - AmendmentsTable with the following attributes:
     - amendmentId (String, Partition Key)
     - gapId (String, with GSI)
     - suggestedText (String)
     - status (String)
     - createdAt (Timestamp)
     - approvedBy (String, nullable)

3. Deploy an OpenSearch Serverless collection for vector search:
   - Name: vector-collection
   - Enable vector search capability

4. Create IAM roles with least-privilege permissions for each component

## Expected Output
A CDK stack in TypeScript that provisions all the required resources with appropriate configurations and security settings.

## Additional Notes
- Ensure all resources have appropriate tags
- Set up KMS encryption for sensitive data
- Follow AWS best practices for security and resource naming