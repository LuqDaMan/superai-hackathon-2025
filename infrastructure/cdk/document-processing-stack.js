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
        const dataAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'VectorCAPolicy', {
            name: 'vector-ca-policy',
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZG9jdW1lbnQtcHJvY2Vzc2luZy1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImRvY3VtZW50LXByb2Nlc3Npbmctc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBRW5DLGlEQUFpRDtBQUNqRCxpREFBaUQ7QUFDakQsMERBQTBEO0FBQzFELDJDQUEyQztBQUMzQyxzRUFBc0U7QUFDdEUseUNBQXlDO0FBQ3pDLHdEQUF3RDtBQUN4RCwyQ0FBMkM7QUFDM0MscURBQXFEO0FBQ3JELDZFQUE2RTtBQU83RSxNQUFhLHVCQUF3QixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBT3BELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBbUM7UUFDM0UsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLGtCQUFrQixFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRXJDLGlDQUFpQztRQUNqQyxJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUM3RSxTQUFTLEVBQUUsOEJBQThCO1lBQ3pDLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFO1lBQzFFLFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsVUFBVSxFQUFFLFFBQVEsQ0FBQyxlQUFlLENBQUMsZ0JBQWdCO1lBQ3JELGFBQWEsRUFBRSxrQkFBa0IsQ0FBQyxhQUFhO1lBQy9DLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU07WUFDdkMsbUJBQW1CLEVBQUUsSUFBSTtTQUMxQixDQUFDLENBQUM7UUFFSCwwQkFBMEI7UUFDMUIsSUFBSSxDQUFDLHFCQUFxQixDQUFDLHVCQUF1QixDQUFDO1lBQ2pELFNBQVMs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QUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDMUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO0lBQzNELENBQUM7Q0FDRjtBQXJURCwwREFxVEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XHJcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcclxuaW1wb3J0ICogYXMgc25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xyXG5pbXBvcnQgKiBhcyBzbnNTdWJzY3JpcHRpb25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMtc3Vic2NyaXB0aW9ucyc7XHJcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XHJcbmltcG9ydCAqIGFzIHMzbiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMtbm90aWZpY2F0aW9ucyc7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcclxuaW1wb3J0ICogYXMgb3BlbnNlYXJjaHNlcnZlcmxlc3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLW9wZW5zZWFyY2hzZXJ2ZXJsZXNzJztcclxuaW1wb3J0IHsgQ29yZUluZnJhc3RydWN0dXJlU3RhY2sgfSBmcm9tICcuL2NvcmUtaW5mcmFzdHJ1Y3R1cmUtc3RhY2snO1xyXG5cclxuZXhwb3J0IGludGVyZmFjZSBEb2N1bWVudFByb2Nlc3NpbmdTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xyXG4gIGNvcmVJbmZyYXN0cnVjdHVyZTogQ29yZUluZnJhc3RydWN0dXJlU3RhY2s7XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBEb2N1bWVudFByb2Nlc3NpbmdTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XHJcbiAgcHVibGljIHJlYWRvbmx5IG1hc01vbml0b3JGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uO1xyXG4gIHB1YmxpYyByZWFkb25seSB0ZXh0cmFjdFByb2Nlc3NvckZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XHJcbiAgcHVibGljIHJlYWRvbmx5IHZlY3Rvcml6ZUNvbnRlbnRGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uO1xyXG4gIHB1YmxpYyByZWFkb25seSB0ZXh0cmFjdENvbXBsZXRpb25Ub3BpYzogc25zLlRvcGljO1xyXG4gIHB1YmxpYyByZWFkb25seSBkb2N1bWVudFRyYWNraW5nVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xyXG5cclxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogRG9jdW1lbnRQcm9jZXNzaW5nU3RhY2tQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XHJcblxyXG4gICAgY29uc3QgeyBjb3JlSW5mcmFzdHJ1Y3R1cmUgfSA9IHByb3BzO1xyXG5cclxuICAgIC8vIENyZWF0ZSBkb2N1bWVudCB0cmFja2luZyB0YWJsZVxyXG4gICAgdGhpcy5kb2N1bWVudFRyYWNraW5nVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ0RvY3VtZW50VHJhY2tpbmdUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiAnQ29tcGxpQWdlbnQtRG9jdW1lbnRUcmFja2luZycsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZG9jdW1lbnRfaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQ1VTVE9NRVJfTUFOQUdFRCxcclxuICAgICAgZW5jcnlwdGlvbktleTogY29yZUluZnJhc3RydWN0dXJlLmVuY3J5cHRpb25LZXksXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFkZCBHU0kgZm9yIFVSTCBsb29rdXBzXHJcbiAgICB0aGlzLmRvY3VtZW50VHJhY2tpbmdUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ3VybEluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICd1cmwnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIFNOUyB0b3BpYyBmb3IgVGV4dHJhY3QgY29tcGxldGlvbiBub3RpZmljYXRpb25zXHJcbiAgICB0aGlzLnRleHRyYWN0Q29tcGxldGlvblRvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAnVGV4dHJhY3RDb21wbGV0aW9uVG9waWMnLCB7XHJcbiAgICAgIHRvcGljTmFtZTogJ0NvbXBsaUFnZW50LVRleHRyYWN0Q29tcGxldGlvbicsXHJcbiAgICAgIGRpc3BsYXlOYW1lOiAnVGV4dHJhY3QgSm9iIENvbXBsZXRpb24gTm90aWZpY2F0aW9ucycsXHJcbiAgICAgIG1hc3RlcktleTogY29yZUluZnJhc3RydWN0dXJlLmVuY3J5cHRpb25LZXksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgSUFNIHJvbGUgZm9yIFRleHRyYWN0IHRvIHB1Ymxpc2ggdG8gU05TXHJcbiAgICBjb25zdCB0ZXh0cmFjdFNlcnZpY2VSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdUZXh0cmFjdFNlcnZpY2VSb2xlJywge1xyXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgndGV4dHJhY3QuYW1hem9uYXdzLmNvbScpLFxyXG4gICAgICBpbmxpbmVQb2xpY2llczoge1xyXG4gICAgICAgIFRleHRyYWN0U05TUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgICAgIHN0YXRlbWVudHM6IFtcclxuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICBhY3Rpb25zOiBbJ3NuczpQdWJsaXNoJ10sXHJcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy50ZXh0cmFjdENvbXBsZXRpb25Ub3BpYy50b3BpY0Fybl0sXHJcbiAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgXSxcclxuICAgICAgICB9KSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBNQVMgTW9uaXRvciBMYW1iZGEgZnVuY3Rpb25cclxuICAgIHRoaXMubWFzTW9uaXRvckZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnTWFzTW9uaXRvckZ1bmN0aW9uJywge1xyXG4gICAgICBmdW5jdGlvbk5hbWU6ICdDb21wbGlBZ2VudC1NYXNNb25pdG9yJyxcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfMTAsXHJcbiAgICAgIGhhbmRsZXI6ICdhcHAubGFtYmRhX2hhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uLy4uL3NyYy9sYW1iZGEvbWFzX21vbml0b3InKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxyXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgTUFTX0RPQ1NfQlVDS0VUOiBjb3JlSW5mcmFzdHJ1Y3R1cmUubWFzRG9jc1Jhd0J1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICAgIFRSQUNLSU5HX1RBQkxFOiB0aGlzLmRvY3VtZW50VHJhY2tpbmdUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgIH0sXHJcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnTWFzTW9uaXRvclJvbGUnLCB7XHJcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXHJcbiAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXHJcbiAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKSxcclxuICAgICAgICBdLFxyXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XHJcbiAgICAgICAgICBNYXNNb25pdG9yUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgICAgICAgc3RhdGVtZW50czogW1xyXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgICAgJ3MzOlB1dE9iamVjdCcsXHJcbiAgICAgICAgICAgICAgICAgICdzMzpQdXRPYmplY3RBY2wnLFxyXG4gICAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW2NvcmVJbmZyYXN0cnVjdHVyZS5tYXNEb2NzUmF3QnVja2V0LmFybkZvck9iamVjdHMoJyonKV0sXHJcbiAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6R2V0SXRlbScsXHJcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpQdXRJdGVtJyxcclxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlVwZGF0ZUl0ZW0nLFxyXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6UXVlcnknLFxyXG4gICAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW1xyXG4gICAgICAgICAgICAgICAgICB0aGlzLmRvY3VtZW50VHJhY2tpbmdUYWJsZS50YWJsZUFybixcclxuICAgICAgICAgICAgICAgICAgYCR7dGhpcy5kb2N1bWVudFRyYWNraW5nVGFibGUudGFibGVBcm59L2luZGV4LypgLFxyXG4gICAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAgICdrbXM6RGVjcnlwdCcsXHJcbiAgICAgICAgICAgICAgICAgICdrbXM6R2VuZXJhdGVEYXRhS2V5JyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtjb3JlSW5mcmFzdHJ1Y3R1cmUuZW5jcnlwdGlvbktleS5rZXlBcm5dLFxyXG4gICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICBdLFxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgfSxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgRXZlbnRCcmlkZ2UgcnVsZSB0byB0cmlnZ2VyIE1BUyBtb25pdG9yIGRhaWx5XHJcbiAgICBjb25zdCBtYXNNb25pdG9yU2NoZWR1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ01hc01vbml0b3JTY2hlZHVsZScsIHtcclxuICAgICAgcnVsZU5hbWU6ICdDb21wbGlBZ2VudC1NYXNNb25pdG9yU2NoZWR1bGUnLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0RhaWx5IHRyaWdnZXIgZm9yIE1BUyBkb2N1bWVudCBtb25pdG9yaW5nJyxcclxuICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5jcm9uKHtcclxuICAgICAgICBtaW51dGU6ICcwJyxcclxuICAgICAgICBob3VyOiAnOScsIC8vIDkgQU0gVVRDIGRhaWx5XHJcbiAgICAgICAgZGF5OiAnKicsXHJcbiAgICAgICAgbW9udGg6ICcqJyxcclxuICAgICAgICB5ZWFyOiAnKicsXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbWFzTW9uaXRvclNjaGVkdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbih0aGlzLm1hc01vbml0b3JGdW5jdGlvbikpO1xyXG5cclxuICAgIC8vIENyZWF0ZSBUZXh0cmFjdCBQcm9jZXNzb3IgTGFtYmRhIGZ1bmN0aW9uXHJcbiAgICB0aGlzLnRleHRyYWN0UHJvY2Vzc29yRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdUZXh0cmFjdFByb2Nlc3NvckZ1bmN0aW9uJywge1xyXG4gICAgICBmdW5jdGlvbk5hbWU6ICdDb21wbGlBZ2VudC1UZXh0cmFjdFByb2Nlc3NvcicsXHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzEwLFxyXG4gICAgICBoYW5kbGVyOiAnYXBwLmxhbWJkYV9oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi8uLi9zcmMvbGFtYmRhL3RleHRyYWN0X3Byb2Nlc3NvcicpLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXHJcbiAgICAgIG1lbW9yeVNpemU6IDEwMjQsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgUFJPQ0VTU0VEX0RPQ1NfQlVDS0VUOiBjb3JlSW5mcmFzdHJ1Y3R1cmUucHJvY2Vzc2VkRG9jc0pzb25CdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgICBTTlNfVE9QSUNfQVJOOiB0aGlzLnRleHRyYWN0Q29tcGxldGlvblRvcGljLnRvcGljQXJuLFxyXG4gICAgICAgIFRFWFRSQUNUX1JPTEVfQVJOOiB0ZXh0cmFjdFNlcnZpY2VSb2xlLnJvbGVBcm4sXHJcbiAgICAgIH0sXHJcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnVGV4dHJhY3RQcm9jZXNzb3JSb2xlJywge1xyXG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxyXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xyXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXHJcbiAgICAgICAgXSxcclxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xyXG4gICAgICAgICAgVGV4dHJhY3RQcm9jZXNzb3JQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xyXG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXHJcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgICAnczM6R2V0T2JqZWN0JyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcclxuICAgICAgICAgICAgICAgICAgY29yZUluZnJhc3RydWN0dXJlLm1hc0RvY3NSYXdCdWNrZXQuYXJuRm9yT2JqZWN0cygnKicpLFxyXG4gICAgICAgICAgICAgICAgICBjb3JlSW5mcmFzdHJ1Y3R1cmUuaW50ZXJuYWxEb2NzUmF3QnVja2V0LmFybkZvck9iamVjdHMoJyonKSxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgICAnczM6UHV0T2JqZWN0JyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtjb3JlSW5mcmFzdHJ1Y3R1cmUucHJvY2Vzc2VkRG9jc0pzb25CdWNrZXQuYXJuRm9yT2JqZWN0cygnKicpXSxcclxuICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAgICd0ZXh0cmFjdDpTdGFydERvY3VtZW50QW5hbHlzaXMnLFxyXG4gICAgICAgICAgICAgICAgICAndGV4dHJhY3Q6R2V0RG9jdW1lbnRBbmFseXNpcycsXHJcbiAgICAgICAgICAgICAgICAgICd0ZXh0cmFjdDpBbmFseXplRG9jdW1lbnQnLFxyXG4gICAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWycqJ10sXHJcbiAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgICAnaWFtOlBhc3NSb2xlJyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFt0ZXh0cmFjdFNlcnZpY2VSb2xlLnJvbGVBcm5dLFxyXG4gICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgICAgJ2ttczpEZWNyeXB0JyxcclxuICAgICAgICAgICAgICAgICAgJ2ttczpHZW5lcmF0ZURhdGFLZXknLFxyXG4gICAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW2NvcmVJbmZyYXN0cnVjdHVyZS5lbmNyeXB0aW9uS2V5LmtleUFybl0sXHJcbiAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICB9LFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBWZWN0b3JpemUgQ29udGVudCBMYW1iZGEgZnVuY3Rpb25cclxuICAgIHRoaXMudmVjdG9yaXplQ29udGVudEZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnVmVjdG9yaXplQ29udGVudEZ1bmN0aW9uJywge1xyXG4gICAgICBmdW5jdGlvbk5hbWU6ICdDb21wbGlBZ2VudC1WZWN0b3JpemVDb250ZW50JyxcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfMTAsXHJcbiAgICAgIGhhbmRsZXI6ICdhcHAubGFtYmRhX2hhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uLy4uL3NyYy9sYW1iZGEvdmVjdG9yaXplX2NvbnRlbnQnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxyXG4gICAgICBtZW1vcnlTaXplOiAxMDI0LFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIE9QRU5TRUFSQ0hfRU5EUE9JTlQ6IGBodHRwczovLyR7Y29yZUluZnJhc3RydWN0dXJlLnZlY3RvckNvbGxlY3Rpb24uYXR0ckNvbGxlY3Rpb25FbmRwb2ludH1gLFxyXG4gICAgICAgIE9QRU5TRUFSQ0hfSU5ERVg6ICdkb2N1bWVudHMnLFxyXG4gICAgICB9LFxyXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ1ZlY3Rvcml6ZUNvbnRlbnRSb2xlJywge1xyXG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxyXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xyXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXHJcbiAgICAgICAgXSxcclxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xyXG4gICAgICAgICAgVmVjdG9yaXplQ29udGVudFBvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XHJcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcclxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAgICdzMzpHZXRPYmplY3QnLFxyXG4gICAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW2NvcmVJbmZyYXN0cnVjdHVyZS5wcm9jZXNzZWREb2NzSnNvbkJ1Y2tldC5hcm5Gb3JPYmplY3RzKCcqJyldLFxyXG4gICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgICAgJ2JlZHJvY2s6SW52b2tlTW9kZWwnLFxyXG4gICAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWydhcm46YXdzOmJlZHJvY2s6Kjo6Zm91bmRhdGlvbi1tb2RlbC9hbWF6b24udGl0YW4tZW1iZWQtdGV4dC12MSddLFxyXG4gICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgICAgJ2Fvc3M6QVBJQWNjZXNzQWxsJyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtjb3JlSW5mcmFzdHJ1Y3R1cmUudmVjdG9yQ29sbGVjdGlvbi5hdHRyQXJuXSxcclxuICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAgICdrbXM6RGVjcnlwdCcsXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbY29yZUluZnJhc3RydWN0dXJlLmVuY3J5cHRpb25LZXkua2V5QXJuXSxcclxuICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgXSxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU2V0IHVwIFMzIGV2ZW50IG5vdGlmaWNhdGlvbnNcclxuICAgIC8vIFRyaWdnZXIgVGV4dHJhY3QgcHJvY2Vzc29yIHdoZW4gbmV3IGRvY3VtZW50cyBhcmUgdXBsb2FkZWQgdG8gTUFTIGRvY3MgYnVja2V0XHJcbiAgICBjb3JlSW5mcmFzdHJ1Y3R1cmUubWFzRG9jc1Jhd0J1Y2tldC5hZGRFdmVudE5vdGlmaWNhdGlvbihcclxuICAgICAgczMuRXZlbnRUeXBlLk9CSkVDVF9DUkVBVEVELFxyXG4gICAgICBuZXcgczNuLkxhbWJkYURlc3RpbmF0aW9uKHRoaXMudGV4dHJhY3RQcm9jZXNzb3JGdW5jdGlvbiksXHJcbiAgICAgIHsgc3VmZml4OiAnLnBkZicgfVxyXG4gICAgKTtcclxuXHJcbiAgICBjb3JlSW5mcmFzdHJ1Y3R1cmUuaW50ZXJuYWxEb2NzUmF3QnVja2V0LmFkZEV2ZW50Tm90aWZpY2F0aW9uKFxyXG4gICAgICBzMy5FdmVudFR5cGUuT0JKRUNUX0NSRUFURUQsXHJcbiAgICAgIG5ldyBzM24uTGFtYmRhRGVzdGluYXRpb24odGhpcy50ZXh0cmFjdFByb2Nlc3NvckZ1bmN0aW9uKSxcclxuICAgICAgeyBzdWZmaXg6ICcucGRmJyB9XHJcbiAgICApO1xyXG5cclxuICAgIC8vIFRyaWdnZXIgdmVjdG9yaXphdGlvbiB3aGVuIHByb2Nlc3NlZCBkb2N1bWVudHMgYXJlIHVwbG9hZGVkXHJcbiAgICBjb3JlSW5mcmFzdHJ1Y3R1cmUucHJvY2Vzc2VkRG9jc0pzb25CdWNrZXQuYWRkRXZlbnROb3RpZmljYXRpb24oXHJcbiAgICAgIHMzLkV2ZW50VHlwZS5PQkpFQ1RfQ1JFQVRFRCxcclxuICAgICAgbmV3IHMzbi5MYW1iZGFEZXN0aW5hdGlvbih0aGlzLnZlY3Rvcml6ZUNvbnRlbnRGdW5jdGlvbiksXHJcbiAgICAgIHsgcHJlZml4OiAndGV4dHJhY3Qtb3V0cHV0LycsIHN1ZmZpeDogJy5qc29uJyB9XHJcbiAgICApO1xyXG5cclxuICAgIC8vIFN1YnNjcmliZSBUZXh0cmFjdCBwcm9jZXNzb3IgdG8gU05TIHRvcGljIGZvciBqb2IgY29tcGxldGlvbiBub3RpZmljYXRpb25zXHJcbiAgICB0aGlzLnRleHRyYWN0Q29tcGxldGlvblRvcGljLmFkZFN1YnNjcmlwdGlvbihcclxuICAgICAgbmV3IHNuc1N1YnNjcmlwdGlvbnMuTGFtYmRhU3Vic2NyaXB0aW9uKHRoaXMudGV4dHJhY3RQcm9jZXNzb3JGdW5jdGlvbilcclxuICAgICk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIE9wZW5TZWFyY2ggZGF0YSBhY2Nlc3MgcG9saWN5IGZvciBMYW1iZGEgZnVuY3Rpb25zXHJcbiAgICBjb25zdCBkYXRhQWNjZXNzUG9saWN5ID0gbmV3IG9wZW5zZWFyY2hzZXJ2ZXJsZXNzLkNmbkFjY2Vzc1BvbGljeSh0aGlzLCAnVmVjdG9yQ29sbGVjdGlvbkRhdGFBY2Nlc3NQb2xpY3knLCB7XHJcbiAgICAgIG5hbWU6ICd2ZWN0b3ItY29sbGVjdGlvbi1kYXRhLWFjY2Vzcy1wb2xpY3knLFxyXG4gICAgICB0eXBlOiAnZGF0YScsXHJcbiAgICAgIHBvbGljeTogSlNPTi5zdHJpbmdpZnkoW3tcclxuICAgICAgICBSdWxlczogW3tcclxuICAgICAgICAgIFJlc291cmNlVHlwZTogJ2NvbGxlY3Rpb24nLFxyXG4gICAgICAgICAgUmVzb3VyY2U6IFsnY29sbGVjdGlvbi92ZWN0b3ItY29sbGVjdGlvbiddLFxyXG4gICAgICAgICAgUGVybWlzc2lvbjogW1xyXG4gICAgICAgICAgICAnYW9zczpDcmVhdGVDb2xsZWN0aW9uSXRlbXMnLFxyXG4gICAgICAgICAgICAnYW9zczpEZWxldGVDb2xsZWN0aW9uSXRlbXMnLFxyXG4gICAgICAgICAgICAnYW9zczpVcGRhdGVDb2xsZWN0aW9uSXRlbXMnLFxyXG4gICAgICAgICAgICAnYW9zczpEZXNjcmliZUNvbGxlY3Rpb25JdGVtcydcclxuICAgICAgICAgIF1cclxuICAgICAgICB9LCB7XHJcbiAgICAgICAgICBSZXNvdXJjZVR5cGU6ICdpbmRleCcsXHJcbiAgICAgICAgICBSZXNvdXJjZTogWydpbmRleC92ZWN0b3ItY29sbGVjdGlvbi8qJ10sXHJcbiAgICAgICAgICBQZXJtaXNzaW9uOiBbXHJcbiAgICAgICAgICAgICdhb3NzOkNyZWF0ZUluZGV4JyxcclxuICAgICAgICAgICAgJ2Fvc3M6RGVsZXRlSW5kZXgnLFxyXG4gICAgICAgICAgICAnYW9zczpVcGRhdGVJbmRleCcsXHJcbiAgICAgICAgICAgICdhb3NzOkRlc2NyaWJlSW5kZXgnLFxyXG4gICAgICAgICAgICAnYW9zczpSZWFkRG9jdW1lbnQnLFxyXG4gICAgICAgICAgICAnYW9zczpXcml0ZURvY3VtZW50J1xyXG4gICAgICAgICAgXVxyXG4gICAgICAgIH1dLFxyXG4gICAgICAgIFByaW5jaXBhbDogW1xyXG4gICAgICAgICAgdGhpcy52ZWN0b3JpemVDb250ZW50RnVuY3Rpb24ucm9sZT8ucm9sZUFybixcclxuICAgICAgICBdLmZpbHRlcihCb29sZWFuKVxyXG4gICAgICB9XSlcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFkZCB0YWdzIHRvIGFsbCByZXNvdXJjZXNcclxuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnUHJvamVjdCcsICdDb21wbGlBZ2VudC1TRycpO1xyXG4gICAgY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdFbnZpcm9ubWVudCcsICdQcm9kdWN0aW9uJyk7XHJcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ01hbmFnZWRCeScsICdDREsnKTtcclxuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnQ29tcG9uZW50JywgJ0RvY3VtZW50UHJvY2Vzc2luZycpO1xyXG4gIH1cclxufVxyXG4iXX0=
