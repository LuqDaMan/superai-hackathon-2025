"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoreInfrastructureStack = void 0;
const cdk = require("aws-cdk-lib");
const s3 = require("aws-cdk-lib/aws-s3");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const opensearchserverless = require("aws-cdk-lib/aws-opensearchserverless");
const kms = require("aws-cdk-lib/aws-kms");
const iam = require("aws-cdk-lib/aws-iam");
class CoreInfrastructureStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Create KMS key for encryption
        this.encryptionKey = new kms.Key(this, 'CompliAgentEncryptionKey', {
            enableKeyRotation: true,
            description: 'KMS key for CompliAgent-SG encryption',
            alias: 'alias/compliagent-sg',
        });
        // Create S3 buckets with unique names using account ID and region
        const accountId = cdk.Stack.of(this).account;
        const region = cdk.Stack.of(this).region;
        this.masDocsRawBucket = new s3.Bucket(this, 'MasDocsRawBucket', {
            bucketName: `mas-docs-raw-${accountId}-${region}`,
            versioned: true,
            encryption: s3.BucketEncryption.KMS,
            encryptionKey: this.encryptionKey,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            lifecycleRules: [{
                    id: 'DeleteOldVersions',
                    noncurrentVersionExpiration: cdk.Duration.days(90),
                }],
        });
        this.internalDocsRawBucket = new s3.Bucket(this, 'InternalDocsRawBucket', {
            bucketName: `internal-docs-raw-${accountId}-${region}`,
            versioned: true,
            encryption: s3.BucketEncryption.KMS,
            encryptionKey: this.encryptionKey,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            lifecycleRules: [{
                    id: 'DeleteOldVersions',
                    noncurrentVersionExpiration: cdk.Duration.days(90),
                }],
        });
        this.processedDocsJsonBucket = new s3.Bucket(this, 'ProcessedDocsJsonBucket', {
            bucketName: `processed-docs-json-${accountId}-${region}`,
            encryption: s3.BucketEncryption.KMS,
            encryptionKey: this.encryptionKey,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            lifecycleRules: [{
                    id: 'DeleteOldProcessedDocs',
                    expiration: cdk.Duration.days(365),
                }],
        });
        // Create DynamoDB tables
        this.gapsTable = new dynamodb.Table(this, 'GapsTable', {
            tableName: 'CompliAgent-GapsTable',
            partitionKey: { name: 'gapId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
            encryptionKey: this.encryptionKey,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            pointInTimeRecovery: true,
        });
        // Add GSI for regulationId to GapsTable
        this.gapsTable.addGlobalSecondaryIndex({
            indexName: 'regulationIdIndex',
            partitionKey: { name: 'regulationId', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // Add GSI for status to GapsTable
        this.gapsTable.addGlobalSecondaryIndex({
            indexName: 'statusIndex',
            partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        this.amendmentsTable = new dynamodb.Table(this, 'AmendmentsTable', {
            tableName: 'CompliAgent-AmendmentsTable',
            partitionKey: { name: 'amendmentId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
            encryptionKey: this.encryptionKey,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            pointInTimeRecovery: true,
        });
        // Add GSI for gapId to AmendmentsTable
        this.amendmentsTable.addGlobalSecondaryIndex({
            indexName: 'gapIdIndex',
            partitionKey: { name: 'gapId', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // Add GSI for status to AmendmentsTable
        this.amendmentsTable.addGlobalSecondaryIndex({
            indexName: 'statusIndex',
            partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // Create OpenSearch Serverless security policies
        const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'VectorCollectionEncryptionPolicy', {
            name: 'vector-collection-encryption-policy',
            type: 'encryption',
            policy: JSON.stringify({
                Rules: [{
                        ResourceType: 'collection',
                        Resource: ['collection/vector-collection']
                    }],
                AWSOwnedKey: true
            })
        });
        const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'VectorCollectionNetworkPolicy', {
            name: 'vector-collection-network-policy',
            type: 'network',
            policy: JSON.stringify([{
                    Rules: [{
                            ResourceType: 'collection',
                            Resource: ['collection/vector-collection']
                        }, {
                            ResourceType: 'dashboard',
                            Resource: ['collection/vector-collection']
                        }],
                    AllowFromPublic: true
                }])
        });
        // Create OpenSearch Serverless collection
        this.vectorCollection = new opensearchserverless.CfnCollection(this, 'VectorCollection', {
            name: 'vector-collection',
            type: 'VECTORSEARCH',
            description: 'Vector collection for CompliAgent-SG document embeddings',
        });
        // Ensure collection is created after security policies
        this.vectorCollection.addDependency(encryptionPolicy);
        this.vectorCollection.addDependency(networkPolicy);
        // Add tags to all resources
        cdk.Tags.of(this).add('Project', 'CompliAgent-SG');
        cdk.Tags.of(this).add('Environment', 'Production');
        cdk.Tags.of(this).add('ManagedBy', 'CDK');
    }
    // Helper method to create IAM roles for Lambda functions
    createLambdaRole(name, policyStatements) {
        return new iam.Role(this, name, {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
            inlinePolicies: {
                [`${name}Policy`]: new iam.PolicyDocument({
                    statements: policyStatements,
                }),
            },
        });
    }
    // Helper method to create Step Functions role
    createStepFunctionsRole() {
        return new iam.Role(this, 'StepFunctionsRole', {
            assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
            inlinePolicies: {
                StepFunctionsPolicy: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                'lambda:InvokeFunction',
                            ],
                            resources: ['arn:aws:lambda:*:*:function:*'],
                        }),
                    ],
                }),
            },
        });
    }
}
exports.CoreInfrastructureStack = CoreInfrastructureStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29yZS1pbmZyYXN0cnVjdHVyZS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvcmUtaW5mcmFzdHJ1Y3R1cmUtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBRW5DLHlDQUF5QztBQUN6QyxxREFBcUQ7QUFDckQsNkVBQTZFO0FBQzdFLDJDQUEyQztBQUMzQywyQ0FBMkM7QUFFM0MsTUFBYSx1QkFBd0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQVVwRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLGdDQUFnQztRQUNoQyxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsMEJBQTBCLEVBQUU7WUFDakUsaUJBQWlCLEVBQUUsSUFBSTtZQUN2QixXQUFXLEVBQUUsdUNBQXVDO1lBQ3BELEtBQUssRUFBRSxzQkFBc0I7U0FDOUIsQ0FBQyxDQUFDO1FBRUgsa0VBQWtFO1FBQ2xFLE1BQU0sU0FBUyxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQztRQUM3QyxNQUFNLE1BQU0sR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUM7UUFFekMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDOUQsVUFBVSxFQUFFLGdCQUFnQixTQUFTLElBQUksTUFBTSxFQUFFO1lBQ2pELFNBQVMsRUFBRSxJQUFJO1lBQ2YsVUFBVSxFQUFFLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHO1lBQ25DLGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYTtZQUNqQyxpQkFBaUIs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LElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLHNCQUFzQixDQUFDO1lBQzNELGNBQWMsRUFBRTtnQkFDZCxtQkFBbUIsRUFBRSxJQUFJLEdBQUcsQ0FBQyxjQUFjLENBQUM7b0JBQzFDLFVBQVUsRUFBRTt3QkFDVixJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7NEJBQ3RCLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUs7NEJBQ3hCLE9BQU8sRUFBRTtnQ0FDUCx1QkFBdUI7NkJBQ3hCOzRCQUNELFNBQVMsRUFBRSxDQUFDLCtCQUErQixDQUFDO3lCQUM3QyxDQUFDO3FCQUNIO2lCQUNGLENBQUM7YUFDSDtTQUNGLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQWhNRCwwREFnTUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIG9wZW5zZWFyY2hzZXJ2ZXJsZXNzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1vcGVuc2VhcmNoc2VydmVybGVzcyc7XG5pbXBvcnQgKiBhcyBrbXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWttcyc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5cbmV4cG9ydCBjbGFzcyBDb3JlSW5mcmFzdHJ1Y3R1cmVTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIC8vIFB1YmxpYyBwcm9wZXJ0aWVzIHRvIGV4cG9zZSByZXNvdXJjZXMgdG8gb3RoZXIgc3RhY2tzXG4gIHB1YmxpYyByZWFkb25seSBtYXNEb2NzUmF3QnVja2V0OiBzMy5CdWNrZXQ7XG4gIHB1YmxpYyByZWFkb25seSBpbnRlcm5hbERvY3NSYXdCdWNrZXQ6IHMzLkJ1Y2tldDtcbiAgcHVibGljIHJlYWRvbmx5IHByb2Nlc3NlZERvY3NKc29uQnVja2V0OiBzMy5CdWNrZXQ7XG4gIHB1YmxpYyByZWFkb25seSBnYXBzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgYW1lbmRtZW50c1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IHZlY3RvckNvbGxlY3Rpb246IG9wZW5zZWFyY2hzZXJ2ZXJsZXNzLkNmbkNvbGxlY3Rpb247XG4gIHB1YmxpYyByZWFkb25seSBlbmNyeXB0aW9uS2V5OiBrbXMuS2V5O1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIENyZWF0ZSBLTVMga2V5IGZvciBlbmNyeXB0aW9uXG4gICAgdGhpcy5lbmNyeXB0aW9uS2V5ID0gbmV3IGttcy5LZXkodGhpcywgJ0NvbXBsaUFnZW50RW5jcnlwdGlvbktleScsIHtcbiAgICAgIGVuYWJsZUtleVJvdGF0aW9uOiB0cnVlLFxuICAgICAgZGVzY3JpcHRpb246ICdLTVMga2V5IGZvciBDb21wbGlBZ2VudC1TRyBlbmNyeXB0aW9uJyxcbiAgICAgIGFsaWFzOiAnYWxpYXMvY29tcGxpYWdlbnQtc2cnLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIFMzIGJ1Y2tldHMgd2l0aCB1bmlxdWUgbmFtZXMgdXNpbmcgYWNjb3VudCBJRCBhbmQgcmVnaW9uXG4gICAgY29uc3QgYWNjb3VudElkID0gY2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnQ7XG4gICAgY29uc3QgcmVnaW9uID0gY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbjtcbiAgICBcbiAgICB0aGlzLm1hc0RvY3NSYXdCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdNYXNEb2NzUmF3QnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYG1hcy1kb2NzLXJhdy0ke2FjY291bnRJZH0tJHtyZWdpb259YCxcbiAgICAgIHZlcnNpb25lZDogdHJ1ZSxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uS01TLFxuICAgICAgZW5jcnlwdGlvbktleTogdGhpcy5lbmNyeXB0aW9uS2V5LFxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbe1xuICAgICAgICBpZDogJ0RlbGV0ZU9sZFZlcnNpb25zJyxcbiAgICAgICAgbm9uY3VycmVudFZlcnNpb25FeHBpcmF0aW9uOiBjZGsuRHVyYXRpb24uZGF5cyg5MCksXG4gICAgICB9XSxcbiAgICB9KTtcblxuICAgIHRoaXMuaW50ZXJuYWxEb2NzUmF3QnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnSW50ZXJuYWxEb2NzUmF3QnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYGludGVybmFsLWRvY3MtcmF3LSR7YWNjb3VudElkfS0ke3JlZ2lvbn1gLFxuICAgICAgdmVyc2lvbmVkOiB0cnVlLFxuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5LTVMsXG4gICAgICBlbmNyeXB0aW9uS2V5OiB0aGlzLmVuY3J5cHRpb25LZXksXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFt7XG4gICAgICAgIGlkOiAnRGVsZXRlT2xkVmVyc2lvbnMnLFxuICAgICAgICBub25jdXJyZW50VmVyc2lvbkV4cGlyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDkwKSxcbiAgICAgIH1dLFxuICAgIH0pO1xuXG4gICAgdGhpcy5wcm9jZXNzZWREb2NzSnNvbkJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ1Byb2Nlc3NlZERvY3NKc29uQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYHByb2Nlc3NlZC1kb2NzLWpzb24tJHthY2NvdW50SWR9LSR7cmVnaW9ufWAsXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLktNUyxcbiAgICAgIGVuY3J5cHRpb25LZXk6IHRoaXMuZW5jcnlwdGlvbktleSxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgICBsaWZlY3ljbGVSdWxlczogW3tcbiAgICAgICAgaWQ6ICdEZWxldGVPbGRQcm9jZXNzZWREb2NzJyxcbiAgICAgICAgZXhwaXJhdGlvbjogY2RrLkR1cmF0aW9uLmRheXMoMzY1KSxcbiAgICAgIH1dLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIER5bmFtb0RCIHRhYmxlc1xuICAgIHRoaXMuZ2Fwc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdHYXBzVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6ICdDb21wbGlBZ2VudC1HYXBzVGFibGUnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnYXBJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkNVU1RPTUVSX01BTkFHRUQsXG4gICAgICBlbmNyeXB0aW9uS2V5OiB0aGlzLmVuY3J5cHRpb25LZXksXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIEdTSSBmb3IgcmVndWxhdGlvbklkIHRvIEdhcHNUYWJsZVxuICAgIHRoaXMuZ2Fwc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ3JlZ3VsYXRpb25JZEluZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAncmVndWxhdGlvbklkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5BTEwsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgR1NJIGZvciBzdGF0dXMgdG8gR2Fwc1RhYmxlXG4gICAgdGhpcy5nYXBzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnc3RhdHVzSW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdzdGF0dXMnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgc29ydEtleTogeyBuYW1lOiAnY3JlYXRlZEF0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5BTEwsXG4gICAgfSk7XG5cbiAgICB0aGlzLmFtZW5kbWVudHNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnQW1lbmRtZW50c1RhYmxlJywge1xuICAgICAgdGFibGVOYW1lOiAnQ29tcGxpQWdlbnQtQW1lbmRtZW50c1RhYmxlJyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnYW1lbmRtZW50SWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIGVuY3J5cHRpb246IGR5bmFtb2RiLlRhYmxlRW5jcnlwdGlvbi5DVVNUT01FUl9NQU5BR0VELFxuICAgICAgZW5jcnlwdGlvbktleTogdGhpcy5lbmNyeXB0aW9uS2V5LFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBHU0kgZm9yIGdhcElkIHRvIEFtZW5kbWVudHNUYWJsZVxuICAgIHRoaXMuYW1lbmRtZW50c1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ2dhcElkSW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdnYXBJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIEdTSSBmb3Igc3RhdHVzIHRvIEFtZW5kbWVudHNUYWJsZVxuICAgIHRoaXMuYW1lbmRtZW50c1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ3N0YXR1c0luZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc3RhdHVzJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2NyZWF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIE9wZW5TZWFyY2ggU2VydmVybGVzcyBzZWN1cml0eSBwb2xpY2llc1xuICAgIGNvbnN0IGVuY3J5cHRpb25Qb2xpY3kgPSBuZXcgb3BlbnNlYXJjaHNlcnZlcmxlc3MuQ2ZuU2VjdXJpdHlQb2xpY3kodGhpcywgJ1ZlY3RvckNvbGxlY3Rpb25FbmNyeXB0aW9uUG9saWN5Jywge1xuICAgICAgbmFtZTogJ3ZlY3Rvci1jb2xsZWN0aW9uLWVuY3J5cHRpb24tcG9saWN5JyxcbiAgICAgIHR5cGU6ICdlbmNyeXB0aW9uJyxcbiAgICAgIHBvbGljeTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBSdWxlczogW3tcbiAgICAgICAgICBSZXNvdXJjZVR5cGU6ICdjb2xsZWN0aW9uJyxcbiAgICAgICAgICBSZXNvdXJjZTogWydjb2xsZWN0aW9uL3ZlY3Rvci1jb2xsZWN0aW9uJ11cbiAgICAgICAgfV0sXG4gICAgICAgIEFXU093bmVkS2V5OiB0cnVlXG4gICAgICB9KVxuICAgIH0pO1xuXG4gICAgY29uc3QgbmV0d29ya1BvbGljeSA9IG5ldyBvcGVuc2VhcmNoc2VydmVybGVzcy5DZm5TZWN1cml0eVBvbGljeSh0aGlzLCAnVmVjdG9yQ29sbGVjdGlvbk5ldHdvcmtQb2xpY3knLCB7XG4gICAgICBuYW1lOiAndmVjdG9yLWNvbGxlY3Rpb24tbmV0d29yay1wb2xpY3knLFxuICAgICAgdHlwZTogJ25ldHdvcmsnLFxuICAgICAgcG9saWN5OiBKU09OLnN0cmluZ2lmeShbe1xuICAgICAgICBSdWxlczogW3tcbiAgICAgICAgICBSZXNvdXJjZVR5cGU6ICdjb2xsZWN0aW9uJyxcbiAgICAgICAgICBSZXNvdXJjZTogWydjb2xsZWN0aW9uL3ZlY3Rvci1jb2xsZWN0aW9uJ11cbiAgICAgICAgfSwge1xuICAgICAgICAgIFJlc291cmNlVHlwZTogJ2Rhc2hib2FyZCcsXG4gICAgICAgICAgUmVzb3VyY2U6IFsnY29sbGVjdGlvbi92ZWN0b3ItY29sbGVjdGlvbiddXG4gICAgICAgIH1dLFxuICAgICAgICBBbGxvd0Zyb21QdWJsaWM6IHRydWVcbiAgICAgIH1dKVxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIE9wZW5TZWFyY2ggU2VydmVybGVzcyBjb2xsZWN0aW9uXG4gICAgdGhpcy52ZWN0b3JDb2xsZWN0aW9uID0gbmV3IG9wZW5zZWFyY2hzZXJ2ZXJsZXNzLkNmbkNvbGxlY3Rpb24odGhpcywgJ1ZlY3RvckNvbGxlY3Rpb24nLCB7XG4gICAgICBuYW1lOiAndmVjdG9yLWNvbGxlY3Rpb24nLFxuICAgICAgdHlwZTogJ1ZFQ1RPUlNFQVJDSCcsXG4gICAgICBkZXNjcmlwdGlvbjogJ1ZlY3RvciBjb2xsZWN0aW9uIGZvciBDb21wbGlBZ2VudC1TRyBkb2N1bWVudCBlbWJlZGRpbmdzJyxcbiAgICB9KTtcblxuICAgIC8vIEVuc3VyZSBjb2xsZWN0aW9uIGlzIGNyZWF0ZWQgYWZ0ZXIgc2VjdXJpdHkgcG9saWNpZXNcbiAgICB0aGlzLnZlY3RvckNvbGxlY3Rpb24uYWRkRGVwZW5kZW5jeShlbmNyeXB0aW9uUG9saWN5KTtcbiAgICB0aGlzLnZlY3RvckNvbGxlY3Rpb24uYWRkRGVwZW5kZW5jeShuZXR3b3JrUG9saWN5KTtcblxuICAgIC8vIEFkZCB0YWdzIHRvIGFsbCByZXNvdXJjZXNcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ1Byb2plY3QnLCAnQ29tcGxpQWdlbnQtU0cnKTtcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ0Vudmlyb25tZW50JywgJ1Byb2R1Y3Rpb24nKTtcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ01hbmFnZWRCeScsICdDREsnKTtcbiAgfVxuXG4gIC8vIEhlbHBlciBtZXRob2QgdG8gY3JlYXRlIElBTSByb2xlcyBmb3IgTGFtYmRhIGZ1bmN0aW9uc1xuICBwdWJsaWMgY3JlYXRlTGFtYmRhUm9sZShuYW1lOiBzdHJpbmcsIHBvbGljeVN0YXRlbWVudHM6IGlhbS5Qb2xpY3lTdGF0ZW1lbnRbXSk6IGlhbS5Sb2xlIHtcbiAgICByZXR1cm4gbmV3IGlhbS5Sb2xlKHRoaXMsIG5hbWUsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgXSxcbiAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgIFtgJHtuYW1lfVBvbGljeWBdOiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICBzdGF0ZW1lbnRzOiBwb2xpY3lTdGF0ZW1lbnRzLFxuICAgICAgICB9KSxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICAvLyBIZWxwZXIgbWV0aG9kIHRvIGNyZWF0ZSBTdGVwIEZ1bmN0aW9ucyByb2xlXG4gIHB1YmxpYyBjcmVhdGVTdGVwRnVuY3Rpb25zUm9sZSgpOiBpYW0uUm9sZSB7XG4gICAgcmV0dXJuIG5ldyBpYW0uUm9sZSh0aGlzLCAnU3RlcEZ1bmN0aW9uc1JvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnc3RhdGVzLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgIFN0ZXBGdW5jdGlvbnNQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgJ2xhbWJkYTpJbnZva2VGdW5jdGlvbicsXG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIHJlc291cmNlczogWydhcm46YXdzOmxhbWJkYToqOio6ZnVuY3Rpb246KiddLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgXSxcbiAgICAgICAgfSksXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG59XG4iXX0=