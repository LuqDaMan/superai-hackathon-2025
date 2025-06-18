"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentProcessingStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const events = require("aws-cdk-lib/aws-events");
const targets = require("aws-cdk-lib/aws-events-targets");
const sns = require("aws-cdk-lib/aws-sns");
const snsSubscriptions = require("aws-cdk-lib/aws-sns-subscriptions");
const s3 = require("aws-cdk-lib/aws-s3");
const s3n = require("aws-cdk-lib/aws-s3-notifications");
const iam = require("aws-cdk-lib/aws-iam");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const opensearchserverless = require("aws-cdk-lib/aws-opensearchserverless");
class DocumentProcessingStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { coreInfrastructure } = props;
        // Create document tracking table
        this.documentTrackingTable = new dynamodb.Table(this, 'DocumentTrackingTable', {
            tableName: 'CompliAgent-DocumentTracking',
            partitionKey: { name: 'document_id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
            encryptionKey: coreInfrastructure.encryptionKey,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            pointInTimeRecovery: true,
        });
        // Add GSI for URL lookups
        this.documentTrackingTable.addGlobalSecondaryIndex({
            indexName: 'urlIndex',
            partitionKey: { name: 'url', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // Create SNS topic for Textract completion notifications
        this.textractCompletionTopic = new sns.Topic(this, 'TextractCompletionTopic', {
            topicName: 'CompliAgent-TextractCompletion',
            displayName: 'Textract Job Completion Notifications',
            masterKey: coreInfrastructure.encryptionKey,
        });
        // Create IAM role for Textract to publish to SNS
        const textractServiceRole = new iam.Role(this, 'TextractServiceRole', {
            assumedBy: new iam.ServicePrincipal('textract.amazonaws.com'),
            inlinePolicies: {
                TextractSNSPolicy: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: ['sns:Publish'],
                            resources: [this.textractCompletionTopic.topicArn],
                        }),
                    ],
                }),
            },
        });
        // Create MAS Monitor Lambda function
        this.masMonitorFunction = new lambda.Function(this, 'MasMonitorFunction', {
            functionName: 'CompliAgent-MasMonitor',
            runtime: lambda.Runtime.PYTHON_3_10,
            handler: 'app.lambda_handler',
            code: lambda.Code.fromAsset('../../src/lambda/mas_monitor'),
            timeout: cdk.Duration.minutes(15),
            memorySize: 512,
            environment: {
                MAS_DOCS_BUCKET: coreInfrastructure.masDocsRawBucket.bucketName,
                TRACKING_TABLE: this.documentTrackingTable.tableName,
            },
            role: new iam.Role(this, 'MasMonitorRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                ],
                inlinePolicies: {
                    MasMonitorPolicy: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    's3:PutObject',
                                    's3:PutObjectAcl',
                                ],
                                resources: [coreInfrastructure.masDocsRawBucket.arnForObjects('*')],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'dynamodb:GetItem',
                                    'dynamodb:PutItem',
                                    'dynamodb:UpdateItem',
                                    'dynamodb:Query',
                                ],
                                resources: [
                                    this.documentTrackingTable.tableArn,
                                    `${this.documentTrackingTable.tableArn}/index/*`,
                                ],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'kms:Decrypt',
                                    'kms:GenerateDataKey',
                                ],
                                resources: [coreInfrastructure.encryptionKey.keyArn],
                            }),
                        ],
                    }),
                },
            }),
        });
        // Create EventBridge rule to trigger MAS monitor daily
        const masMonitorSchedule = new events.Rule(this, 'MasMonitorSchedule', {
            ruleName: 'CompliAgent-MasMonitorSchedule',
            description: 'Daily trigger for MAS document monitoring',
            schedule: events.Schedule.cron({
                minute: '0',
                hour: '9',
                day: '*',
                month: '*',
                year: '*',
            }),
        });
        masMonitorSchedule.addTarget(new targets.LambdaFunction(this.masMonitorFunction));
        // Create Textract Processor Lambda function
        this.textractProcessorFunction = new lambda.Function(this, 'TextractProcessorFunction', {
            functionName: 'CompliAgent-TextractProcessor',
            runtime: lambda.Runtime.PYTHON_3_10,
            handler: 'app.lambda_handler',
            code: lambda.Code.fromAsset('../../src/lambda/textract_processor'),
            timeout: cdk.Duration.minutes(15),
            memorySize: 1024,
            environment: {
                PROCESSED_DOCS_BUCKET: coreInfrastructure.processedDocsJsonBucket.bucketName,
                SNS_TOPIC_ARN: this.textractCompletionTopic.topicArn,
                TEXTRACT_ROLE_ARN: textractServiceRole.roleArn,
            },
            role: new iam.Role(this, 'TextractProcessorRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                ],
                inlinePolicies: {
                    TextractProcessorPolicy: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    's3:GetObject',
                                ],
                                resources: [
                                    coreInfrastructure.masDocsRawBucket.arnForObjects('*'),
                                    coreInfrastructure.internalDocsRawBucket.arnForObjects('*'),
                                ],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    's3:PutObject',
                                ],
                                resources: [coreInfrastructure.processedDocsJsonBucket.arnForObjects('*')],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'textract:StartDocumentAnalysis',
                                    'textract:GetDocumentAnalysis',
                                    'textract:AnalyzeDocument',
                                ],
                                resources: ['*'],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'iam:PassRole',
                                ],
                                resources: [textractServiceRole.roleArn],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'kms:Decrypt',
                                    'kms:GenerateDataKey',
                                ],
                                resources: [coreInfrastructure.encryptionKey.keyArn],
                            }),
                        ],
                    }),
                },
            }),
        });
        // Create Vectorize Content Lambda function
        this.vectorizeContentFunction = new lambda.Function(this, 'VectorizeContentFunction', {
            functionName: 'CompliAgent-VectorizeContent',
            runtime: lambda.Runtime.PYTHON_3_10,
            handler: 'app.lambda_handler',
            code: lambda.Code.fromAsset('../../src/lambda/vectorize_content'),
            timeout: cdk.Duration.minutes(15),
            memorySize: 1024,
            environment: {
                OPENSEARCH_ENDPOINT: `https://${coreInfrastructure.vectorCollection.attrCollectionEndpoint}`,
                OPENSEARCH_INDEX: 'documents',
            },
            role: new iam.Role(this, 'VectorizeContentRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                ],
                inlinePolicies: {
                    VectorizeContentPolicy: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    's3:GetObject',
                                ],
                                resources: [coreInfrastructure.processedDocsJsonBucket.arnForObjects('*')],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'bedrock:InvokeModel',
                                ],
                                resources: ['arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v1'],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'aoss:APIAccessAll',
                                ],
                                resources: [coreInfrastructure.vectorCollection.attrArn],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'kms:Decrypt',
                                ],
                                resources: [coreInfrastructure.encryptionKey.keyArn],
                            }),
                        ],
                    }),
                },
            }),
        });
        // Set up S3 event notifications
        // Trigger Textract processor when new documents are uploaded to MAS docs bucket
        coreInfrastructure.masDocsRawBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(this.textractProcessorFunction), { suffix: '.pdf' });
        coreInfrastructure.internalDocsRawBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(this.textractProcessorFunction), { suffix: '.pdf' });
        // Trigger vectorization when processed documents are uploaded
        coreInfrastructure.processedDocsJsonBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(this.vectorizeContentFunction), { prefix: 'textract-output/', suffix: '.json' });
        // Subscribe Textract processor to SNS topic for job completion notifications
        this.textractCompletionTopic.addSubscription(new snsSubscriptions.LambdaSubscription(this.textractProcessorFunction));
        // Create OpenSearch data access policy for Lambda functions
        const dataAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'VectorCollectionDataAccessPolicy', {
            name: 'vector-collection-data-access-policy',
            type: 'data',
            policy: JSON.stringify([{
                    Rules: [{
                            ResourceType: 'collection',
                            Resource: ['collection/vector-collection'],
                            Permission: [
                                'aoss:CreateCollectionItems',
                                'aoss:DeleteCollectionItems',
                                'aoss:UpdateCollectionItems',
                                'aoss:DescribeCollectionItems'
                            ]
                        }, {
                            ResourceType: 'index',
                            Resource: ['index/vector-collection/*'],
                            Permission: [
                                'aoss:CreateIndex',
                                'aoss:DeleteIndex',
                                'aoss:UpdateIndex',
                                'aoss:DescribeIndex',
                                'aoss:ReadDocument',
                                'aoss:WriteDocument'
                            ]
                        }],
                    Principal: [
                        this.vectorizeContentFunction.role?.roleArn,
                    ].filter(Boolean)
                }])
        });
        // Add tags to all resources
        cdk.Tags.of(this).add('Project', 'CompliAgent-SG');
        cdk.Tags.of(this).add('Environment', 'Production');
        cdk.Tags.of(this).add('ManagedBy', 'CDK');
        cdk.Tags.of(this).add('Component', 'DocumentProcessing');
    }
}
exports.DocumentProcessingStack = DocumentProcessingStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZG9jdW1lbnQtcHJvY2Vzc2luZy1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImRvY3VtZW50LXByb2Nlc3Npbmctc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBRW5DLGlEQUFpRDtBQUNqRCxpREFBaUQ7QUFDakQsMERBQTBEO0FBQzFELDJDQUEyQztBQUMzQyxzRUFBc0U7QUFDdEUseUNBQXlDO0FBQ3pDLHdEQUF3RDtBQUN4RCwyQ0FBMkM7QUFDM0MscURBQXFEO0FBQ3JELDZFQUE2RTtBQU83RSxNQUFhLHVCQUF3QixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBT3BELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBbUM7UUFDM0UsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLGtCQUFrQixFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRXJDLGlDQUFpQztRQUNqQyxJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUM3RSxTQUFTLEVBQUUsOEJBQThCO1lBQ3pDLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFO1lBQzFFLFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsVUFBVSxFQUFFLFFBQVEsQ0FBQyxlQUFlLENBQUMsZ0JBQWdCO1lBQ3JELGFBQWEsRUFBRSxrQkFBa0IsQ0FBQyxhQUFhO1lBQy9DLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU07WUFDdkMsbUJBQW1CLEVBQUUsSUFBSTtTQUMxQixDQUFDLENBQUM7UUFFSCwwQkFBMEI7UUFDMUIsSUFBSSxDQUFDLHFCQUFxQixDQUFDLHVCQUF1QixDQUFDO1lBQ2pELFNBQVMs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QUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDMUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO0lBQzNELENBQUM7Q0FDRjtBQXJURCwwREFxVEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XG5pbXBvcnQgKiBhcyB0YXJnZXRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMtdGFyZ2V0cyc7XG5pbXBvcnQgKiBhcyBzbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XG5pbXBvcnQgKiBhcyBzbnNTdWJzY3JpcHRpb25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMtc3Vic2NyaXB0aW9ucyc7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgczNuIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1ub3RpZmljYXRpb25zJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XG5pbXBvcnQgKiBhcyBvcGVuc2VhcmNoc2VydmVybGVzcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtb3BlbnNlYXJjaHNlcnZlcmxlc3MnO1xuaW1wb3J0IHsgQ29yZUluZnJhc3RydWN0dXJlU3RhY2sgfSBmcm9tICcuL2NvcmUtaW5mcmFzdHJ1Y3R1cmUtc3RhY2snO1xuXG5leHBvcnQgaW50ZXJmYWNlIERvY3VtZW50UHJvY2Vzc2luZ1N0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGNvcmVJbmZyYXN0cnVjdHVyZTogQ29yZUluZnJhc3RydWN0dXJlU3RhY2s7XG59XG5cbmV4cG9ydCBjbGFzcyBEb2N1bWVudFByb2Nlc3NpbmdTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBtYXNNb25pdG9yRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcbiAgcHVibGljIHJlYWRvbmx5IHRleHRyYWN0UHJvY2Vzc29yRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcbiAgcHVibGljIHJlYWRvbmx5IHZlY3Rvcml6ZUNvbnRlbnRGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uO1xuICBwdWJsaWMgcmVhZG9ubHkgdGV4dHJhY3RDb21wbGV0aW9uVG9waWM6IHNucy5Ub3BpYztcbiAgcHVibGljIHJlYWRvbmx5IGRvY3VtZW50VHJhY2tpbmdUYWJsZTogZHluYW1vZGIuVGFibGU7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IERvY3VtZW50UHJvY2Vzc2luZ1N0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgY29yZUluZnJhc3RydWN0dXJlIH0gPSBwcm9wcztcblxuICAgIC8vIENyZWF0ZSBkb2N1bWVudCB0cmFja2luZyB0YWJsZVxuICAgIHRoaXMuZG9jdW1lbnRUcmFja2luZ1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdEb2N1bWVudFRyYWNraW5nVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6ICdDb21wbGlBZ2VudC1Eb2N1bWVudFRyYWNraW5nJyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZG9jdW1lbnRfaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIGVuY3J5cHRpb246IGR5bmFtb2RiLlRhYmxlRW5jcnlwdGlvbi5DVVNUT01FUl9NQU5BR0VELFxuICAgICAgZW5jcnlwdGlvbktleTogY29yZUluZnJhc3RydWN0dXJlLmVuY3J5cHRpb25LZXksXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIEdTSSBmb3IgVVJMIGxvb2t1cHNcbiAgICB0aGlzLmRvY3VtZW50VHJhY2tpbmdUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICd1cmxJbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3VybCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIFNOUyB0b3BpYyBmb3IgVGV4dHJhY3QgY29tcGxldGlvbiBub3RpZmljYXRpb25zXG4gICAgdGhpcy50ZXh0cmFjdENvbXBsZXRpb25Ub3BpYyA9IG5ldyBzbnMuVG9waWModGhpcywgJ1RleHRyYWN0Q29tcGxldGlvblRvcGljJywge1xuICAgICAgdG9waWNOYW1lOiAnQ29tcGxpQWdlbnQtVGV4dHJhY3RDb21wbGV0aW9uJyxcbiAgICAgIGRpc3BsYXlOYW1lOiAnVGV4dHJhY3QgSm9iIENvbXBsZXRpb24gTm90aWZpY2F0aW9ucycsXG4gICAgICBtYXN0ZXJLZXk6IGNvcmVJbmZyYXN0cnVjdHVyZS5lbmNyeXB0aW9uS2V5LFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIElBTSByb2xlIGZvciBUZXh0cmFjdCB0byBwdWJsaXNoIHRvIFNOU1xuICAgIGNvbnN0IHRleHRyYWN0U2VydmljZVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1RleHRyYWN0U2VydmljZVJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgndGV4dHJhY3QuYW1hem9uYXdzLmNvbScpLFxuICAgICAgaW5saW5lUG9saWNpZXM6IHtcbiAgICAgICAgVGV4dHJhY3RTTlNQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICBhY3Rpb25zOiBbJ3NuczpQdWJsaXNoJ10sXG4gICAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMudGV4dHJhY3RDb21wbGV0aW9uVG9waWMudG9waWNBcm5dLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgXSxcbiAgICAgICAgfSksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIE1BUyBNb25pdG9yIExhbWJkYSBmdW5jdGlvblxuICAgIHRoaXMubWFzTW9uaXRvckZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnTWFzTW9uaXRvckZ1bmN0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiAnQ29tcGxpQWdlbnQtTWFzTW9uaXRvcicsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMCxcbiAgICAgIGhhbmRsZXI6ICdhcHAubGFtYmRhX2hhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi8uLi9zcmMvbGFtYmRhL21hc19tb25pdG9yJyksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBNQVNfRE9DU19CVUNLRVQ6IGNvcmVJbmZyYXN0cnVjdHVyZS5tYXNEb2NzUmF3QnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgIFRSQUNLSU5HX1RBQkxFOiB0aGlzLmRvY3VtZW50VHJhY2tpbmdUYWJsZS50YWJsZU5hbWUsXG4gICAgICB9LFxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdNYXNNb25pdG9yUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgICBdLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIE1hc01vbml0b3JQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgICdzMzpQdXRPYmplY3QnLFxuICAgICAgICAgICAgICAgICAgJ3MzOlB1dE9iamVjdEFjbCcsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtjb3JlSW5mcmFzdHJ1Y3R1cmUubWFzRG9jc1Jhd0J1Y2tldC5hcm5Gb3JPYmplY3RzKCcqJyldLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6R2V0SXRlbScsXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6UHV0SXRlbScsXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6VXBkYXRlSXRlbScsXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6UXVlcnknLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgICAgICAgICB0aGlzLmRvY3VtZW50VHJhY2tpbmdUYWJsZS50YWJsZUFybixcbiAgICAgICAgICAgICAgICAgIGAke3RoaXMuZG9jdW1lbnRUcmFja2luZ1RhYmxlLnRhYmxlQXJufS9pbmRleC8qYCxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAna21zOkRlY3J5cHQnLFxuICAgICAgICAgICAgICAgICAgJ2ttczpHZW5lcmF0ZURhdGFLZXknLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbY29yZUluZnJhc3RydWN0dXJlLmVuY3J5cHRpb25LZXkua2V5QXJuXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgRXZlbnRCcmlkZ2UgcnVsZSB0byB0cmlnZ2VyIE1BUyBtb25pdG9yIGRhaWx5XG4gICAgY29uc3QgbWFzTW9uaXRvclNjaGVkdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdNYXNNb25pdG9yU2NoZWR1bGUnLCB7XG4gICAgICBydWxlTmFtZTogJ0NvbXBsaUFnZW50LU1hc01vbml0b3JTY2hlZHVsZScsXG4gICAgICBkZXNjcmlwdGlvbjogJ0RhaWx5IHRyaWdnZXIgZm9yIE1BUyBkb2N1bWVudCBtb25pdG9yaW5nJyxcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuY3Jvbih7XG4gICAgICAgIG1pbnV0ZTogJzAnLFxuICAgICAgICBob3VyOiAnOScsIC8vIDkgQU0gVVRDIGRhaWx5XG4gICAgICAgIGRheTogJyonLFxuICAgICAgICBtb250aDogJyonLFxuICAgICAgICB5ZWFyOiAnKicsXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIG1hc01vbml0b3JTY2hlZHVsZS5hZGRUYXJnZXQobmV3IHRhcmdldHMuTGFtYmRhRnVuY3Rpb24odGhpcy5tYXNNb25pdG9yRnVuY3Rpb24pKTtcblxuICAgIC8vIENyZWF0ZSBUZXh0cmFjdCBQcm9jZXNzb3IgTGFtYmRhIGZ1bmN0aW9uXG4gICAgdGhpcy50ZXh0cmFjdFByb2Nlc3NvckZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnVGV4dHJhY3RQcm9jZXNzb3JGdW5jdGlvbicsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ0NvbXBsaUFnZW50LVRleHRyYWN0UHJvY2Vzc29yJyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzEwLFxuICAgICAgaGFuZGxlcjogJ2FwcC5sYW1iZGFfaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uLy4uL3NyYy9sYW1iZGEvdGV4dHJhY3RfcHJvY2Vzc29yJyksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgICBtZW1vcnlTaXplOiAxMDI0LFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgUFJPQ0VTU0VEX0RPQ1NfQlVDS0VUOiBjb3JlSW5mcmFzdHJ1Y3R1cmUucHJvY2Vzc2VkRG9jc0pzb25CdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgU05TX1RPUElDX0FSTjogdGhpcy50ZXh0cmFjdENvbXBsZXRpb25Ub3BpYy50b3BpY0FybixcbiAgICAgICAgVEVYVFJBQ1RfUk9MRV9BUk46IHRleHRyYWN0U2VydmljZVJvbGUucm9sZUFybixcbiAgICAgIH0sXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ1RleHRyYWN0UHJvY2Vzc29yUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgICBdLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIFRleHRyYWN0UHJvY2Vzc29yUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAnczM6R2V0T2JqZWN0JyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgICAgICAgICAgY29yZUluZnJhc3RydWN0dXJlLm1hc0RvY3NSYXdCdWNrZXQuYXJuRm9yT2JqZWN0cygnKicpLFxuICAgICAgICAgICAgICAgICAgY29yZUluZnJhc3RydWN0dXJlLmludGVybmFsRG9jc1Jhd0J1Y2tldC5hcm5Gb3JPYmplY3RzKCcqJyksXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ3MzOlB1dE9iamVjdCcsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtjb3JlSW5mcmFzdHJ1Y3R1cmUucHJvY2Vzc2VkRG9jc0pzb25CdWNrZXQuYXJuRm9yT2JqZWN0cygnKicpXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ3RleHRyYWN0OlN0YXJ0RG9jdW1lbnRBbmFseXNpcycsXG4gICAgICAgICAgICAgICAgICAndGV4dHJhY3Q6R2V0RG9jdW1lbnRBbmFseXNpcycsXG4gICAgICAgICAgICAgICAgICAndGV4dHJhY3Q6QW5hbHl6ZURvY3VtZW50JyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgICdpYW06UGFzc1JvbGUnLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbdGV4dHJhY3RTZXJ2aWNlUm9sZS5yb2xlQXJuXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ2ttczpEZWNyeXB0JyxcbiAgICAgICAgICAgICAgICAgICdrbXM6R2VuZXJhdGVEYXRhS2V5JyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW2NvcmVJbmZyYXN0cnVjdHVyZS5lbmNyeXB0aW9uS2V5LmtleUFybl0sXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIFZlY3Rvcml6ZSBDb250ZW50IExhbWJkYSBmdW5jdGlvblxuICAgIHRoaXMudmVjdG9yaXplQ29udGVudEZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnVmVjdG9yaXplQ29udGVudEZ1bmN0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiAnQ29tcGxpQWdlbnQtVmVjdG9yaXplQ29udGVudCcsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMCxcbiAgICAgIGhhbmRsZXI6ICdhcHAubGFtYmRhX2hhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi8uLi9zcmMvbGFtYmRhL3ZlY3Rvcml6ZV9jb250ZW50JyksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgICBtZW1vcnlTaXplOiAxMDI0LFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgT1BFTlNFQVJDSF9FTkRQT0lOVDogYGh0dHBzOi8vJHtjb3JlSW5mcmFzdHJ1Y3R1cmUudmVjdG9yQ29sbGVjdGlvbi5hdHRyQ29sbGVjdGlvbkVuZHBvaW50fWAsXG4gICAgICAgIE9QRU5TRUFSQ0hfSU5ERVg6ICdkb2N1bWVudHMnLFxuICAgICAgfSxcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnVmVjdG9yaXplQ29udGVudFJvbGUnLCB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgICAgXSxcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcbiAgICAgICAgICBWZWN0b3JpemVDb250ZW50UG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAnczM6R2V0T2JqZWN0JyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW2NvcmVJbmZyYXN0cnVjdHVyZS5wcm9jZXNzZWREb2NzSnNvbkJ1Y2tldC5hcm5Gb3JPYmplY3RzKCcqJyldLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAnYmVkcm9jazpJbnZva2VNb2RlbCcsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnYXJuOmF3czpiZWRyb2NrOio6OmZvdW5kYXRpb24tbW9kZWwvYW1hem9uLnRpdGFuLWVtYmVkLXRleHQtdjEnXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ2Fvc3M6QVBJQWNjZXNzQWxsJyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW2NvcmVJbmZyYXN0cnVjdHVyZS52ZWN0b3JDb2xsZWN0aW9uLmF0dHJBcm5dLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAna21zOkRlY3J5cHQnLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbY29yZUluZnJhc3RydWN0dXJlLmVuY3J5cHRpb25LZXkua2V5QXJuXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICAvLyBTZXQgdXAgUzMgZXZlbnQgbm90aWZpY2F0aW9uc1xuICAgIC8vIFRyaWdnZXIgVGV4dHJhY3QgcHJvY2Vzc29yIHdoZW4gbmV3IGRvY3VtZW50cyBhcmUgdXBsb2FkZWQgdG8gTUFTIGRvY3MgYnVja2V0XG4gICAgY29yZUluZnJhc3RydWN0dXJlLm1hc0RvY3NSYXdCdWNrZXQuYWRkRXZlbnROb3RpZmljYXRpb24oXG4gICAgICBzMy5FdmVudFR5cGUuT0JKRUNUX0NSRUFURUQsXG4gICAgICBuZXcgczNuLkxhbWJkYURlc3RpbmF0aW9uKHRoaXMudGV4dHJhY3RQcm9jZXNzb3JGdW5jdGlvbiksXG4gICAgICB7IHN1ZmZpeDogJy5wZGYnIH1cbiAgICApO1xuXG4gICAgY29yZUluZnJhc3RydWN0dXJlLmludGVybmFsRG9jc1Jhd0J1Y2tldC5hZGRFdmVudE5vdGlmaWNhdGlvbihcbiAgICAgIHMzLkV2ZW50VHlwZS5PQkpFQ1RfQ1JFQVRFRCxcbiAgICAgIG5ldyBzM24uTGFtYmRhRGVzdGluYXRpb24odGhpcy50ZXh0cmFjdFByb2Nlc3NvckZ1bmN0aW9uKSxcbiAgICAgIHsgc3VmZml4OiAnLnBkZicgfVxuICAgICk7XG5cbiAgICAvLyBUcmlnZ2VyIHZlY3Rvcml6YXRpb24gd2hlbiBwcm9jZXNzZWQgZG9jdW1lbnRzIGFyZSB1cGxvYWRlZFxuICAgIGNvcmVJbmZyYXN0cnVjdHVyZS5wcm9jZXNzZWREb2NzSnNvbkJ1Y2tldC5hZGRFdmVudE5vdGlmaWNhdGlvbihcbiAgICAgIHMzLkV2ZW50VHlwZS5PQkpFQ1RfQ1JFQVRFRCxcbiAgICAgIG5ldyBzM24uTGFtYmRhRGVzdGluYXRpb24odGhpcy52ZWN0b3JpemVDb250ZW50RnVuY3Rpb24pLFxuICAgICAgeyBwcmVmaXg6ICd0ZXh0cmFjdC1vdXRwdXQvJywgc3VmZml4OiAnLmpzb24nIH1cbiAgICApO1xuXG4gICAgLy8gU3Vic2NyaWJlIFRleHRyYWN0IHByb2Nlc3NvciB0byBTTlMgdG9waWMgZm9yIGpvYiBjb21wbGV0aW9uIG5vdGlmaWNhdGlvbnNcbiAgICB0aGlzLnRleHRyYWN0Q29tcGxldGlvblRvcGljLmFkZFN1YnNjcmlwdGlvbihcbiAgICAgIG5ldyBzbnNTdWJzY3JpcHRpb25zLkxhbWJkYVN1YnNjcmlwdGlvbih0aGlzLnRleHRyYWN0UHJvY2Vzc29yRnVuY3Rpb24pXG4gICAgKTtcblxuICAgIC8vIENyZWF0ZSBPcGVuU2VhcmNoIGRhdGEgYWNjZXNzIHBvbGljeSBmb3IgTGFtYmRhIGZ1bmN0aW9uc1xuICAgIGNvbnN0IGRhdGFBY2Nlc3NQb2xpY3kgPSBuZXcgb3BlbnNlYXJjaHNlcnZlcmxlc3MuQ2ZuQWNjZXNzUG9saWN5KHRoaXMsICdWZWN0b3JDb2xsZWN0aW9uRGF0YUFjY2Vzc1BvbGljeScsIHtcbiAgICAgIG5hbWU6ICd2ZWN0b3ItY29sbGVjdGlvbi1kYXRhLWFjY2Vzcy1wb2xpY3knLFxuICAgICAgdHlwZTogJ2RhdGEnLFxuICAgICAgcG9saWN5OiBKU09OLnN0cmluZ2lmeShbe1xuICAgICAgICBSdWxlczogW3tcbiAgICAgICAgICBSZXNvdXJjZVR5cGU6ICdjb2xsZWN0aW9uJyxcbiAgICAgICAgICBSZXNvdXJjZTogWydjb2xsZWN0aW9uL3ZlY3Rvci1jb2xsZWN0aW9uJ10sXG4gICAgICAgICAgUGVybWlzc2lvbjogW1xuICAgICAgICAgICAgJ2Fvc3M6Q3JlYXRlQ29sbGVjdGlvbkl0ZW1zJyxcbiAgICAgICAgICAgICdhb3NzOkRlbGV0ZUNvbGxlY3Rpb25JdGVtcycsXG4gICAgICAgICAgICAnYW9zczpVcGRhdGVDb2xsZWN0aW9uSXRlbXMnLFxuICAgICAgICAgICAgJ2Fvc3M6RGVzY3JpYmVDb2xsZWN0aW9uSXRlbXMnXG4gICAgICAgICAgXVxuICAgICAgICB9LCB7XG4gICAgICAgICAgUmVzb3VyY2VUeXBlOiAnaW5kZXgnLFxuICAgICAgICAgIFJlc291cmNlOiBbJ2luZGV4L3ZlY3Rvci1jb2xsZWN0aW9uLyonXSxcbiAgICAgICAgICBQZXJtaXNzaW9uOiBbXG4gICAgICAgICAgICAnYW9zczpDcmVhdGVJbmRleCcsXG4gICAgICAgICAgICAnYW9zczpEZWxldGVJbmRleCcsXG4gICAgICAgICAgICAnYW9zczpVcGRhdGVJbmRleCcsXG4gICAgICAgICAgICAnYW9zczpEZXNjcmliZUluZGV4JyxcbiAgICAgICAgICAgICdhb3NzOlJlYWREb2N1bWVudCcsXG4gICAgICAgICAgICAnYW9zczpXcml0ZURvY3VtZW50J1xuICAgICAgICAgIF1cbiAgICAgICAgfV0sXG4gICAgICAgIFByaW5jaXBhbDogW1xuICAgICAgICAgIHRoaXMudmVjdG9yaXplQ29udGVudEZ1bmN0aW9uLnJvbGU/LnJvbGVBcm4sXG4gICAgICAgIF0uZmlsdGVyKEJvb2xlYW4pXG4gICAgICB9XSlcbiAgICB9KTtcblxuICAgIC8vIEFkZCB0YWdzIHRvIGFsbCByZXNvdXJjZXNcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ1Byb2plY3QnLCAnQ29tcGxpQWdlbnQtU0cnKTtcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ0Vudmlyb25tZW50JywgJ1Byb2R1Y3Rpb24nKTtcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ01hbmFnZWRCeScsICdDREsnKTtcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ0NvbXBvbmVudCcsICdEb2N1bWVudFByb2Nlc3NpbmcnKTtcbiAgfVxufVxuIl19