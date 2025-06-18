"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompliAgentStack = void 0;
const cdk = require("aws-cdk-lib");
const s3 = require("aws-cdk-lib/aws-s3");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const opensearchserverless = require("aws-cdk-lib/aws-opensearchserverless");
const kms = require("aws-cdk-lib/aws-kms");
const iam = require("aws-cdk-lib/aws-iam");
const lambda = require("aws-cdk-lib/aws-lambda");
const events = require("aws-cdk-lib/aws-events");
const targets = require("aws-cdk-lib/aws-events-targets");
const sns = require("aws-cdk-lib/aws-sns");
const snsSubscriptions = require("aws-cdk-lib/aws-sns-subscriptions");
const s3n = require("aws-cdk-lib/aws-s3-notifications");
const stepfunctions = require("aws-cdk-lib/aws-stepfunctions");
const stepfunctionsTasks = require("aws-cdk-lib/aws-stepfunctions-tasks");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const cognito = require("aws-cdk-lib/aws-cognito");
class CompliAgentStack extends cdk.Stack {
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
        // Create document tracking table
        const documentTrackingTable = new dynamodb.Table(this, 'DocumentTrackingTable', {
            tableName: 'CompliAgent-DocumentTracking',
            partitionKey: { name: 'document_id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
            encryptionKey: this.encryptionKey,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            pointInTimeRecovery: true,
        });
        // Add GSI for URL lookups
        documentTrackingTable.addGlobalSecondaryIndex({
            indexName: 'urlIndex',
            partitionKey: { name: 'url', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // Create OpenSearch Serverless security policies
        const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'VectorCEPolicy', {
            name: 'vector-ce-policy',
            type: 'encryption',
            policy: JSON.stringify({
                Rules: [{
                        ResourceType: 'collection',
                        Resource: ['collection/vector-collection']
                    }],
                AWSOwnedKey: true
            })
        });
        const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'VectorCNPolicy', {
            name: 'vector-cn-policy',
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
        // Create SNS topic for Textract completion notifications
        const textractCompletionTopic = new sns.Topic(this, 'TextractCompletionTopic', {
            topicName: 'CompliAgent-TextractCompletion',
            displayName: 'Textract Job Completion Notifications',
            masterKey: this.encryptionKey,
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
                            resources: [textractCompletionTopic.topicArn],
                        }),
                    ],
                }),
            },
        });
        // Create MAS Monitor Lambda function
        const masMonitorFunction = new lambda.Function(this, 'MasMonitorFunction', {
            functionName: 'CompliAgent-MasMonitor',
            runtime: lambda.Runtime.PYTHON_3_10,
            handler: 'app.lambda_handler',
            code: lambda.Code.fromAsset('../../src/lambda/mas_monitor'),
            timeout: cdk.Duration.minutes(15),
            memorySize: 512,
            environment: {
                MAS_DOCS_BUCKET: this.masDocsRawBucket.bucketName,
                TRACKING_TABLE: documentTrackingTable.tableName,
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
                                resources: [this.masDocsRawBucket.arnForObjects('*')],
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
                                    documentTrackingTable.tableArn,
                                    `${documentTrackingTable.tableArn}/index/*`,
                                ],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'kms:Decrypt',
                                    'kms:GenerateDataKey',
                                ],
                                resources: [this.encryptionKey.keyArn],
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
        masMonitorSchedule.addTarget(new targets.LambdaFunction(masMonitorFunction));
        // Create Textract Processor Lambda function
        const textractProcessorFunction = new lambda.Function(this, 'TextractProcessorFunction', {
            functionName: 'CompliAgent-TextractProcessor',
            runtime: lambda.Runtime.PYTHON_3_10,
            handler: 'app.lambda_handler',
            code: lambda.Code.fromAsset('../../src/lambda/textract_processor'),
            timeout: cdk.Duration.minutes(15),
            memorySize: 1024,
            environment: {
                PROCESSED_DOCS_BUCKET: this.processedDocsJsonBucket.bucketName,
                SNS_TOPIC_ARN: textractCompletionTopic.topicArn,
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
                                    this.masDocsRawBucket.arnForObjects('*'),
                                    this.internalDocsRawBucket.arnForObjects('*'),
                                ],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    's3:PutObject',
                                ],
                                resources: [this.processedDocsJsonBucket.arnForObjects('*')],
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
                                resources: [this.encryptionKey.keyArn],
                            }),
                        ],
                    }),
                },
            }),
        });
        // Create Vectorize Content Lambda function
        const vectorizeContentFunction = new lambda.Function(this, 'VectorizeContentFunction', {
            functionName: 'CompliAgent-VectorizeContent',
            runtime: lambda.Runtime.PYTHON_3_10,
            handler: 'app.lambda_handler',
            code: lambda.Code.fromAsset('../../src/lambda/vectorize_content'),
            timeout: cdk.Duration.minutes(15),
            memorySize: 1024,
            environment: {
                OPENSEARCH_ENDPOINT: `https://${this.vectorCollection.attrCollectionEndpoint}`,
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
                                resources: [this.processedDocsJsonBucket.arnForObjects('*')],
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
                                resources: [this.vectorCollection.attrArn],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'kms:Decrypt',
                                ],
                                resources: [this.encryptionKey.keyArn],
                            }),
                        ],
                    }),
                },
            }),
        });
        // Set up S3 event notifications
        // Trigger Textract processor when new documents are uploaded to MAS docs bucket
        this.masDocsRawBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(textractProcessorFunction), { suffix: '.pdf' });
        this.internalDocsRawBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(textractProcessorFunction), { suffix: '.pdf' });
        // Trigger vectorization when processed documents are uploaded
        this.processedDocsJsonBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(vectorizeContentFunction), { prefix: 'textract-output/', suffix: '.json' });
        // Subscribe Textract processor to SNS topic for job completion notifications
        textractCompletionTopic.addSubscription(new snsSubscriptions.LambdaSubscription(textractProcessorFunction));
        // Create OpenSearch data access policy for Lambda functions
        new opensearchserverless.CfnAccessPolicy(this, 'VectorCAPolicy', {
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
                        vectorizeContentFunction.role?.roleArn,
                    ].filter(Boolean)
                }])
        });
        // Create Analysis Workflow Lambda Functions (after vectorCollection is created)
        this.createAnalysisWorkflowFunctions();
        // Create API Layer components
        this.createAPILayer();
        // Add tags to all resources
        cdk.Tags.of(this).add('Project', 'CompliAgent-SG');
        cdk.Tags.of(this).add('Environment', 'Production');
        cdk.Tags.of(this).add('ManagedBy', 'CDK');
    }
    createAnalysisWorkflowFunctions() {
        // OpenSearch Query Lambda
        const opensearchQueryFunction = new lambda.Function(this, 'OpenSearchQueryFunction', {
            functionName: 'CompliAgent-OpenSearchQuery',
            runtime: lambda.Runtime.PYTHON_3_10,
            handler: 'app.lambda_handler',
            code: lambda.Code.fromAsset('../../src/lambda/opensearch_query'),
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
            environment: {
                OPENSEARCH_ENDPOINT: `https://${this.vectorCollection.attrCollectionEndpoint}`,
                OPENSEARCH_INDEX: 'documents',
            },
            role: new iam.Role(this, 'OpenSearchQueryRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                ],
                inlinePolicies: {
                    OpenSearchQueryPolicy: new iam.PolicyDocument({
                        statements: [
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
                                resources: [this.vectorCollection.attrArn],
                            }),
                        ],
                    }),
                },
            }),
        });
        // Bedrock Gap Analysis Lambda
        const bedrockGapAnalysisFunction = new lambda.Function(this, 'BedrockGapAnalysisFunction', {
            functionName: 'CompliAgent-BedrockGapAnalysis',
            runtime: lambda.Runtime.PYTHON_3_10,
            handler: 'app.lambda_handler',
            code: lambda.Code.fromAsset('../../src/lambda/bedrock_gap_analysis'),
            timeout: cdk.Duration.minutes(10),
            memorySize: 1024,
            environment: {
                CLAUDE_MODEL_ID: 'anthropic.claude-3-sonnet-20240229-v1:0',
            },
            role: new iam.Role(this, 'BedrockGapAnalysisRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                ],
                inlinePolicies: {
                    BedrockGapAnalysisPolicy: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'bedrock:InvokeModel',
                                ],
                                resources: ['arn:aws:bedrock:*::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0'],
                            }),
                        ],
                    }),
                },
            }),
        });
        // Store Gaps Lambda
        const storeGapsFunction = new lambda.Function(this, 'StoreGapsFunction', {
            functionName: 'CompliAgent-StoreGaps',
            runtime: lambda.Runtime.PYTHON_3_10,
            handler: 'app.lambda_handler',
            code: lambda.Code.fromAsset('../../src/lambda/store_gaps'),
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
            environment: {
                GAPS_TABLE_NAME: this.gapsTable.tableName,
            },
            role: new iam.Role(this, 'StoreGapsRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                ],
                inlinePolicies: {
                    StoreGapsPolicy: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'dynamodb:PutItem',
                                    'dynamodb:UpdateItem',
                                    'dynamodb:GetItem',
                                    'dynamodb:Query',
                                    'dynamodb:Scan',
                                ],
                                resources: [
                                    this.gapsTable.tableArn,
                                    `${this.gapsTable.tableArn}/index/*`,
                                ],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'kms:Decrypt',
                                    'kms:GenerateDataKey',
                                ],
                                resources: [this.encryptionKey.keyArn],
                            }),
                        ],
                    }),
                },
            }),
        });
        // Create Gap Analysis Workflow
        const queryVectorStore = new stepfunctionsTasks.LambdaInvoke(this, 'QueryVectorStore', {
            lambdaFunction: opensearchQueryFunction,
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        });
        const analyzeGaps = new stepfunctionsTasks.LambdaInvoke(this, 'AnalyzeGaps', {
            lambdaFunction: bedrockGapAnalysisFunction,
            inputPath: '$',
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        });
        const storeGaps = new stepfunctionsTasks.LambdaInvoke(this, 'StoreGaps', {
            lambdaFunction: storeGapsFunction,
            inputPath: '$.body',
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        });
        // Define the workflow chain
        const gapAnalysisDefinition = queryVectorStore.next(analyzeGaps).next(storeGaps);
        // Create the Gap Analysis State Machine
        this.gapAnalysisWorkflow = new stepfunctions.StateMachine(this, 'GapAnalysisWorkflow', {
            stateMachineName: 'CompliAgent-GapAnalysis',
            definition: gapAnalysisDefinition,
            timeout: cdk.Duration.minutes(30),
            tracingEnabled: true,
        });
    }
    createAPILayer() {
        // Create Cognito User Pool for authentication
        this.userPool = new cognito.UserPool(this, 'CompliAgentUserPool', {
            userPoolName: 'CompliAgent-SG-Users',
            selfSignUpEnabled: true,
            signInAliases: {
                email: true,
            },
            autoVerify: {
                email: true,
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: true,
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        // Create User Pool Client
        const userPoolClient = new cognito.UserPoolClient(this, 'CompliAgentUserPoolClient', {
            userPool: this.userPool,
            userPoolClientName: 'CompliAgent-SG-Client',
            generateSecret: false,
            authFlows: {
                userPassword: true,
                userSrp: true,
            },
            oAuth: {
                flows: {
                    authorizationCodeGrant: true,
                },
                scopes: [
                    cognito.OAuthScope.EMAIL,
                    cognito.OAuthScope.OPENID,
                    cognito.OAuthScope.PROFILE,
                ],
            },
        });
        // Create WebSocket connections table
        this.connectionsTable = new dynamodb.Table(this, 'WebSocketConnectionsTable', {
            tableName: 'CompliAgent-WebSocketConnections',
            partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
            encryptionKey: this.encryptionKey,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            timeToLiveAttribute: 'ttl',
        });
        // Add GSI for userId lookups
        this.connectionsTable.addGlobalSecondaryIndex({
            indexName: 'userIdIndex',
            partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // Create API Handler Lambda
        const apiHandlerFunction = new lambda.Function(this, 'ApiHandlerFunction', {
            functionName: 'CompliAgent-ApiHandler',
            runtime: lambda.Runtime.PYTHON_3_10,
            handler: 'app.lambda_handler',
            code: lambda.Code.fromAsset('../../src/lambda/api_handler'),
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
            environment: {
                GAPS_TABLE_NAME: this.gapsTable.tableName,
                AMENDMENTS_TABLE_NAME: this.amendmentsTable.tableName,
                GAP_ANALYSIS_STATE_MACHINE_ARN: this.gapAnalysisWorkflow.stateMachineArn,
            },
            role: new iam.Role(this, 'ApiHandlerRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                ],
                inlinePolicies: {
                    ApiHandlerPolicy: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'dynamodb:GetItem',
                                    'dynamodb:PutItem',
                                    'dynamodb:UpdateItem',
                                    'dynamodb:Query',
                                    'dynamodb:Scan',
                                ],
                                resources: [
                                    this.gapsTable.tableArn,
                                    `${this.gapsTable.tableArn}/index/*`,
                                    this.amendmentsTable.tableArn,
                                    `${this.amendmentsTable.tableArn}/index/*`,
                                ],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'states:StartExecution',
                                ],
                                resources: [this.gapAnalysisWorkflow.stateMachineArn],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'kms:Decrypt',
                                    'kms:GenerateDataKey',
                                ],
                                resources: [this.encryptionKey.keyArn],
                            }),
                        ],
                    }),
                },
            }),
        });
        // Create Cognito Authorizer
        const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
            cognitoUserPools: [this.userPool],
            authorizerName: 'CompliAgent-Authorizer',
        });
        // Create REST API
        this.restApi = new apigateway.RestApi(this, 'CompliAgentRestApi', {
            restApiName: 'CompliAgent-SG-API',
            description: 'REST API for CompliAgent-SG system',
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: [
                    'Content-Type',
                    'X-Amz-Date',
                    'Authorization',
                    'X-Api-Key',
                    'X-Amz-Security-Token',
                ],
            },
            deployOptions: {
                stageName: 'prod',
                throttlingRateLimit: 100,
                throttlingBurstLimit: 200,
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                dataTraceEnabled: true,
                metricsEnabled: true,
            },
        });
        // Create Lambda integration
        const lambdaIntegration = new apigateway.LambdaIntegration(apiHandlerFunction, {
            requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
        });
        // Add API endpoints
        // GET /gaps
        const gapsResource = this.restApi.root.addResource('gaps');
        gapsResource.addMethod('GET', lambdaIntegration, {
            authorizer: cognitoAuthorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        // POST /gaps/{gapId}/acknowledge
        const gapResource = gapsResource.addResource('{gapId}');
        const acknowledgeResource = gapResource.addResource('acknowledge');
        acknowledgeResource.addMethod('POST', lambdaIntegration, {
            authorizer: cognitoAuthorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        // GET /amendments
        const amendmentsResource = this.restApi.root.addResource('amendments');
        amendmentsResource.addMethod('GET', lambdaIntegration, {
            authorizer: cognitoAuthorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        // POST /amendments/{amendmentId}/approve
        const amendmentResource = amendmentsResource.addResource('{amendmentId}');
        const approveResource = amendmentResource.addResource('approve');
        approveResource.addMethod('POST', lambdaIntegration, {
            authorizer: cognitoAuthorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        // POST /analysis/start
        const analysisResource = this.restApi.root.addResource('analysis');
        const startAnalysisResource = analysisResource.addResource('start');
        startAnalysisResource.addMethod('POST', lambdaIntegration, {
            authorizer: cognitoAuthorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        // POST /amendments/draft
        const draftResource = amendmentsResource.addResource('draft');
        draftResource.addMethod('POST', lambdaIntegration, {
            authorizer: cognitoAuthorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        // GET /health (no auth required)
        const healthResource = this.restApi.root.addResource('health');
        healthResource.addMethod('GET', lambdaIntegration);
        // Create WebSocket Handler Lambda (for future WebSocket API implementation)
        const webSocketHandlerFunction = new lambda.Function(this, 'WebSocketHandlerFunction', {
            functionName: 'CompliAgent-WebSocketHandler',
            runtime: lambda.Runtime.PYTHON_3_10,
            handler: 'app.lambda_handler',
            code: lambda.Code.fromAsset('../../src/lambda/websocket_handler'),
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
            environment: {
                CONNECTIONS_TABLE_NAME: this.connectionsTable.tableName,
            },
            role: new iam.Role(this, 'WebSocketHandlerRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                ],
                inlinePolicies: {
                    WebSocketHandlerPolicy: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'dynamodb:GetItem',
                                    'dynamodb:PutItem',
                                    'dynamodb:UpdateItem',
                                    'dynamodb:DeleteItem',
                                    'dynamodb:Query',
                                    'dynamodb:Scan',
                                ],
                                resources: [
                                    this.connectionsTable.tableArn,
                                    `${this.connectionsTable.tableArn}/index/*`,
                                ],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'execute-api:ManageConnections',
                                ],
                                resources: ['arn:aws:execute-api:*:*:*/@connections/*'],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'kms:Decrypt',
                                    'kms:GenerateDataKey',
                                ],
                                resources: [this.encryptionKey.keyArn],
                            }),
                        ],
                    }),
                },
            }),
        });
    }
}
exports.CompliAgentStack = CompliAgentStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tcGxpYWdlbnQtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjb21wbGlhZ2VudC1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMseUNBQXlDO0FBQ3pDLHFEQUFxRDtBQUNyRCw2RUFBNkU7QUFDN0UsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyxpREFBaUQ7QUFDakQsaURBQWlEO0FBQ2pELDBEQUEwRDtBQUMxRCwyQ0FBMkM7QUFDM0Msc0VBQXNFO0FBQ3RFLHdEQUF3RDtBQUN4RCwrREFBK0Q7QUFDL0QsMEVBQTBFO0FBRTFFLHlEQUF5RDtBQUN6RCxtREFBbUQ7QUFFbkQsTUFBYSxnQkFBaUIsU0FBUSxHQUFHLENBQUMsS0FBSztJQWtCN0MsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixnQ0FBZ0M7UUFDaEMsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLDBCQUEwQixFQUFFO1lBQ2pFLGlCQUFpQixFQUFFLElBQUk7WUFDdkIsV0FBVyxFQUFFLHVDQUF1QztZQUNwRCxLQUFLLEVBQUUsc0JBQXNCO1NBQzlCLENBQUMsQ0FBQztRQUVILGtFQUFrRTtRQUNsRSxNQUFNLFNBQVMsR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUM7UUFDN0MsTUFBTSxNQUFNLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDO1FBRXpDLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLEVBQUUsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzlELFVBQVUsRUFBRSxnQkFBZ0IsU0FBUyxJQUFJLE1B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VTtpQ0FDNUM7NkJBQ0YsQ0FBQzs0QkFDRixJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7Z0NBQ3RCLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUs7Z0NBQ3hCLE9BQU8sRUFBRTtvQ0FDUCwrQkFBK0I7aUNBQ2hDO2dDQUNELFNBQVMsRUFBRSxDQUFDLDBDQUEwQyxDQUFDOzZCQUN4RCxDQUFDOzRCQUNGLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztnQ0FDdEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztnQ0FDeEIsT0FBTyxFQUFFO29DQUNQLGFBQWE7b0NBQ2IscUJBQXFCO2lDQUN0QjtnQ0FDRCxTQUFTLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQzs2QkFDdkMsQ0FBQzt5QkFDSDtxQkFDRixDQUFDO2lCQUNIO2FBQ0YsQ0FBQztTQUNILENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTUyQkQsNENBNDJCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xyXG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xyXG5pbXBvcnQgKiBhcyBvcGVuc2VhcmNoc2VydmVybGVzcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtb3BlbnNlYXJjaHNlcnZlcmxlc3MnO1xyXG5pbXBvcnQgKiBhcyBrbXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWttcyc7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XHJcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcclxuaW1wb3J0ICogYXMgc25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xyXG5pbXBvcnQgKiBhcyBzbnNTdWJzY3JpcHRpb25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMtc3Vic2NyaXB0aW9ucyc7XHJcbmltcG9ydCAqIGFzIHMzbiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMtbm90aWZpY2F0aW9ucyc7XHJcbmltcG9ydCAqIGFzIHN0ZXBmdW5jdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMnO1xyXG5pbXBvcnQgKiBhcyBzdGVwZnVuY3Rpb25zVGFza3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMtdGFza3MnO1xyXG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcclxuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XHJcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZ25pdG8nO1xyXG5cclxuZXhwb3J0IGNsYXNzIENvbXBsaUFnZW50U3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xyXG4gIC8vIENvcmUgaW5mcmFzdHJ1Y3R1cmVcclxuICBwdWJsaWMgcmVhZG9ubHkgZW5jcnlwdGlvbktleToga21zLktleTtcclxuICBwdWJsaWMgcmVhZG9ubHkgbWFzRG9jc1Jhd0J1Y2tldDogczMuQnVja2V0O1xyXG4gIHB1YmxpYyByZWFkb25seSBpbnRlcm5hbERvY3NSYXdCdWNrZXQ6IHMzLkJ1Y2tldDtcclxuICBwdWJsaWMgcmVhZG9ubHkgcHJvY2Vzc2VkRG9jc0pzb25CdWNrZXQ6IHMzLkJ1Y2tldDtcclxuICBwdWJsaWMgcmVhZG9ubHkgZ2Fwc1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcclxuICBwdWJsaWMgcmVhZG9ubHkgYW1lbmRtZW50c1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcclxuICBwdWJsaWMgcmVhZG9ubHkgdmVjdG9yQ29sbGVjdGlvbjogb3BlbnNlYXJjaHNlcnZlcmxlc3MuQ2ZuQ29sbGVjdGlvbjtcclxuICBcclxuICAvLyBBbmFseXNpcyB3b3JrZmxvdyBjb21wb25lbnRzXHJcbiAgcHVibGljIGdhcEFuYWx5c2lzV29ya2Zsb3chOiBzdGVwZnVuY3Rpb25zLlN0YXRlTWFjaGluZTtcclxuICBwdWJsaWMgYW1lbmRtZW50RHJhZnRpbmdXb3JrZmxvdyE6IHN0ZXBmdW5jdGlvbnMuU3RhdGVNYWNoaW5lO1xyXG4gIFxyXG4gIC8vIEFQSSBMYXllciBjb21wb25lbnRzXHJcbiAgcHVibGljIHVzZXJQb29sITogY29nbml0by5Vc2VyUG9vbDtcclxuICBwdWJsaWMgcmVzdEFwaSE6IGFwaWdhdGV3YXkuUmVzdEFwaTtcclxuICBwdWJsaWMgY29ubmVjdGlvbnNUYWJsZSE6IGR5bmFtb2RiLlRhYmxlO1xyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcclxuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xyXG5cclxuICAgIC8vIENyZWF0ZSBLTVMga2V5IGZvciBlbmNyeXB0aW9uXHJcbiAgICB0aGlzLmVuY3J5cHRpb25LZXkgPSBuZXcga21zLktleSh0aGlzLCAnQ29tcGxpQWdlbnRFbmNyeXB0aW9uS2V5Jywge1xyXG4gICAgICBlbmFibGVLZXlSb3RhdGlvbjogdHJ1ZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdLTVMga2V5IGZvciBDb21wbGlBZ2VudC1TRyBlbmNyeXB0aW9uJyxcclxuICAgICAgYWxpYXM6ICdhbGlhcy9jb21wbGlhZ2VudC1zZycsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgUzMgYnVja2V0cyB3aXRoIHVuaXF1ZSBuYW1lcyB1c2luZyBhY2NvdW50IElEIGFuZCByZWdpb25cclxuICAgIGNvbnN0IGFjY291bnRJZCA9IGNkay5TdGFjay5vZih0aGlzKS5hY2NvdW50O1xyXG4gICAgY29uc3QgcmVnaW9uID0gY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbjtcclxuICAgIFxyXG4gICAgdGhpcy5tYXNEb2NzUmF3QnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnTWFzRG9jc1Jhd0J1Y2tldCcsIHtcclxuICAgICAgYnVja2V0TmFtZTogYG1hcy1kb2NzLXJhdy0ke2FjY291bnRJZH0tJHtyZWdpb259YCxcclxuICAgICAgdmVyc2lvbmVkOiB0cnVlLFxyXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLktNUyxcclxuICAgICAgZW5jcnlwdGlvbktleTogdGhpcy5lbmNyeXB0aW9uS2V5LFxyXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXHJcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbe1xyXG4gICAgICAgIGlkOiAnRGVsZXRlT2xkVmVyc2lvbnMnLFxyXG4gICAgICAgIG5vbmN1cnJlbnRWZXJzaW9uRXhwaXJhdGlvbjogY2RrLkR1cmF0aW9uLmRheXMoOTApLFxyXG4gICAgICB9XSxcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuaW50ZXJuYWxEb2NzUmF3QnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnSW50ZXJuYWxEb2NzUmF3QnVja2V0Jywge1xyXG4gICAgICBidWNrZXROYW1lOiBgaW50ZXJuYWwtZG9jcy1yYXctJHthY2NvdW50SWR9LSR7cmVnaW9ufWAsXHJcbiAgICAgIHZlcnNpb25lZDogdHJ1ZSxcclxuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5LTVMsXHJcbiAgICAgIGVuY3J5cHRpb25LZXk6IHRoaXMuZW5jcnlwdGlvbktleSxcclxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxyXG4gICAgICBsaWZlY3ljbGVSdWxlczogW3tcclxuICAgICAgICBpZDogJ0RlbGV0ZU9sZFZlcnNpb25zJyxcclxuICAgICAgICBub25jdXJyZW50VmVyc2lvbkV4cGlyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDkwKSxcclxuICAgICAgfV0sXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLnByb2Nlc3NlZERvY3NKc29uQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnUHJvY2Vzc2VkRG9jc0pzb25CdWNrZXQnLCB7XHJcbiAgICAgIGJ1Y2tldE5hbWU6IGBwcm9jZXNzZWQtZG9jcy1qc29uLSR7YWNjb3VudElkfS0ke3JlZ2lvbn1gLFxyXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLktNUyxcclxuICAgICAgZW5jcnlwdGlvbktleTogdGhpcy5lbmNyeXB0aW9uS2V5LFxyXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXHJcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbe1xyXG4gICAgICAgIGlkOiAnRGVsZXRlT2xkUHJvY2Vzc2VkRG9jcycsXHJcbiAgICAgICAgZXhwaXJhdGlvbjogY2RrLkR1cmF0aW9uLmRheXMoMzY1KSxcclxuICAgICAgfV0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgRHluYW1vREIgdGFibGVzXHJcbiAgICB0aGlzLmdhcHNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnR2Fwc1RhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdDb21wbGlBZ2VudC1HYXBzVGFibGUnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2dhcElkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkNVU1RPTUVSX01BTkFHRUQsXHJcbiAgICAgIGVuY3J5cHRpb25LZXk6IHRoaXMuZW5jcnlwdGlvbktleSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQWRkIEdTSSBmb3IgcmVndWxhdGlvbklkIHRvIEdhcHNUYWJsZVxyXG4gICAgdGhpcy5nYXBzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdyZWd1bGF0aW9uSWRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAncmVndWxhdGlvbklkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFkZCBHU0kgZm9yIHN0YXR1cyB0byBHYXBzVGFibGVcclxuICAgIHRoaXMuZ2Fwc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnc3RhdHVzSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3N0YXR1cycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2NyZWF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5BTEwsXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLmFtZW5kbWVudHNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnQW1lbmRtZW50c1RhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdDb21wbGlBZ2VudC1BbWVuZG1lbnRzVGFibGUnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2FtZW5kbWVudElkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkNVU1RPTUVSX01BTkFHRUQsXHJcbiAgICAgIGVuY3J5cHRpb25LZXk6IHRoaXMuZW5jcnlwdGlvbktleSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQWRkIEdTSSBmb3IgZ2FwSWQgdG8gQW1lbmRtZW50c1RhYmxlXHJcbiAgICB0aGlzLmFtZW5kbWVudHNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ2dhcElkSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2dhcElkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFkZCBHU0kgZm9yIHN0YXR1cyB0byBBbWVuZG1lbnRzVGFibGVcclxuICAgIHRoaXMuYW1lbmRtZW50c1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnc3RhdHVzSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3N0YXR1cycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2NyZWF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5BTEwsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgZG9jdW1lbnQgdHJhY2tpbmcgdGFibGVcclxuICAgIGNvbnN0IGRvY3VtZW50VHJhY2tpbmdUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnRG9jdW1lbnRUcmFja2luZ1RhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdDb21wbGlBZ2VudC1Eb2N1bWVudFRyYWNraW5nJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdkb2N1bWVudF9pZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIGVuY3J5cHRpb246IGR5bmFtb2RiLlRhYmxlRW5jcnlwdGlvbi5DVVNUT01FUl9NQU5BR0VELFxyXG4gICAgICBlbmNyeXB0aW9uS2V5OiB0aGlzLmVuY3J5cHRpb25LZXksXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFkZCBHU0kgZm9yIFVSTCBsb29rdXBzXHJcbiAgICBkb2N1bWVudFRyYWNraW5nVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICd1cmxJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAndXJsJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBPcGVuU2VhcmNoIFNlcnZlcmxlc3Mgc2VjdXJpdHkgcG9saWNpZXNcclxuICAgIGNvbnN0IGVuY3J5cHRpb25Qb2xpY3kgPSBuZXcgb3BlbnNlYXJjaHNlcnZlcmxlc3MuQ2ZuU2VjdXJpdHlQb2xpY3kodGhpcywgJ1ZlY3RvckNvbGxlY3Rpb25FbmNyeXB0aW9uUG9saWN5Jywge1xyXG4gICAgICBuYW1lOiAndmVjdG9yLWNvbGxlY3Rpb24tZW5jcnlwdGlvbi1wb2xpY3knLFxyXG4gICAgICB0eXBlOiAnZW5jcnlwdGlvbicsXHJcbiAgICAgIHBvbGljeTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIFJ1bGVzOiBbe1xyXG4gICAgICAgICAgUmVzb3VyY2VUeXBlOiAnY29sbGVjdGlvbicsXHJcbiAgICAgICAgICBSZXNvdXJjZTogWydjb2xsZWN0aW9uL3ZlY3Rvci1jb2xsZWN0aW9uJ11cclxuICAgICAgICB9XSxcclxuICAgICAgICBBV1NPd25lZEtleTogdHJ1ZVxyXG4gICAgICB9KVxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgbmV0d29ya1BvbGljeSA9IG5ldyBvcGVuc2VhcmNoc2VydmVybGVzcy5DZm5TZWN1cml0eVBvbGljeSh0aGlzLCAnVmVjdG9yQ29sbGVjdGlvbk5ldHdvcmtQb2xpY3knLCB7XHJcbiAgICAgIG5hbWU6ICd2ZWN0b3ItY29sbGVjdGlvbi1uZXR3b3JrLXBvbGljeScsXHJcbiAgICAgIHR5cGU6ICduZXR3b3JrJyxcclxuICAgICAgcG9saWN5OiBKU09OLnN0cmluZ2lmeShbe1xyXG4gICAgICAgIFJ1bGVzOiBbe1xyXG4gICAgICAgICAgUmVzb3VyY2VUeXBlOiAnY29sbGVjdGlvbicsXHJcbiAgICAgICAgICBSZXNvdXJjZTogWydjb2xsZWN0aW9uL3ZlY3Rvci1jb2xsZWN0aW9uJ11cclxuICAgICAgICB9LCB7XHJcbiAgICAgICAgICBSZXNvdXJjZVR5cGU6ICdkYXNoYm9hcmQnLFxyXG4gICAgICAgICAgUmVzb3VyY2U6IFsnY29sbGVjdGlvbi92ZWN0b3ItY29sbGVjdGlvbiddXHJcbiAgICAgICAgfV0sXHJcbiAgICAgICAgQWxsb3dGcm9tUHVibGljOiB0cnVlXHJcbiAgICAgIH1dKVxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIE9wZW5TZWFyY2ggU2VydmVybGVzcyBjb2xsZWN0aW9uXHJcbiAgICB0aGlzLnZlY3RvckNvbGxlY3Rpb24gPSBuZXcgb3BlbnNlYXJjaHNlcnZlcmxlc3MuQ2ZuQ29sbGVjdGlvbih0aGlzLCAnVmVjdG9yQ29sbGVjdGlvbicsIHtcclxuICAgICAgbmFtZTogJ3ZlY3Rvci1jb2xsZWN0aW9uJyxcclxuICAgICAgdHlwZTogJ1ZFQ1RPUlNFQVJDSCcsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnVmVjdG9yIGNvbGxlY3Rpb24gZm9yIENvbXBsaUFnZW50LVNHIGRvY3VtZW50IGVtYmVkZGluZ3MnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gRW5zdXJlIGNvbGxlY3Rpb24gaXMgY3JlYXRlZCBhZnRlciBzZWN1cml0eSBwb2xpY2llc1xyXG4gICAgdGhpcy52ZWN0b3JDb2xsZWN0aW9uLmFkZERlcGVuZGVuY3koZW5jcnlwdGlvblBvbGljeSk7XHJcbiAgICB0aGlzLnZlY3RvckNvbGxlY3Rpb24uYWRkRGVwZW5kZW5jeShuZXR3b3JrUG9saWN5KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgU05TIHRvcGljIGZvciBUZXh0cmFjdCBjb21wbGV0aW9uIG5vdGlmaWNhdGlvbnNcclxuICAgIGNvbnN0IHRleHRyYWN0Q29tcGxldGlvblRvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAnVGV4dHJhY3RDb21wbGV0aW9uVG9waWMnLCB7XHJcbiAgICAgIHRvcGljTmFtZTogJ0NvbXBsaUFnZW50LVRleHRyYWN0Q29tcGxldGlvbicsXHJcbiAgICAgIGRpc3BsYXlOYW1lOiAnVGV4dHJhY3QgSm9iIENvbXBsZXRpb24gTm90aWZpY2F0aW9ucycsXHJcbiAgICAgIG1hc3RlcktleTogdGhpcy5lbmNyeXB0aW9uS2V5LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIElBTSByb2xlIGZvciBUZXh0cmFjdCB0byBwdWJsaXNoIHRvIFNOU1xyXG4gICAgY29uc3QgdGV4dHJhY3RTZXJ2aWNlUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnVGV4dHJhY3RTZXJ2aWNlUm9sZScsIHtcclxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ3RleHRyYWN0LmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgaW5saW5lUG9saWNpZXM6IHtcclxuICAgICAgICBUZXh0cmFjdFNOU1BvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XHJcbiAgICAgICAgICBzdGF0ZW1lbnRzOiBbXHJcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgYWN0aW9uczogWydzbnM6UHVibGlzaCddLFxyXG4gICAgICAgICAgICAgIHJlc291cmNlczogW3RleHRyYWN0Q29tcGxldGlvblRvcGljLnRvcGljQXJuXSxcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIE1BUyBNb25pdG9yIExhbWJkYSBmdW5jdGlvblxyXG4gICAgY29uc3QgbWFzTW9uaXRvckZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnTWFzTW9uaXRvckZ1bmN0aW9uJywge1xyXG4gICAgICBmdW5jdGlvbk5hbWU6ICdDb21wbGlBZ2VudC1NYXNNb25pdG9yJyxcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfMTAsXHJcbiAgICAgIGhhbmRsZXI6ICdhcHAubGFtYmRhX2hhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uLy4uL3NyYy9sYW1iZGEvbWFzX21vbml0b3InKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxyXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgTUFTX0RPQ1NfQlVDS0VUOiB0aGlzLm1hc0RvY3NSYXdCdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgICBUUkFDS0lOR19UQUJMRTogZG9jdW1lbnRUcmFja2luZ1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgfSxcclxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdNYXNNb25pdG9yUm9sZScsIHtcclxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcclxuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcclxuICAgICAgICAgIE1hc01vbml0b3JQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xyXG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXHJcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgICAnczM6UHV0T2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgJ3MzOlB1dE9iamVjdEFjbCcsXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy5tYXNEb2NzUmF3QnVja2V0LmFybkZvck9iamVjdHMoJyonKV0sXHJcbiAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6R2V0SXRlbScsXHJcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpQdXRJdGVtJyxcclxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlVwZGF0ZUl0ZW0nLFxyXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6UXVlcnknLFxyXG4gICAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW1xyXG4gICAgICAgICAgICAgICAgICBkb2N1bWVudFRyYWNraW5nVGFibGUudGFibGVBcm4sXHJcbiAgICAgICAgICAgICAgICAgIGAke2RvY3VtZW50VHJhY2tpbmdUYWJsZS50YWJsZUFybn0vaW5kZXgvKmAsXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgICAgJ2ttczpEZWNyeXB0JyxcclxuICAgICAgICAgICAgICAgICAgJ2ttczpHZW5lcmF0ZURhdGFLZXknLFxyXG4gICAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMuZW5jcnlwdGlvbktleS5rZXlBcm5dLFxyXG4gICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICBdLFxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgfSxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgRXZlbnRCcmlkZ2UgcnVsZSB0byB0cmlnZ2VyIE1BUyBtb25pdG9yIGRhaWx5XHJcbiAgICBjb25zdCBtYXNNb25pdG9yU2NoZWR1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ01hc01vbml0b3JTY2hlZHVsZScsIHtcclxuICAgICAgcnVsZU5hbWU6ICdDb21wbGlBZ2VudC1NYXNNb25pdG9yU2NoZWR1bGUnLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0RhaWx5IHRyaWdnZXIgZm9yIE1BUyBkb2N1bWVudCBtb25pdG9yaW5nJyxcclxuICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5jcm9uKHtcclxuICAgICAgICBtaW51dGU6ICcwJyxcclxuICAgICAgICBob3VyOiAnOScsIC8vIDkgQU0gVVRDIGRhaWx5XHJcbiAgICAgICAgZGF5OiAnKicsXHJcbiAgICAgICAgbW9udGg6ICcqJyxcclxuICAgICAgICB5ZWFyOiAnKicsXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbWFzTW9uaXRvclNjaGVkdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihtYXNNb25pdG9yRnVuY3Rpb24pKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgVGV4dHJhY3QgUHJvY2Vzc29yIExhbWJkYSBmdW5jdGlvblxyXG4gICAgY29uc3QgdGV4dHJhY3RQcm9jZXNzb3JGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1RleHRyYWN0UHJvY2Vzc29yRnVuY3Rpb24nLCB7XHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ0NvbXBsaUFnZW50LVRleHRyYWN0UHJvY2Vzc29yJyxcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfMTAsXHJcbiAgICAgIGhhbmRsZXI6ICdhcHAubGFtYmRhX2hhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uLy4uL3NyYy9sYW1iZGEvdGV4dHJhY3RfcHJvY2Vzc29yJyksXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcclxuICAgICAgbWVtb3J5U2l6ZTogMTAyNCxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBQUk9DRVNTRURfRE9DU19CVUNLRVQ6IHRoaXMucHJvY2Vzc2VkRG9jc0pzb25CdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgICBTTlNfVE9QSUNfQVJOOiB0ZXh0cmFjdENvbXBsZXRpb25Ub3BpYy50b3BpY0FybixcclxuICAgICAgICBURVhUUkFDVF9ST0xFX0FSTjogdGV4dHJhY3RTZXJ2aWNlUm9sZS5yb2xlQXJuLFxyXG4gICAgICB9LFxyXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ1RleHRyYWN0UHJvY2Vzc29yUm9sZScsIHtcclxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcclxuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcclxuICAgICAgICAgIFRleHRyYWN0UHJvY2Vzc29yUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgICAgICAgc3RhdGVtZW50czogW1xyXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgICAgJ3MzOkdldE9iamVjdCcsXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXHJcbiAgICAgICAgICAgICAgICAgIHRoaXMubWFzRG9jc1Jhd0J1Y2tldC5hcm5Gb3JPYmplY3RzKCcqJyksXHJcbiAgICAgICAgICAgICAgICAgIHRoaXMuaW50ZXJuYWxEb2NzUmF3QnVja2V0LmFybkZvck9iamVjdHMoJyonKSxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgICAnczM6UHV0T2JqZWN0JyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLnByb2Nlc3NlZERvY3NKc29uQnVja2V0LmFybkZvck9iamVjdHMoJyonKV0sXHJcbiAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgICAndGV4dHJhY3Q6U3RhcnREb2N1bWVudEFuYWx5c2lzJyxcclxuICAgICAgICAgICAgICAgICAgJ3RleHRyYWN0OkdldERvY3VtZW50QW5hbHlzaXMnLFxyXG4gICAgICAgICAgICAgICAgICAndGV4dHJhY3Q6QW5hbHl6ZURvY3VtZW50JyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxyXG4gICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgICAgJ2lhbTpQYXNzUm9sZScsXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbdGV4dHJhY3RTZXJ2aWNlUm9sZS5yb2xlQXJuXSxcclxuICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAgICdrbXM6RGVjcnlwdCcsXHJcbiAgICAgICAgICAgICAgICAgICdrbXM6R2VuZXJhdGVEYXRhS2V5JyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLmVuY3J5cHRpb25LZXkua2V5QXJuXSxcclxuICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgXSxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIFZlY3Rvcml6ZSBDb250ZW50IExhbWJkYSBmdW5jdGlvblxyXG4gICAgY29uc3QgdmVjdG9yaXplQ29udGVudEZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnVmVjdG9yaXplQ29udGVudEZ1bmN0aW9uJywge1xyXG4gICAgICBmdW5jdGlvbk5hbWU6ICdDb21wbGlBZ2VudC1WZWN0b3JpemVDb250ZW50JyxcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfMTAsXHJcbiAgICAgIGhhbmRsZXI6ICdhcHAubGFtYmRhX2hhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uLy4uL3NyYy9sYW1iZGEvdmVjdG9yaXplX2NvbnRlbnQnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxyXG4gICAgICBtZW1vcnlTaXplOiAxMDI0LFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIE9QRU5TRUFSQ0hfRU5EUE9JTlQ6IGBodHRwczovLyR7dGhpcy52ZWN0b3JDb2xsZWN0aW9uLmF0dHJDb2xsZWN0aW9uRW5kcG9pbnR9YCxcclxuICAgICAgICBPUEVOU0VBUkNIX0lOREVYOiAnZG9jdW1lbnRzJyxcclxuICAgICAgfSxcclxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdWZWN0b3JpemVDb250ZW50Um9sZScsIHtcclxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcclxuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcclxuICAgICAgICAgIFZlY3Rvcml6ZUNvbnRlbnRQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xyXG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXHJcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgICAnczM6R2V0T2JqZWN0JyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLnByb2Nlc3NlZERvY3NKc29uQnVja2V0LmFybkZvck9iamVjdHMoJyonKV0sXHJcbiAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgICAnYmVkcm9jazpJbnZva2VNb2RlbCcsXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJ2Fybjphd3M6YmVkcm9jazoqOjpmb3VuZGF0aW9uLW1vZGVsL2FtYXpvbi50aXRhbi1lbWJlZC10ZXh0LXYxJ10sXHJcbiAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgICAnYW9zczpBUElBY2Nlc3NBbGwnLFxyXG4gICAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMudmVjdG9yQ29sbGVjdGlvbi5hdHRyQXJuXSxcclxuICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAgICdrbXM6RGVjcnlwdCcsXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy5lbmNyeXB0aW9uS2V5LmtleUFybl0sXHJcbiAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICB9LFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFNldCB1cCBTMyBldmVudCBub3RpZmljYXRpb25zXHJcbiAgICAvLyBUcmlnZ2VyIFRleHRyYWN0IHByb2Nlc3NvciB3aGVuIG5ldyBkb2N1bWVudHMgYXJlIHVwbG9hZGVkIHRvIE1BUyBkb2NzIGJ1Y2tldFxyXG4gICAgdGhpcy5tYXNEb2NzUmF3QnVja2V0LmFkZEV2ZW50Tm90aWZpY2F0aW9uKFxyXG4gICAgICBzMy5FdmVudFR5cGUuT0JKRUNUX0NSRUFURUQsXHJcbiAgICAgIG5ldyBzM24uTGFtYmRhRGVzdGluYXRpb24odGV4dHJhY3RQcm9jZXNzb3JGdW5jdGlvbiksXHJcbiAgICAgIHsgc3VmZml4OiAnLnBkZicgfVxyXG4gICAgKTtcclxuXHJcbiAgICB0aGlzLmludGVybmFsRG9jc1Jhd0J1Y2tldC5hZGRFdmVudE5vdGlmaWNhdGlvbihcclxuICAgICAgczMuRXZlbnRUeXBlLk9CSkVDVF9DUkVBVEVELFxyXG4gICAgICBuZXcgczNuLkxhbWJkYURlc3RpbmF0aW9uKHRleHRyYWN0UHJvY2Vzc29yRnVuY3Rpb24pLFxyXG4gICAgICB7IHN1ZmZpeDogJy5wZGYnIH1cclxuICAgICk7XHJcblxyXG4gICAgLy8gVHJpZ2dlciB2ZWN0b3JpemF0aW9uIHdoZW4gcHJvY2Vzc2VkIGRvY3VtZW50cyBhcmUgdXBsb2FkZWRcclxuICAgIHRoaXMucHJvY2Vzc2VkRG9jc0pzb25CdWNrZXQuYWRkRXZlbnROb3RpZmljYXRpb24oXHJcbiAgICAgIHMzLkV2ZW50VHlwZS5PQkpFQ1RfQ1JFQVRFRCxcclxuICAgICAgbmV3IHMzbi5MYW1iZGFEZXN0aW5hdGlvbih2ZWN0b3JpemVDb250ZW50RnVuY3Rpb24pLFxyXG4gICAgICB7IHByZWZpeDogJ3RleHRyYWN0LW91dHB1dC8nLCBzdWZmaXg6ICcuanNvbicgfVxyXG4gICAgKTtcclxuXHJcbiAgICAvLyBTdWJzY3JpYmUgVGV4dHJhY3QgcHJvY2Vzc29yIHRvIFNOUyB0b3BpYyBmb3Igam9iIGNvbXBsZXRpb24gbm90aWZpY2F0aW9uc1xyXG4gICAgdGV4dHJhY3RDb21wbGV0aW9uVG9waWMuYWRkU3Vic2NyaXB0aW9uKFxyXG4gICAgICBuZXcgc25zU3Vic2NyaXB0aW9ucy5MYW1iZGFTdWJzY3JpcHRpb24odGV4dHJhY3RQcm9jZXNzb3JGdW5jdGlvbilcclxuICAgICk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIE9wZW5TZWFyY2ggZGF0YSBhY2Nlc3MgcG9saWN5IGZvciBMYW1iZGEgZnVuY3Rpb25zXHJcbiAgICBuZXcgb3BlbnNlYXJjaHNlcnZlcmxlc3MuQ2ZuQWNjZXNzUG9saWN5KHRoaXMsICdWZWN0b3JDb2xsZWN0aW9uRGF0YUFjY2Vzc1BvbGljeScsIHtcclxuICAgICAgbmFtZTogJ3ZlY3Rvci1jb2xsZWN0aW9uLWRhdGEtYWNjZXNzLXBvbGljeScsXHJcbiAgICAgIHR5cGU6ICdkYXRhJyxcclxuICAgICAgcG9saWN5OiBKU09OLnN0cmluZ2lmeShbe1xyXG4gICAgICAgIFJ1bGVzOiBbe1xyXG4gICAgICAgICAgUmVzb3VyY2VUeXBlOiAnY29sbGVjdGlvbicsXHJcbiAgICAgICAgICBSZXNvdXJjZTogWydjb2xsZWN0aW9uL3ZlY3Rvci1jb2xsZWN0aW9uJ10sXHJcbiAgICAgICAgICBQZXJtaXNzaW9uOiBbXHJcbiAgICAgICAgICAgICdhb3NzOkNyZWF0ZUNvbGxlY3Rpb25JdGVtcycsXHJcbiAgICAgICAgICAgICdhb3NzOkRlbGV0ZUNvbGxlY3Rpb25JdGVtcycsXHJcbiAgICAgICAgICAgICdhb3NzOlVwZGF0ZUNvbGxlY3Rpb25JdGVtcycsXHJcbiAgICAgICAgICAgICdhb3NzOkRlc2NyaWJlQ29sbGVjdGlvbkl0ZW1zJ1xyXG4gICAgICAgICAgXVxyXG4gICAgICAgIH0sIHtcclxuICAgICAgICAgIFJlc291cmNlVHlwZTogJ2luZGV4JyxcclxuICAgICAgICAgIFJlc291cmNlOiBbJ2luZGV4L3ZlY3Rvci1jb2xsZWN0aW9uLyonXSxcclxuICAgICAgICAgIFBlcm1pc3Npb246IFtcclxuICAgICAgICAgICAgJ2Fvc3M6Q3JlYXRlSW5kZXgnLFxyXG4gICAgICAgICAgICAnYW9zczpEZWxldGVJbmRleCcsXHJcbiAgICAgICAgICAgICdhb3NzOlVwZGF0ZUluZGV4JyxcclxuICAgICAgICAgICAgJ2Fvc3M6RGVzY3JpYmVJbmRleCcsXHJcbiAgICAgICAgICAgICdhb3NzOlJlYWREb2N1bWVudCcsXHJcbiAgICAgICAgICAgICdhb3NzOldyaXRlRG9jdW1lbnQnXHJcbiAgICAgICAgICBdXHJcbiAgICAgICAgfV0sXHJcbiAgICAgICAgUHJpbmNpcGFsOiBbXHJcbiAgICAgICAgICB2ZWN0b3JpemVDb250ZW50RnVuY3Rpb24ucm9sZT8ucm9sZUFybixcclxuICAgICAgICBdLmZpbHRlcihCb29sZWFuKVxyXG4gICAgICB9XSlcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBBbmFseXNpcyBXb3JrZmxvdyBMYW1iZGEgRnVuY3Rpb25zIChhZnRlciB2ZWN0b3JDb2xsZWN0aW9uIGlzIGNyZWF0ZWQpXHJcbiAgICB0aGlzLmNyZWF0ZUFuYWx5c2lzV29ya2Zsb3dGdW5jdGlvbnMoKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgQVBJIExheWVyIGNvbXBvbmVudHNcclxuICAgIHRoaXMuY3JlYXRlQVBJTGF5ZXIoKTtcclxuXHJcbiAgICAvLyBBZGQgdGFncyB0byBhbGwgcmVzb3VyY2VzXHJcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ1Byb2plY3QnLCAnQ29tcGxpQWdlbnQtU0cnKTtcclxuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnRW52aXJvbm1lbnQnLCAnUHJvZHVjdGlvbicpO1xyXG4gICAgY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdNYW5hZ2VkQnknLCAnQ0RLJyk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNyZWF0ZUFuYWx5c2lzV29ya2Zsb3dGdW5jdGlvbnMoKTogdm9pZCB7XHJcbiAgICAvLyBPcGVuU2VhcmNoIFF1ZXJ5IExhbWJkYVxyXG4gICAgY29uc3Qgb3BlbnNlYXJjaFF1ZXJ5RnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdPcGVuU2VhcmNoUXVlcnlGdW5jdGlvbicsIHtcclxuICAgICAgZnVuY3Rpb25OYW1lOiAnQ29tcGxpQWdlbnQtT3BlblNlYXJjaFF1ZXJ5JyxcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfMTAsXHJcbiAgICAgIGhhbmRsZXI6ICdhcHAubGFtYmRhX2hhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uLy4uL3NyYy9sYW1iZGEvb3BlbnNlYXJjaF9xdWVyeScpLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIE9QRU5TRUFSQ0hfRU5EUE9JTlQ6IGBodHRwczovLyR7dGhpcy52ZWN0b3JDb2xsZWN0aW9uLmF0dHJDb2xsZWN0aW9uRW5kcG9pbnR9YCxcclxuICAgICAgICBPUEVOU0VBUkNIX0lOREVYOiAnZG9jdW1lbnRzJyxcclxuICAgICAgfSxcclxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdPcGVuU2VhcmNoUXVlcnlSb2xlJywge1xyXG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxyXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xyXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXHJcbiAgICAgICAgXSxcclxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xyXG4gICAgICAgICAgT3BlblNlYXJjaFF1ZXJ5UG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgICAgICAgc3RhdGVtZW50czogW1xyXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgICAgJ2JlZHJvY2s6SW52b2tlTW9kZWwnLFxyXG4gICAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWydhcm46YXdzOmJlZHJvY2s6Kjo6Zm91bmRhdGlvbi1tb2RlbC9hbWF6b24udGl0YW4tZW1iZWQtdGV4dC12MSddLFxyXG4gICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgICAgJ2Fvc3M6QVBJQWNjZXNzQWxsJyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLnZlY3RvckNvbGxlY3Rpb24uYXR0ckFybl0sXHJcbiAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICB9LFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEJlZHJvY2sgR2FwIEFuYWx5c2lzIExhbWJkYVxyXG4gICAgY29uc3QgYmVkcm9ja0dhcEFuYWx5c2lzRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdCZWRyb2NrR2FwQW5hbHlzaXNGdW5jdGlvbicsIHtcclxuICAgICAgZnVuY3Rpb25OYW1lOiAnQ29tcGxpQWdlbnQtQmVkcm9ja0dhcEFuYWx5c2lzJyxcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfMTAsXHJcbiAgICAgIGhhbmRsZXI6ICdhcHAubGFtYmRhX2hhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uLy4uL3NyYy9sYW1iZGEvYmVkcm9ja19nYXBfYW5hbHlzaXMnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTApLFxyXG4gICAgICBtZW1vcnlTaXplOiAxMDI0LFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIENMQVVERV9NT0RFTF9JRDogJ2FudGhyb3BpYy5jbGF1ZGUtMy1zb25uZXQtMjAyNDAyMjktdjE6MCcsXHJcbiAgICAgIH0sXHJcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnQmVkcm9ja0dhcEFuYWx5c2lzUm9sZScsIHtcclxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcclxuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcclxuICAgICAgICAgIEJlZHJvY2tHYXBBbmFseXNpc1BvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XHJcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcclxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsJyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnYXJuOmF3czpiZWRyb2NrOio6OmZvdW5kYXRpb24tbW9kZWwvYW50aHJvcGljLmNsYXVkZS0zLXNvbm5ldC0yMDI0MDIyOS12MTowJ10sXHJcbiAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICB9LFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFN0b3JlIEdhcHMgTGFtYmRhXHJcbiAgICBjb25zdCBzdG9yZUdhcHNGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1N0b3JlR2Fwc0Z1bmN0aW9uJywge1xyXG4gICAgICBmdW5jdGlvbk5hbWU6ICdDb21wbGlBZ2VudC1TdG9yZUdhcHMnLFxyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMCxcclxuICAgICAgaGFuZGxlcjogJ2FwcC5sYW1iZGFfaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi4vLi4vc3JjL2xhbWJkYS9zdG9yZV9nYXBzJyksXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgR0FQU19UQUJMRV9OQU1FOiB0aGlzLmdhcHNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgIH0sXHJcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnU3RvcmVHYXBzUm9sZScsIHtcclxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcclxuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcclxuICAgICAgICAgIFN0b3JlR2Fwc1BvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XHJcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcclxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpQdXRJdGVtJyxcclxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlVwZGF0ZUl0ZW0nLFxyXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6R2V0SXRlbScsXHJcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpRdWVyeScsXHJcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpTY2FuJyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcclxuICAgICAgICAgICAgICAgICAgdGhpcy5nYXBzVGFibGUudGFibGVBcm4sXHJcbiAgICAgICAgICAgICAgICAgIGAke3RoaXMuZ2Fwc1RhYmxlLnRhYmxlQXJufS9pbmRleC8qYCxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgICAna21zOkRlY3J5cHQnLFxyXG4gICAgICAgICAgICAgICAgICAna21zOkdlbmVyYXRlRGF0YUtleScsXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy5lbmNyeXB0aW9uS2V5LmtleUFybl0sXHJcbiAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICB9LFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBHYXAgQW5hbHlzaXMgV29ya2Zsb3dcclxuICAgIGNvbnN0IHF1ZXJ5VmVjdG9yU3RvcmUgPSBuZXcgc3RlcGZ1bmN0aW9uc1Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnUXVlcnlWZWN0b3JTdG9yZScsIHtcclxuICAgICAgbGFtYmRhRnVuY3Rpb246IG9wZW5zZWFyY2hRdWVyeUZ1bmN0aW9uLFxyXG4gICAgICBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyxcclxuICAgICAgcmV0cnlPblNlcnZpY2VFeGNlcHRpb25zOiB0cnVlLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgYW5hbHl6ZUdhcHMgPSBuZXcgc3RlcGZ1bmN0aW9uc1Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnQW5hbHl6ZUdhcHMnLCB7XHJcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiBiZWRyb2NrR2FwQW5hbHlzaXNGdW5jdGlvbixcclxuICAgICAgaW5wdXRQYXRoOiAnJCcsXHJcbiAgICAgIG91dHB1dFBhdGg6ICckLlBheWxvYWQnLFxyXG4gICAgICByZXRyeU9uU2VydmljZUV4Y2VwdGlvbnM6IHRydWUsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBzdG9yZUdhcHMgPSBuZXcgc3RlcGZ1bmN0aW9uc1Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnU3RvcmVHYXBzJywge1xyXG4gICAgICBsYW1iZGFGdW5jdGlvbjogc3RvcmVHYXBzRnVuY3Rpb24sXHJcbiAgICAgIGlucHV0UGF0aDogJyQuYm9keScsXHJcbiAgICAgIG91dHB1dFBhdGg6ICckLlBheWxvYWQnLFxyXG4gICAgICByZXRyeU9uU2VydmljZUV4Y2VwdGlvbnM6IHRydWUsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBEZWZpbmUgdGhlIHdvcmtmbG93IGNoYWluXHJcbiAgICBjb25zdCBnYXBBbmFseXNpc0RlZmluaXRpb24gPSBxdWVyeVZlY3RvclN0b3JlLm5leHQoYW5hbHl6ZUdhcHMpLm5leHQoc3RvcmVHYXBzKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgdGhlIEdhcCBBbmFseXNpcyBTdGF0ZSBNYWNoaW5lXHJcbiAgICB0aGlzLmdhcEFuYWx5c2lzV29ya2Zsb3cgPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdGF0ZU1hY2hpbmUodGhpcywgJ0dhcEFuYWx5c2lzV29ya2Zsb3cnLCB7XHJcbiAgICAgIHN0YXRlTWFjaGluZU5hbWU6ICdDb21wbGlBZ2VudC1HYXBBbmFseXNpcycsXHJcbiAgICAgIGRlZmluaXRpb246IGdhcEFuYWx5c2lzRGVmaW5pdGlvbixcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMzApLFxyXG4gICAgICB0cmFjaW5nRW5hYmxlZDogdHJ1ZSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVBUElMYXllcigpOiB2b2lkIHtcclxuICAgIC8vIENyZWF0ZSBDb2duaXRvIFVzZXIgUG9vbCBmb3IgYXV0aGVudGljYXRpb25cclxuICAgIHRoaXMudXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCAnQ29tcGxpQWdlbnRVc2VyUG9vbCcsIHtcclxuICAgICAgdXNlclBvb2xOYW1lOiAnQ29tcGxpQWdlbnQtU0ctVXNlcnMnLFxyXG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogdHJ1ZSxcclxuICAgICAgc2lnbkluQWxpYXNlczoge1xyXG4gICAgICAgIGVtYWlsOiB0cnVlLFxyXG4gICAgICB9LFxyXG4gICAgICBhdXRvVmVyaWZ5OiB7XHJcbiAgICAgICAgZW1haWw6IHRydWUsXHJcbiAgICAgIH0sXHJcbiAgICAgIHBhc3N3b3JkUG9saWN5OiB7XHJcbiAgICAgICAgbWluTGVuZ3RoOiA4LFxyXG4gICAgICAgIHJlcXVpcmVMb3dlcmNhc2U6IHRydWUsXHJcbiAgICAgICAgcmVxdWlyZVVwcGVyY2FzZTogdHJ1ZSxcclxuICAgICAgICByZXF1aXJlRGlnaXRzOiB0cnVlLFxyXG4gICAgICAgIHJlcXVpcmVTeW1ib2xzOiB0cnVlLFxyXG4gICAgICB9LFxyXG4gICAgICBhY2NvdW50UmVjb3Zlcnk6IGNvZ25pdG8uQWNjb3VudFJlY292ZXJ5LkVNQUlMX09OTFksXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBVc2VyIFBvb2wgQ2xpZW50XHJcbiAgICBjb25zdCB1c2VyUG9vbENsaWVudCA9IG5ldyBjb2duaXRvLlVzZXJQb29sQ2xpZW50KHRoaXMsICdDb21wbGlBZ2VudFVzZXJQb29sQ2xpZW50Jywge1xyXG4gICAgICB1c2VyUG9vbDogdGhpcy51c2VyUG9vbCxcclxuICAgICAgdXNlclBvb2xDbGllbnROYW1lOiAnQ29tcGxpQWdlbnQtU0ctQ2xpZW50JyxcclxuICAgICAgZ2VuZXJhdGVTZWNyZXQ6IGZhbHNlLFxyXG4gICAgICBhdXRoRmxvd3M6IHtcclxuICAgICAgICB1c2VyUGFzc3dvcmQ6IHRydWUsXHJcbiAgICAgICAgdXNlclNycDogdHJ1ZSxcclxuICAgICAgfSxcclxuICAgICAgb0F1dGg6IHtcclxuICAgICAgICBmbG93czoge1xyXG4gICAgICAgICAgYXV0aG9yaXphdGlvbkNvZGVHcmFudDogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHNjb3BlczogW1xyXG4gICAgICAgICAgY29nbml0by5PQXV0aFNjb3BlLkVNQUlMLFxyXG4gICAgICAgICAgY29nbml0by5PQXV0aFNjb3BlLk9QRU5JRCxcclxuICAgICAgICAgIGNvZ25pdG8uT0F1dGhTY29wZS5QUk9GSUxFLFxyXG4gICAgICAgIF0sXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgV2ViU29ja2V0IGNvbm5lY3Rpb25zIHRhYmxlXHJcbiAgICB0aGlzLmNvbm5lY3Rpb25zVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1dlYlNvY2tldENvbm5lY3Rpb25zVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ0NvbXBsaUFnZW50LVdlYlNvY2tldENvbm5lY3Rpb25zJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdjb25uZWN0aW9uSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQ1VTVE9NRVJfTUFOQUdFRCxcclxuICAgICAgZW5jcnlwdGlvbktleTogdGhpcy5lbmNyeXB0aW9uS2V5LFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLCAvLyBXZWJTb2NrZXQgY29ubmVjdGlvbnMgYXJlIGVwaGVtZXJhbFxyXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFkZCBHU0kgZm9yIHVzZXJJZCBsb29rdXBzXHJcbiAgICB0aGlzLmNvbm5lY3Rpb25zVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICd1c2VySWRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAndXNlcklkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBBUEkgSGFuZGxlciBMYW1iZGFcclxuICAgIGNvbnN0IGFwaUhhbmRsZXJGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0FwaUhhbmRsZXJGdW5jdGlvbicsIHtcclxuICAgICAgZnVuY3Rpb25OYW1lOiAnQ29tcGxpQWdlbnQtQXBpSGFuZGxlcicsXHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzEwLFxyXG4gICAgICBoYW5kbGVyOiAnYXBwLmxhbWJkYV9oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi8uLi9zcmMvbGFtYmRhL2FwaV9oYW5kbGVyJyksXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgR0FQU19UQUJMRV9OQU1FOiB0aGlzLmdhcHNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQU1FTkRNRU5UU19UQUJMRV9OQU1FOiB0aGlzLmFtZW5kbWVudHNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgR0FQX0FOQUxZU0lTX1NUQVRFX01BQ0hJTkVfQVJOOiB0aGlzLmdhcEFuYWx5c2lzV29ya2Zsb3cuc3RhdGVNYWNoaW5lQXJuLFxyXG4gICAgICB9LFxyXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ0FwaUhhbmRsZXJSb2xlJywge1xyXG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxyXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xyXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXHJcbiAgICAgICAgXSxcclxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xyXG4gICAgICAgICAgQXBpSGFuZGxlclBvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XHJcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcclxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpHZXRJdGVtJyxcclxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlB1dEl0ZW0nLFxyXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6VXBkYXRlSXRlbScsXHJcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpRdWVyeScsXHJcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpTY2FuJyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcclxuICAgICAgICAgICAgICAgICAgdGhpcy5nYXBzVGFibGUudGFibGVBcm4sXHJcbiAgICAgICAgICAgICAgICAgIGAke3RoaXMuZ2Fwc1RhYmxlLnRhYmxlQXJufS9pbmRleC8qYCxcclxuICAgICAgICAgICAgICAgICAgdGhpcy5hbWVuZG1lbnRzVGFibGUudGFibGVBcm4sXHJcbiAgICAgICAgICAgICAgICAgIGAke3RoaXMuYW1lbmRtZW50c1RhYmxlLnRhYmxlQXJufS9pbmRleC8qYCxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgICAnc3RhdGVzOlN0YXJ0RXhlY3V0aW9uJyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLmdhcEFuYWx5c2lzV29ya2Zsb3cuc3RhdGVNYWNoaW5lQXJuXSxcclxuICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAgICdrbXM6RGVjcnlwdCcsXHJcbiAgICAgICAgICAgICAgICAgICdrbXM6R2VuZXJhdGVEYXRhS2V5JyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLmVuY3J5cHRpb25LZXkua2V5QXJuXSxcclxuICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgXSxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIENvZ25pdG8gQXV0aG9yaXplclxyXG4gICAgY29uc3QgY29nbml0b0F1dGhvcml6ZXIgPSBuZXcgYXBpZ2F0ZXdheS5Db2duaXRvVXNlclBvb2xzQXV0aG9yaXplcih0aGlzLCAnQ29nbml0b0F1dGhvcml6ZXInLCB7XHJcbiAgICAgIGNvZ25pdG9Vc2VyUG9vbHM6IFt0aGlzLnVzZXJQb29sXSxcclxuICAgICAgYXV0aG9yaXplck5hbWU6ICdDb21wbGlBZ2VudC1BdXRob3JpemVyJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBSRVNUIEFQSVxyXG4gICAgdGhpcy5yZXN0QXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnQ29tcGxpQWdlbnRSZXN0QXBpJywge1xyXG4gICAgICByZXN0QXBpTmFtZTogJ0NvbXBsaUFnZW50LVNHLUFQSScsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnUkVTVCBBUEkgZm9yIENvbXBsaUFnZW50LVNHIHN5c3RlbScsXHJcbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczoge1xyXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLFxyXG4gICAgICAgIGFsbG93TWV0aG9kczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9NRVRIT0RTLFxyXG4gICAgICAgIGFsbG93SGVhZGVyczogW1xyXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZScsXHJcbiAgICAgICAgICAnWC1BbXotRGF0ZScsXHJcbiAgICAgICAgICAnQXV0aG9yaXphdGlvbicsXHJcbiAgICAgICAgICAnWC1BcGktS2V5JyxcclxuICAgICAgICAgICdYLUFtei1TZWN1cml0eS1Ub2tlbicsXHJcbiAgICAgICAgXSxcclxuICAgICAgfSxcclxuICAgICAgZGVwbG95T3B0aW9uczoge1xyXG4gICAgICAgIHN0YWdlTmFtZTogJ3Byb2QnLFxyXG4gICAgICAgIHRocm90dGxpbmdSYXRlTGltaXQ6IDEwMCxcclxuICAgICAgICB0aHJvdHRsaW5nQnVyc3RMaW1pdDogMjAwLFxyXG4gICAgICAgIGxvZ2dpbmdMZXZlbDogYXBpZ2F0ZXdheS5NZXRob2RMb2dnaW5nTGV2ZWwuSU5GTyxcclxuICAgICAgICBkYXRhVHJhY2VFbmFibGVkOiB0cnVlLFxyXG4gICAgICAgIG1ldHJpY3NFbmFibGVkOiB0cnVlLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIExhbWJkYSBpbnRlZ3JhdGlvblxyXG4gICAgY29uc3QgbGFtYmRhSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihhcGlIYW5kbGVyRnVuY3Rpb24sIHtcclxuICAgICAgcmVxdWVzdFRlbXBsYXRlczogeyAnYXBwbGljYXRpb24vanNvbic6ICd7IFwic3RhdHVzQ29kZVwiOiBcIjIwMFwiIH0nIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGQgQVBJIGVuZHBvaW50c1xyXG4gICAgLy8gR0VUIC9nYXBzXHJcbiAgICBjb25zdCBnYXBzUmVzb3VyY2UgPSB0aGlzLnJlc3RBcGkucm9vdC5hZGRSZXNvdXJjZSgnZ2FwcycpO1xyXG4gICAgZ2Fwc1Jlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbGFtYmRhSW50ZWdyYXRpb24sIHtcclxuICAgICAgYXV0aG9yaXplcjogY29nbml0b0F1dGhvcml6ZXIsXHJcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBQT1NUIC9nYXBzL3tnYXBJZH0vYWNrbm93bGVkZ2VcclxuICAgIGNvbnN0IGdhcFJlc291cmNlID0gZ2Fwc1Jlc291cmNlLmFkZFJlc291cmNlKCd7Z2FwSWR9Jyk7XHJcbiAgICBjb25zdCBhY2tub3dsZWRnZVJlc291cmNlID0gZ2FwUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2Fja25vd2xlZGdlJyk7XHJcbiAgICBhY2tub3dsZWRnZVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGxhbWJkYUludGVncmF0aW9uLCB7XHJcbiAgICAgIGF1dGhvcml6ZXI6IGNvZ25pdG9BdXRob3JpemVyLFxyXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR0VUIC9hbWVuZG1lbnRzXHJcbiAgICBjb25zdCBhbWVuZG1lbnRzUmVzb3VyY2UgPSB0aGlzLnJlc3RBcGkucm9vdC5hZGRSZXNvdXJjZSgnYW1lbmRtZW50cycpO1xyXG4gICAgYW1lbmRtZW50c1Jlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbGFtYmRhSW50ZWdyYXRpb24sIHtcclxuICAgICAgYXV0aG9yaXplcjogY29nbml0b0F1dGhvcml6ZXIsXHJcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBQT1NUIC9hbWVuZG1lbnRzL3thbWVuZG1lbnRJZH0vYXBwcm92ZVxyXG4gICAgY29uc3QgYW1lbmRtZW50UmVzb3VyY2UgPSBhbWVuZG1lbnRzUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3thbWVuZG1lbnRJZH0nKTtcclxuICAgIGNvbnN0IGFwcHJvdmVSZXNvdXJjZSA9IGFtZW5kbWVudFJlc291cmNlLmFkZFJlc291cmNlKCdhcHByb3ZlJyk7XHJcbiAgICBhcHByb3ZlUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgbGFtYmRhSW50ZWdyYXRpb24sIHtcclxuICAgICAgYXV0aG9yaXplcjogY29nbml0b0F1dGhvcml6ZXIsXHJcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBQT1NUIC9hbmFseXNpcy9zdGFydFxyXG4gICAgY29uc3QgYW5hbHlzaXNSZXNvdXJjZSA9IHRoaXMucmVzdEFwaS5yb290LmFkZFJlc291cmNlKCdhbmFseXNpcycpO1xyXG4gICAgY29uc3Qgc3RhcnRBbmFseXNpc1Jlc291cmNlID0gYW5hbHlzaXNSZXNvdXJjZS5hZGRSZXNvdXJjZSgnc3RhcnQnKTtcclxuICAgIHN0YXJ0QW5hbHlzaXNSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBsYW1iZGFJbnRlZ3JhdGlvbiwge1xyXG4gICAgICBhdXRob3JpemVyOiBjb2duaXRvQXV0aG9yaXplcixcclxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUTyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFBPU1QgL2FtZW5kbWVudHMvZHJhZnRcclxuICAgIGNvbnN0IGRyYWZ0UmVzb3VyY2UgPSBhbWVuZG1lbnRzUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2RyYWZ0Jyk7XHJcbiAgICBkcmFmdFJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGxhbWJkYUludGVncmF0aW9uLCB7XHJcbiAgICAgIGF1dGhvcml6ZXI6IGNvZ25pdG9BdXRob3JpemVyLFxyXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR0VUIC9oZWFsdGggKG5vIGF1dGggcmVxdWlyZWQpXHJcbiAgICBjb25zdCBoZWFsdGhSZXNvdXJjZSA9IHRoaXMucmVzdEFwaS5yb290LmFkZFJlc291cmNlKCdoZWFsdGgnKTtcclxuICAgIGhlYWx0aFJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbGFtYmRhSW50ZWdyYXRpb24pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBXZWJTb2NrZXQgSGFuZGxlciBMYW1iZGEgKGZvciBmdXR1cmUgV2ViU29ja2V0IEFQSSBpbXBsZW1lbnRhdGlvbilcclxuICAgIGNvbnN0IHdlYlNvY2tldEhhbmRsZXJGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1dlYlNvY2tldEhhbmRsZXJGdW5jdGlvbicsIHtcclxuICAgICAgZnVuY3Rpb25OYW1lOiAnQ29tcGxpQWdlbnQtV2ViU29ja2V0SGFuZGxlcicsXHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzEwLFxyXG4gICAgICBoYW5kbGVyOiAnYXBwLmxhbWJkYV9oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi8uLi9zcmMvbGFtYmRhL3dlYnNvY2tldF9oYW5kbGVyJyksXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgQ09OTkVDVElPTlNfVEFCTEVfTkFNRTogdGhpcy5jb25uZWN0aW9uc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgfSxcclxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdXZWJTb2NrZXRIYW5kbGVyUm9sZScsIHtcclxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcclxuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcclxuICAgICAgICAgIFdlYlNvY2tldEhhbmRsZXJQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xyXG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXHJcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6R2V0SXRlbScsXHJcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpQdXRJdGVtJyxcclxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlVwZGF0ZUl0ZW0nLFxyXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6RGVsZXRlSXRlbScsXHJcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpRdWVyeScsXHJcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpTY2FuJyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcclxuICAgICAgICAgICAgICAgICAgdGhpcy5jb25uZWN0aW9uc1RhYmxlLnRhYmxlQXJuLFxyXG4gICAgICAgICAgICAgICAgICBgJHt0aGlzLmNvbm5lY3Rpb25zVGFibGUudGFibGVBcm59L2luZGV4LypgLFxyXG4gICAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAgICdleGVjdXRlLWFwaTpNYW5hZ2VDb25uZWN0aW9ucycsXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJ2Fybjphd3M6ZXhlY3V0ZS1hcGk6KjoqOiovQGNvbm5lY3Rpb25zLyonXSxcclxuICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAgICdrbXM6RGVjcnlwdCcsXHJcbiAgICAgICAgICAgICAgICAgICdrbXM6R2VuZXJhdGVEYXRhS2V5JyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLmVuY3J5cHRpb25LZXkua2V5QXJuXSxcclxuICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgXSxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59XHJcbiJdfQ==
