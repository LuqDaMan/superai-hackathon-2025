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
        new opensearchserverless.CfnAccessPolicy(this, 'VectorCollectionDataAccessPolicy', {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tcGxpYWdlbnQtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjb21wbGlhZ2VudC1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMseUNBQXlDO0FBQ3pDLHFEQUFxRDtBQUNyRCw2RUFBNkU7QUFDN0UsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyxpREFBaUQ7QUFDakQsaURBQWlEO0FBQ2pELDBEQUEwRDtBQUMxRCwyQ0FBMkM7QUFDM0Msc0VBQXNFO0FBQ3RFLHdEQUF3RDtBQUN4RCwrREFBK0Q7QUFDL0QsMEVBQTBFO0FBRTFFLHlEQUF5RDtBQUN6RCxtREFBbUQ7QUFFbkQsTUFBYSxnQkFBaUIsU0FBUSxHQUFHLENBQUMsS0FBSztJQWtCN0MsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixnQ0FBZ0M7UUFDaEMsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLDBCQUEwQixFQUFFO1lBQ2pFLGlCQUFpQixFQUFFLElBQUk7WUFDdkIsV0FBVyxFQUFFLHVDQUF1QztZQUNwRCxLQUFLLEVBQUUsc0JBQXNCO1NBQzlCLENBQUMsQ0FBQztRQUVILGtFQUFrRTtRQUNsRSxNQUFNLFNBQVMsR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUM7UUFDN0MsTUFBTSxNQUFNLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDO1FBRXpDLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLEVBQUUsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzlELFVBQVUsRUFBRSxnQkFBZ0IsU0FBUyxJQUFJLE1BQU0sRUFBRTtZQUNqRCxTQUFTLEVBQUUsSUFBSTtZQUNmLFVBQVUsRUFBRSxFQUFFLENBQUMsZ0JBQWdCLENBQUMsR0FBRztZQUNuQyxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsaUJBQWlCLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLFNBQVM7WUFDakQsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsTUFBTTtZQUN2QyxjQUFjLEVBQUUsQ0FBQztvQkFDZixFQUFFLEVBQUUsbUJBQW1CO29CQUN2QiwyQkFBMkIsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7aUJBQ25ELENBQUM7U0FDSCxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUN4RSxVQUFVLEVBQUUscUJBQXFCLFNBQVMsSUFBSSxNQUFNLEVBQUU7WUFDdEQsU0FBUyxFQUFFLElBQUk7WUFDZixVQUFVLEVBQUUsRUFBRSxDQUFDLGdCQUFnQixDQUFDLEdBQUc7WUFDbkMsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhO1lBQ2pDLGlCQUFpQixFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxTQUFTO1lBQ2pELGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU07WUFDdkMsY0FBYyxFQUFFLENBQUM7b0JBQ2YsRUFBRSxFQUFFLG1CQUFtQjtvQkFDdkIsMkJBQTJCLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO2lCQUNuRCxDQUFDO1NBQ0gsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLHVCQUF1QixHQUFHLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUseUJBQXlCLEVBQUU7WUFDNUUsVUFBVSxFQUFFLHVCQUF1QixTQUFTLElBQUksTUFBTSxFQUFFO1lBQ3hELFVBQVUsRUFBRSxFQUFFLENBQUMsZ0JBQWdCLENBQUMsR0FBRztZQUNuQyxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsaUJBQWlCLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLFNBQVM7WUFDakQsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsTUFBTTtZQUN2QyxjQUFjLEVBQUUsQ0FBQztvQkFDZixFQUFFLEVBQUUsd0JBQXdCO29CQUM1QixVQUFVLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDO2lCQUNuQyxDQUFDO1NBQ0gsQ0FBQyxDQUFDO1FBRUgseUJBQXlCO1FBQ3pCLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxXQUFXLEVBQUU7WUFDckQsU0FBUyxFQUFFLHVCQUF1QjtZQUNsQyxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUNwRSxXQUFXLEVBQUUsUUFBUSxDQUFDLFdBQVcsQ0FBQyxlQUFlO1lBQ2pELFVBQVUsRUFBRSxRQUFRLENBQUMsZUFBZSxDQUFDLGdCQUFnQjtZQUNyRCxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsTUFBTTtZQUN2QyxtQkFBbUIsRUFBRSxJQUFJO1NBQzFCLENBQUMsQ0FBQztRQUVILHdDQUF3QztRQUN4QyxJQUFJLENBQUMsU0FBUyxDQUFDLHVCQUF1QixDQUFDO1lBQ3JDLFNBQVMsRUFBRSxtQkFBbUI7WUFDOUIsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLGNBQWMsRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUU7WUFDM0UsY0FBYyxFQUFFLFFBQVEsQ0FBQyxjQUFjLENBQUMsR0FBRztTQUM1QyxDQUFDLENBQUM7UUFFSCxrQ0FBa0M7UUFDbEMsSUFBSSxDQUFDLFNBQVMsQ0FBQyx1QkFBdUIsQ0FBQztZQUNyQyxTQUFTLEVBQUUsYUFBYTtZQUN4QixZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUNyRSxPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUNuRSxjQUFjLEVBQUUsUUFBUSxDQUFDLGNBQWMsQ0FBQyxHQUFHO1NBQzVDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUNqRSxTQUFTLEVBQUUsNkJBQTZCO1lBQ3hDLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFO1lBQzFFLFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsVUFBVSxFQUFFLFFBQVEsQ0FBQyxlQUFlLENBQUMsZ0JBQWdCO1lBQ3JELGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYTtZQUNqQyxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxNQUFNO1lBQ3ZDLG1CQUFtQixFQUFFLElBQUk7U0FDMUIsQ0FBQyxDQUFDO1FBRUgsdUNBQXVDO1FBQ3ZDLElBQUksQ0FBQyxlQUFlLENBQUMsdUJBQXVCLENBQUM7WUFDM0MsU0FBUyxFQUFFLFlBQVk7WUFDdkIsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUU7WUFDcEUsY0FBYyxFQUFFLFFBQVEsQ0FBQyxjQUFjLENBQUMsR0FBRztTQUM1QyxDQUFDLENBQUM7UUFFSCx3Q0FBd0M7UUFDeEMsSUFBSSxDQUFDLGVBQWUsQ0FBQyx1QkFBdUIsQ0FBQztZQUMzQyxTQUFTLEVBQUUsYUFBYTtZQUN4QixZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUNyRSxPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUNuRSxjQUFjLEVBQUUsUUFBUSxDQUFDLGNBQWMsQ0FBQyxHQUFHO1NBQzVDLENBQUMsQ0FBQztRQUVILGlDQUFpQztRQUNqQyxNQUFNLHFCQUFxQixHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUU7WUFDOUUsU0FBUyxFQUFFLDhCQUE4QjtZQUN6QyxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsYUFBYSxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUMxRSxXQUFXLEVBQUUsUUFBUSxDQUFDLFdBQVcsQ0FBQyxlQUFlO1lBQ2pELFVBQVUsRUFBRSxRQUFRLENBQUMsZUFBZSxDQUFDLGdCQUFnQjtZQUNyRCxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7WUFDakMsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsTUFBTTtZQUN2QyxtQkFBbUIsRUFBRSxJQUFJO1NBQzFCLENBQUMsQ0FBQztRQUVILDBCQUEwQjtRQUMxQixxQkFBcUIsQ0FBQyx1QkFBdUIsQ0FBQztZQUM1QyxTQUFTLEVBQUUsVUFBVTtZQUNyQixZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUNsRSxjQUFjLEVBQUUsUUFBUSxDQUFDLGNBQWMsQ0FBQyxHQUFHO1NBQzVDLENBQUMsQ0FBQztRQUVILGlEQUFpRDtRQUNqRCxNQUFNLGdCQUFnQixHQUFHLElBQUksb0JBQW9CLENBQUMsaUJBQWlCLENBQUMsSUFBSSxFQUFFLGtDQUFrQyxFQUFFO1lBQzVHLElBQUksRUFBRSxxQ0FBcUM7WUFDM0MsSUFBSSxFQUFFLFlBQVk7WUFDbEIsTUFBTSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ3JCLEtBQUssRUFBRSxDQUFDO3dCQUNOLFlBQVksRUFBRSxZQUFZO3dCQUMxQixRQUFRLEVBQUUsQ0FBQyw4QkFBOEIsQ0FBQztxQkFDM0MsQ0FBQztnQkFDRixXQUFXLEVBQUUsSUFBSTthQUNsQixDQUFDO1NBQ0gsQ0FBQyxDQUFDO1FBRUgsTUFBTSxhQUFhLEdBQUcsSUFBSSxvQkFBb0IsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLEVBQUUsK0JBQStCLEVBQUU7WUFDdEcsSUFBSSxFQUFFLGtDQUFrQztZQUN4QyxJQUFJLEVBQUUsU0FBUztZQUNmLE1BQU0sRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7b0JBQ3RCLEtBQUssRUFBRSxDQUFDOzRCQUNOLFlBQVksRUFBRSxZQUFZOzRCQUMxQixRQUFRLEVBQUUsQ0FBQyw4QkFBOEIsQ0FBQzt5QkFDM0MsRUFBRTs0QkFDRCxZQUFZLEVBQUUsV0FBVzs0QkFDekIsUUFBUSxFQUFFLENBQUMsOEJBQThCLENBQUM7eUJBQzNDLENBQUM7b0JBQ0YsZUFBZSxFQUFFLElBQUk7aUJBQ3RCLENBQUMsQ0FBQztTQUNKLENBQUMsQ0FBQztRQUVILDBDQUEwQztRQUMxQyxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxvQkFBb0IsQ0FBQyxhQUFhLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQ3ZGLElBQUksRUFBRSxtQkFBbUI7WUFDekIsSUFBSSxFQUFFLGNBQWM7WUFDcEIsV0FBVyxFQUFFLDBEQUEwRDtTQUN4RSxDQUFDLENBQUM7UUFFSCx1REFBdUQ7UUFDdkQsSUFBSSxDQUFDLGdCQUFnQixDQUFDLGFBQWEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBQ3RELElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhLENBQUMsYUFBYSxDQUFDLENBQUM7UUFFbkQseURBQXlEO1FBQ3pELE1BQU0sdUJBQXVCLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSx5QkFBeUIsRUFBRTtZQUM3RSxTQUFTLEVBQUUsZ0NBQWdDO1lBQzNDLFdBQVcsRUFBRSx1Q0FBdUM7WUFDcEQsU0FBUyxFQUFFLElBQUksQ0FBQyxhQUFhO1NBQzlCLENBQUMsQ0FBQztRQUVILGlEQUFpRDtRQUNqRCxNQUFNLG1CQUFtQixHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7WUFDcEUsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLHdCQUF3QixDQUFDO1lBQzdELGNBQWMsRUFBRTtnQkFDZCxpQkFBaUIsRUFBRSxJQUFJLEdBQUcsQ0FBQyxjQUFjLENBQUM7b0JBQ3hDLFVBQVUsRUFBRTt3QkFDVixJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7NEJBQ3RCLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUs7NEJBQ3hCLE9BQU8sRUFBRSxDQUFDLGFBQWEsQ0FBQzs0QkFDeEIsU0FBUyxFQUFFLENBQUMsdUJBQXVCLENBQUMsUUFBUSxDQUFDO3lCQUM5QyxDQUFDO3FCQUNIO2lCQUNGLENBQUM7YUFDSDtTQUNGLENBQUMsQ0FBQztRQUVILHFDQUFxQztRQUNyQyxNQUFNLGtCQUFrQixHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDekUsWUFBWSxFQUFFLHdCQUF3QjtZQUN0QyxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ25DLE9BQU8sRUFBRSxvQkFBb0I7WUFDN0IsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLDhCQUE4QixDQUFDO1lBQzNELE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDakMsVUFBVSxFQUFFLEdBQUc7WUFDZixXQUFXLEVBQUU7Z0JBQ1gsZUFBZSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVO2dCQUNqRCxjQUFjLEVBQUUscUJBQXFCLENBQUMsU0FBUzthQUNoRDtZQUNELElBQUksRUFBRSxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO2dCQUN6QyxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUM7Z0JBQzNELGVBQWUsRUFBRTtvQkFDZixHQUFHLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUFDLDBDQUEwQyxDQUFDO2lCQUN2RjtnQkFDRCxjQUFjLEVBQUU7b0JBQ2QsZ0JBQWdCLEVBQUUsSUFBSSxHQUFHLENBQUMsY0FBYyxDQUFDO3dCQUN2QyxVQUFVLEVBQUU7NEJBQ1YsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO2dDQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO2dDQUN4QixPQUFPLEVBQUU7b0NBQ1AsY0FBYztvQ0FDZCxpQkFBaUI7aUNBQ2xCO2dDQUNELFNBQVMsRUFBRSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUM7NkJBQ3RELENBQUM7NEJBQ0YsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO2dDQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO2dDQUN4QixPQUFPLEVBQUU7b0NBQ1Asa0JBQWtCO29DQUNsQixrQkFBa0I7b0NBQ2xCLHFCQUFxQjtvQ0FDckIsZ0JBQWdCO2lDQUNqQjtnQ0FDRCxTQUFTLEVBQUU7b0NBQ1QscUJBQXFCLENBQUMsUUFBUTtvQ0FDOUIsR0FBRyxxQkFBcUIsQ0FBQyxRQUFRLFVBQVU7aUNBQzVDOzZCQUNGLENBQUM7NEJBQ0YsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO2dDQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO2dDQUN4QixPQUFPLEVBQUU7b0NBQ1AsYUFBYTtvQ0FDYixxQkFBcUI7aUNBQ3RCO2dDQUNELFNBQVMsRUFBRSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDOzZCQUN2QyxDQUFDO3lCQUNIO3FCQUNGLENBQUM7aUJBQ0g7YUFDRixDQUFDO1NBQ0gsQ0FBQyxDQUFDO1FBRUgsdURBQXVEO1FBQ3ZELE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUNyRSxRQUFRLEVBQUUsZ0NBQWdDO1lBQzFDLFdBQVcsRUFBRSwyQ0FBMkM7WUFDeEQsUUFBUSxFQUFFLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDO2dCQUM3QixNQUFNLEVBQUUsR0FBRztnQkFDWCxJQUFJLEVBQUUsR0FBRztnQkFDVCxHQUFHLEVBQUUsR0FBRztnQkFDUixLQUFLLEVBQUUsR0FBRztnQkFDVixJQUFJLEVBQUUsR0FBRzthQUNWLENBQUM7U0FDSCxDQUFDLENBQUM7UUFFSCxrQkFBa0IsQ0FBQyxTQUFTLENBQUMsSUFBSSxPQUFPLENBQUMsY0FBYyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQztRQUU3RSw0Q0FBNEM7UUFDNUMsTUFBTSx5QkFBeUIsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLDJCQUEyQixFQUFFO1lBQ3ZGLFlBQVksRUFBRSwrQkFBK0I7WUFDN0MsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVztZQUNuQyxPQUFPLEVBQUUsb0JBQW9CO1lBQzdCLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxxQ0FBcUMsQ0FBQztZQUNsRSxPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ2pDLFVBQVUsRUFBRSxJQUFJO1lBQ2hCLFdBQVcsRUFBRTtnQkFDWCxxQkFBcUIsRUFBRSxJQUFJLENBQUMsdUJBQXVCLENBQUMsVUFBVTtnQkFDOUQsYUFBYSxFQUFFLHVCQUF1QixDQUFDLFFBQVE7Z0JBQy9DLGlCQUFpQixFQUFFLG1CQUFtQixDQUFDLE9BQU87YUFDL0M7WUFDRCxJQUFJLEVBQUUsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtnQkFDaEQsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLHNCQUFzQixDQUFDO2dCQUMzRCxlQUFlLEVBQUU7b0JBQ2YsR0FBRyxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsQ0FBQywwQ0FBMEMsQ0FBQztpQkFDdkY7Z0JBQ0QsY0FBYyxFQUFFO29CQUNkLHVCQUF1QixFQUFFLElBQUksR0FBRyxDQUFDLGNBQWMsQ0FBQzt3QkFDOUMsVUFBVSxFQUFFOzRCQUNWLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztnQ0FDdEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztnQ0FDeEIsT0FBTyxFQUFFO29DQUNQLGNBQWM7aUNBQ2Y7Z0NBQ0QsU0FBUyxFQUFFO29DQUNULElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDO29DQUN4QyxJQUFJLENBQUMscUJBQXFCLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQztpQ0FDOUM7NkJBQ0YsQ0FBQzs0QkFDRixJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7Z0NBQ3RCLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUs7Z0NBQ3hCLE9BQU8sRUFBRTtvQ0FDUCxjQUFjO2lDQUNmO2dDQUNELFNBQVMsRUFBRSxDQUFDLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUM7NkJBQzdELENBQUM7NEJBQ0YsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO2dDQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO2dDQUN4QixPQUFPLEVBQUU7b0NBQ1AsZ0NBQWdDO29DQUNoQyw4QkFBOEI7b0NBQzlCLDBCQUEwQjtpQ0FDM0I7Z0NBQ0QsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDOzZCQUNqQixDQUFDOzRCQUNGLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztnQ0FDdEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztnQ0FDeEIsT0FBTyxFQUFFO29DQUNQLGNBQWM7aUNBQ2Y7Z0NBQ0QsU0FBUyxFQUFFLENBQUMsbUJBQW1CLENBQUMsT0FBTyxDQUFDOzZCQUN6QyxDQUFDOzRCQUNGLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztnQ0FDdEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztnQ0FDeEIsT0FBTyxFQUFFO29DQUNQLGFBQWE7b0NBQ2IscUJBQXFCO2lDQUN0QjtnQ0FDRCxTQUFTLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQzs2QkFDdkMsQ0FBQzt5QkFDSDtxQkFDRixDQUFDO2lCQUNIO2FBQ0YsQ0FBQztTQUNILENBQUMsQ0FBQztRQUVILDJDQUEyQztRQUMzQyxNQUFNLHdCQUF3QixHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsMEJBQTBCLEVBQUU7WUFDckYsWUFBWSxFQUFFLDhCQUE4QjtZQUM1QyxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ25DLE9BQU8sRUFBRSxvQkFBb0I7WUFDN0IsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLG9DQUFvQyxDQUFDO1lBQ2pFLE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDakMsVUFBVSxFQUFFLElBQUk7WUFDaEIsV0FBVyxFQUFFO2dCQUNYLG1CQUFtQixFQUFFLFdBQVcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLHNCQUFzQixFQUFFO2dCQUM5RSxnQkFBZ0IsRUFBRSxXQUFXO2FBQzlCO1lBQ0QsSUFBSSxFQUFFLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUU7Z0JBQy9DLFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQztnQkFDM0QsZUFBZSxFQUFFO29CQUNmLEdBQUcsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQUMsMENBQTBDLENBQUM7aUJBQ3ZGO2dCQUNELGNBQWMsRUFBRTtvQkFDZCxzQkFBc0IsRUFBRSxJQUFJLEdBQUcsQ0FBQyxjQUFjLENBQUM7d0JBQzdDLFVBQVUsRUFBRTs0QkFDVixJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7Z0NBQ3RCLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUs7Z0NBQ3hCLE9BQU8sRUFBRTtvQ0FDUCxjQUFjO2lDQUNmO2dDQUNELFNBQVMsRUFBRSxDQUFDLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUM7NkJBQzdELENBQUM7NEJBQ0YsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO2dDQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO2dDQUN4QixPQUFPLEVBQUU7b0NBQ1AscUJBQXFCO2lDQUN0QjtnQ0FDRCxTQUFTLEVBQUUsQ0FBQyxnRUFBZ0UsQ0FBQzs2QkFDOUUsQ0FBQzs0QkFDRixJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7Z0NBQ3RCLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUs7Z0NBQ3hCLE9BQU8sRUFBRTtvQ0FDUCxtQkFBbUI7aUNBQ3BCO2dDQUNELFNBQVMsRUFBRSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUM7NkJBQzNDLENBQUM7NEJBQ0YsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO2dDQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO2dDQUN4QixPQUFPLEVBQUU7b0NBQ1AsYUFBYTtpQ0FDZDtnQ0FDRCxTQUFTLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQzs2QkFDdkMsQ0FBQzt5QkFDSDtxQkFDRixDQUFDO2lCQUNIO2FBQ0YsQ0FBQztTQUNILENBQUMsQ0FBQztRQUVILGdDQUFnQztRQUNoQyxnRkFBZ0Y7UUFDaEYsSUFBSSxDQUFDLGdCQUFnQixDQUFDLG9CQUFvQixDQUN4QyxFQUFFLENBQUMsU0FBUyxDQUFDLGNBQWMsRUFDM0IsSUFBSSxHQUFHLENBQUMsaUJBQWlCLENBQUMseUJBQXlCLENBQUMsRUFDcEQsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLENBQ25CLENBQUM7UUFFRixJQUFJLENBQUMscUJBQXFCLENBQUMsb0JBQW9CLENBQzdDLEVBQUUsQ0FBQyxTQUFTLENBQUMsY0FBYyxFQUMzQixJQUFJLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQyx5QkFBeUIsQ0FBQyxFQUNwRCxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsQ0FDbkIsQ0FBQztRQUVGLDhEQUE4RDtRQUM5RCxJQUFJLENBQUMsdUJBQXVCLENBQUMsb0JBQW9CLENBQy9DLEVBQUUsQ0FBQyxTQUFTLENBQUMsY0FBYyxFQUMzQixJQUFJLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQyx3QkFBd0IsQ0FBQyxFQUNuRCxFQUFFLE1BQU0sRUFBRSxrQkFBa0IsRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLENBQ2hELENBQUM7UUFFRiw2RUFBNkU7UUFDN0UsdUJBQXVCLENBQUMsZUFBZSxDQUNyQyxJQUFJLGdCQUFnQixDQUFDLGtCQUFrQixDQUFDLHlCQUF5QixDQUFDLENBQ25FLENBQUM7UUFFRiw0REFBNEQ7UUFDNUQsSUFBSSxvQkFBb0IsQ0FBQyxlQUFlLENBQUMsSUFBSSxFQUFFLGtDQUFrQyxFQUFFO1lBQ2pGLElBQUksRUFBRSxzQ0FBc0M7WUFDNUMsSUFBSSxFQUFFLE1BQU07WUFDWixNQUFNLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO29CQUN0QixLQUFLLEVBQUUsQ0FBQzs0QkFDTixZQUFZLEVBQUUsWUFBWTs0QkFDMUIsUUFBUSxFQUFFLENBQUMsOEJBQThCLENBQUM7NEJBQzFDLFVBQVUsRUFBRTtnQ0FDViw0QkFBNEI7Z0NBQzVCLDRCQUE0QjtnQ0FDNUIsNEJBQTRCO2dDQUM1Qiw4QkFBOEI7NkJBQy9CO3lCQUNGLEVBQUU7NEJBQ0QsWUFBWSxFQUFFLE9BQU87NEJBQ3JCLFFBQVEsRUFBRSxDQUFDLDJCQUEyQixDQUFDOzRCQUN2QyxVQUFVLEVBQUU7Z0NBQ1Ysa0JBQWtCO2dDQUNsQixrQkFBa0I7Z0NBQ2xCLGtCQUFrQjtnQ0FDbEIsb0JBQW9CO2dDQUNwQixtQkFBbUI7Z0NBQ25CLG9CQUFvQjs2QkFDckI7eUJBQ0YsQ0FBQztvQkFDRixTQUFTLEVBQUU7d0JBQ1Qsd0JBQXdCLENBQUMsSUFBSSxFQUFFLE9BQU87cUJBQ3ZDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQztpQkFDbEIsQ0FBQyxDQUFDO1NBQ0osQ0FBQyxDQUFDO1FBRUgsZ0ZBQWdGO1FBQ2hGLElBQUksQ0FBQywrQkFBK0IsRUFBRSxDQUFDO1FBRXZDLDhCQUE4QjtRQUM5QixJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7UUFFdEIsNEJBQTRCO1FBQzVCLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztRQUNuRCxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLFlBQVksQ0FBQyxDQUFDO1FBQ25ELEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDNUMsQ0FBQztJQUVPLCtCQUErQjtRQUNyQywwQkFBMEI7UUFDMUIsTUFBTSx1QkFBdUIsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFFO1lBQ25GLFlBQVksRUFBRSw2QkFBNkI7WUFDM0MsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVztZQUNuQyxPQUFPLEVBQUUsb0JBQW9CO1lBQzdCLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxtQ0FBbUMsQ0FBQztZQUNoRSxPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO1lBQ2hDLFVBQVUsRUFBRSxHQUFHO1lBQ2YsV0FBVyxFQUFFO2dCQUNYLG1CQUFtQixFQUFFLFdBQVcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLHNCQUFzQixFQUFFO2dCQUM5RSxnQkFBZ0IsRUFBRSxXQUFXO2FBQzlCO1lBQ0QsSUFBSSxFQUFFLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7Z0JBQzlDLFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQztnQkFDM0QsZUFBZSxFQUFFO29CQUNmLEdBQUcsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQUMsMENBQTBDLENBQUM7aUJBQ3ZGO2dCQUNELGNBQWMsRUFBRTtvQkFDZCxxQkFBcUIsRUFBRSxJQUFJLEdBQUcsQ0FBQyxjQUFjLENBQUM7d0JBQzVDLFVBQVUsRUFBRTs0QkFDVixJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7Z0NBQ3RCLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUs7Z0NBQ3hCLE9BQU8sRUFBRTtvQ0FDUCxxQkFBcUI7aUNBQ3RCO2dDQUNELFNBQVMsRUFBRSxDQUFDLGdFQUFnRSxDQUFDOzZCQUM5RSxDQUFDOzRCQUNGLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztnQ0FDdEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztnQ0FDeEIsT0FBTyxFQUFFO29DQUNQLG1CQUFtQjtpQ0FDcEI7Z0NBQ0QsU0FBUyxFQUFFLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE9BQU8sQ0FBQzs2QkFDM0MsQ0FBQzt5QkFDSDtxQkFDRixDQUFDO2lCQUNIO2FBQ0YsQ0FBQztTQUNILENBQUMsQ0FBQztRQUVILDhCQUE4QjtRQUM5QixNQUFNLDBCQUEwQixHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsNEJBQTRCLEVBQUU7WUFDekYsWUFBWSxFQUFFLGdDQUFnQztZQUM5QyxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ25DLE9BQU8sRUFBRSxvQkFBb0I7WUFDN0IsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLHVDQUF1QyxDQUFDO1lBQ3BFLE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDakMsVUFBVSxFQUFFLElBQUk7WUFDaEIsV0FBVyxFQUFFO2dCQUNYLGVBQWUsRUFBRSx5Q0FBeUM7YUFDM0Q7WUFDRCxJQUFJLEVBQUUsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSx3QkFBd0IsRUFBRTtnQkFDakQsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLHNCQUFzQixDQUFDO2dCQUMzRCxlQUFlLEVBQUU7b0JBQ2YsR0FBRyxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsQ0FBQywwQ0FBMEMsQ0FBQztpQkFDdkY7Z0JBQ0QsY0FBYyxFQUFFO29CQUNkLHdCQUF3QixFQUFFLElBQUksR0FBRyxDQUFDLGNBQWMsQ0FBQzt3QkFDL0MsVUFBVSxFQUFFOzRCQUNWLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztnQ0FDdEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztnQ0FDeEIsT0FBTyxFQUFFO29DQUNQLHFCQUFxQjtpQ0FDdEI7Z0NBQ0QsU0FBUyxFQUFFLENBQUMsNkVBQTZFLENBQUM7NkJBQzNGLENBQUM7eUJBQ0g7cUJBQ0YsQ0FBQztpQkFDSDthQUNGLENBQUM7U0FDSCxDQUFDLENBQUM7UUFFSCxvQkFBb0I7UUFDcEIsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQ3ZFLFlBQVksRUFBRSx1QkFBdUI7WUFDckMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVztZQUNuQyxPQUFPLEVBQUUsb0JBQW9CO1lBQzdCLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyw2QkFBNkIsQ0FBQztZQUMxRCxPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO1lBQ2hDLFVBQVUsRUFBRSxHQUFHO1lBQ2YsV0FBVyxFQUFFO2dCQUNYLGVBQWUsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVM7YUFDMUM7WUFDRCxJQUFJLEVBQUUsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7Z0JBQ3hDLFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQztnQkFDM0QsZUFBZSxFQUFFO29CQUNmLEdBQUcsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQUMsMENBQTBDLENBQUM7aUJBQ3ZGO2dCQUNELGNBQWMsRUFBRTtvQkFDZCxlQUFlLEVBQUUsSUFBSSxHQUFHLENBQUMsY0FBYyxDQUFDO3dCQUN0QyxVQUFVLEVBQUU7NEJBQ1YsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO2dDQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO2dDQUN4QixPQUFPLEVBQUU7b0NBQ1Asa0JBQWtCO29DQUNsQixxQkFBcUI7b0NBQ3JCLGtCQUFrQjtvQ0FDbEIsZ0JBQWdCO29DQUNoQixlQUFlO2lDQUNoQjtnQ0FDRCxTQUFTLEVBQUU7b0NBQ1QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRO29DQUN2QixHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxVQUFVO2lDQUNyQzs2QkFDRixDQUFDOzRCQUNGLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztnQ0FDdEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztnQ0FDeEIsT0FBTyxFQUFFO29DQUNQLGFBQWE7b0NBQ2IscUJBQXFCO2lDQUN0QjtnQ0FDRCxTQUFTLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQzs2QkFDdkMsQ0FBQzt5QkFDSDtxQkFDRixDQUFDO2lCQUNIO2FBQ0YsQ0FBQztTQUNILENBQUMsQ0FBQztRQUVILCtCQUErQjtRQUMvQixNQUFNLGdCQUFnQixHQUFHLElBQUksa0JBQWtCLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUNyRixjQUFjLEVBQUUsdUJBQXVCO1lBQ3ZDLFVBQVUsRUFBRSxXQUFXO1lBQ3ZCLHdCQUF3QixFQUFFLElBQUk7U0FDL0IsQ0FBQyxDQUFDO1FBRUgsTUFBTSxXQUFXLEdBQUcsSUFBSSxrQkFBa0IsQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUMzRSxjQUFjLEVBQUUsMEJBQTBCO1lBQzFDLFNBQVMsRUFBRSxHQUFHO1lBQ2QsVUFBVSxFQUFFLFdBQVc7WUFDdkIsd0JBQXdCLEVBQUUsSUFBSTtTQUMvQixDQUFDLENBQUM7UUFFSCxNQUFNLFNBQVMsR0FBRyxJQUFJLGtCQUFrQixDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFO1lBQ3ZFLGNBQWMsRUFBRSxpQkFBaUI7WUFDakMsU0FBUyxFQUFFLFFBQVE7WUFDbkIsVUFBVSxFQUFFLFdBQVc7WUFDdkIsd0JBQXdCLEVBQUUsSUFBSTtTQUMvQixDQUFDLENBQUM7UUFFSCw0QkFBNEI7UUFDNUIsTUFBTSxxQkFBcUIsR0FBRyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBRWpGLHdDQUF3QztRQUN4QyxJQUFJLENBQUMsbUJBQW1CLEdBQUcsSUFBSSxhQUFhLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZQUNyRixnQkFBZ0IsRUFBRSx5QkFBeUI7WUFDM0MsVUFBVSxFQUFFLHFCQUFxQjtZQUNqQyxPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ2pDLGNBQWMsRUFBRSxJQUFJO1NBQ3JCLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFTyxjQUFjO1FBQ3BCLDhDQUE4QztRQUM5QyxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7WUFDaEUsWUFBWSxFQUFFLHNCQUFzQjtZQUNwQyxpQkFBaUIsRUFBRSxJQUFJO1lBQ3ZCLGFBQWEsRUFBRTtnQkFDYixLQUFLLEVBQUUsSUFBSTthQUNaO1lBQ0QsVUFBVSxFQUFFO2dCQUNWLEtBQUssRUFBRSxJQUFJO2FBQ1o7WUFDRCxjQUFjLEVBQUU7Z0JBQ2QsU0FBUyxFQUFFLENBQUM7Z0JBQ1osZ0JBQWdCLEVBQUUsSUFBSTtnQkFDdEIsZ0JBQWdCLEVBQUUsSUFBSTtnQkFDdEIsYUFBYSxFQUFFLElBQUk7Z0JBQ25CLGNBQWMsRUFBRSxJQUFJO2FBQ3JCO1lBQ0QsZUFBZSxFQUFFLE9BQU8sQ0FBQyxlQUFlLENBQUMsVUFBVTtZQUNuRCxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxNQUFNO1NBQ3hDLENBQUMsQ0FBQztRQUVILDBCQUEwQjtRQUMxQixNQUFNLGNBQWMsR0FBRyxJQUFJLE9BQU8sQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLDJCQUEyQixFQUFFO1lBQ25GLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUTtZQUN2QixrQkFBa0IsRUFBRSx1QkFBdUI7WUFDM0MsY0FBYyxFQUFFLEtBQUs7WUFDckIsU0FBUyxFQUFFO2dCQUNULFlBQVksRUFBRSxJQUFJO2dCQUNsQixPQUFPLEVBQUUsSUFBSTthQUNkO1lBQ0QsS0FBSyxFQUFFO2dCQUNMLEtBQUssRUFBRTtvQkFDTCxzQkFBc0IsRUFBRSxJQUFJO2lCQUM3QjtnQkFDRCxNQUFNLEVBQUU7b0JBQ04sT0FBTyxDQUFDLFVBQVUsQ0FBQyxLQUFLO29CQUN4QixPQUFPLENBQUMsVUFBVSxDQUFDLE1BQU07b0JBQ3pCLE9BQU8sQ0FBQyxVQUFVLENBQUMsT0FBTztpQkFDM0I7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUVILHFDQUFxQztRQUNyQyxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSwyQkFBMkIsRUFBRTtZQUM1RSxTQUFTLEVBQUUsa0NBQWtDO1lBQzdDLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxjQUFjLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFO1lBQzNFLFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsVUFBVSxFQUFFLFFBQVEsQ0FBQyxlQUFlLENBQUMsZ0JBQWdCO1lBQ3JELGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYTtZQUNqQyxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1lBQ3hDLG1CQUFtQixFQUFFLEtBQUs7U0FDM0IsQ0FBQyxDQUFDO1FBRUgsNkJBQTZCO1FBQzdCLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyx1QkFBdUIsQ0FBQztZQUM1QyxTQUFTLEVBQUUsYUFBYTtZQUN4QixZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUNyRSxjQUFjLEVBQUUsUUFBUSxDQUFDLGNBQWMsQ0FBQyxHQUFHO1NBQzVDLENBQUMsQ0FBQztRQUVILDRCQUE0QjtRQUM1QixNQUFNLGtCQUFrQixHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDekUsWUFBWSxFQUFFLHdCQUF3QjtZQUN0QyxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ25DLE9BQU8sRUFBRSxvQkFBb0I7WUFDN0IsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLDhCQUE4QixDQUFDO1lBQzNELE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDaEMsVUFBVSxFQUFFLEdBQUc7WUFDZixXQUFXLEVBQUU7Z0JBQ1gsZUFBZSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsU0FBUztnQkFDekMscUJBQXFCLEVBQUUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxTQUFTO2dCQUNyRCw4QkFBOEIsRUFBRSxJQUFJLENBQUMsbUJBQW1CLENBQUMsZUFBZTthQUN6RTtZQUNELElBQUksRUFBRSxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO2dCQUN6QyxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUM7Z0JBQzNELGVBQWUsRUFBRTtvQkFDZixHQUFHLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUFDLDBDQUEwQyxDQUFDO2lCQUN2RjtnQkFDRCxjQUFjLEVBQUU7b0JBQ2QsZ0JBQWdCLEVBQUUsSUFBSSxHQUFHLENBQUMsY0FBYyxDQUFDO3dCQUN2QyxVQUFVLEVBQUU7NEJBQ1YsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO2dDQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO2dDQUN4QixPQUFPLEVBQUU7b0NBQ1Asa0JBQWtCO29DQUNsQixrQkFBa0I7b0NBQ2xCLHFCQUFxQjtvQ0FDckIsZ0JBQWdCO29DQUNoQixlQUFlO2lDQUNoQjtnQ0FDRCxTQUFTLEVBQUU7b0NBQ1QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRO29DQUN2QixHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxVQUFVO29DQUNwQyxJQUFJLENBQUMsZUFBZSxDQUFDLFFBQVE7b0NBQzdCLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxRQUFRLFVBQVU7aUNBQzNDOzZCQUNGLENBQUM7NEJBQ0YsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO2dDQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO2dDQUN4QixPQUFPLEVBQUU7b0NBQ1AsdUJBQXVCO2lDQUN4QjtnQ0FDRCxTQUFTLEVBQUUsQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsZUFBZSxDQUFDOzZCQUN0RCxDQUFDOzRCQUNGLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztnQ0FDdEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztnQ0FDeEIsT0FBTyxFQUFFO29DQUNQLGFBQWE7b0NBQ2IscUJBQXFCO2lDQUN0QjtnQ0FDRCxTQUFTLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQzs2QkFDdkMsQ0FBQzt5QkFDSDtxQkFDRixDQUFDO2lCQUNIO2FBQ0YsQ0FBQztTQUNILENBQUMsQ0FBQztRQUVILDRCQUE0QjtRQUM1QixNQUFNLGlCQUFpQixHQUFHLElBQUksVUFBVSxDQUFDLDBCQUEwQixDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUM3RixnQkFBZ0IsRUFBRSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUM7WUFDakMsY0FBYyxFQUFFLHdCQUF3QjtTQUN6QyxDQUFDLENBQUM7UUFFSCxrQkFBa0I7UUFDbEIsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLFVBQVUsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQ2hFLFdBQVcsRUFBRSxvQkFBb0I7WUFDakMsV0FBVyxFQUFFLG9DQUFvQztZQUNqRCwyQkFBMkIsRUFBRTtnQkFDM0IsWUFBWSxFQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsV0FBVztnQkFDekMsWUFBWSxFQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsV0FBVztnQkFDekMsWUFBWSxFQUFFO29CQUNaLGNBQWM7b0JBQ2QsWUFBWTtvQkFDWixlQUFlO29CQUNmLFdBQVc7b0JBQ1gsc0JBQXNCO2lCQUN2QjthQUNGO1lBQ0QsYUFBYSxFQUFFO2dCQUNiLFNBQVMsRUFBRSxNQUFNO2dCQUNqQixtQkFBbUIsRUFBRSxHQUFHO2dCQUN4QixvQkFBb0IsRUFBRSxHQUFHO2dCQUN6QixZQUFZLEVBQUUsVUFBVSxDQUFDLGtCQUFrQixDQUFDLElBQUk7Z0JBQ2hELGdCQUFnQixFQUFFLElBQUk7Z0JBQ3RCLGNBQWMsRUFBRSxJQUFJO2FBQ3JCO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsNEJBQTRCO1FBQzVCLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxVQUFVLENBQUMsaUJBQWlCLENBQUMsa0JBQWtCLEVBQUU7WUFDN0UsZ0JBQWdCLEVBQUUsRUFBRSxrQkFBa0IsRUFBRSx5QkFBeUIsRUFBRTtTQUNwRSxDQUFDLENBQUM7UUFFSCxvQkFBb0I7UUFDcEIsWUFBWTtRQUNaLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUMzRCxZQUFZLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxpQkFBaUIsRUFBRTtZQUMvQyxVQUFVLEVBQUUsaUJBQWlCO1lBQzdCLGlCQUFpQixFQUFFLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPO1NBQ3hELENBQUMsQ0FBQztRQUVILGlDQUFpQztRQUNqQyxNQUFNLFdBQVcsR0FBRyxZQUFZLENBQUMsV0FBVyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQ3hELE1BQU0sbUJBQW1CLEdBQUcsV0FBVyxDQUFDLFdBQVcsQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUNuRSxtQkFBbUIsQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLGlCQUFpQixFQUFFO1lBQ3ZELFVBQVUsRUFBRSxpQkFBaUI7WUFDN0IsaUJBQWlCLEVBQUUsVUFBVSxDQUFDLGlCQUFpQixDQUFDLE9BQU87U0FDeEQsQ0FBQyxDQUFDO1FBRUgsa0JBQWtCO1FBQ2xCLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ3ZFLGtCQUFrQixDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsaUJBQWlCLEVBQUU7WUFDckQsVUFBVSxFQUFFLGlCQUFpQjtZQUM3QixpQkFBaUIsRUFBRSxVQUFVLENBQUMsaUJBQWlCLENBQUMsT0FBTztTQUN4RCxDQUFDLENBQUM7UUFFSCx5Q0FBeUM7UUFDekMsTUFBTSxpQkFBaUIsR0FBRyxrQkFBa0IsQ0FBQyxXQUFXLENBQUMsZUFBZSxDQUFDLENBQUM7UUFDMUUsTUFBTSxlQUFlLEdBQUcsaUJBQWlCLENBQUMsV0FBVyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQ2pFLGVBQWUsQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLGlCQUFpQixFQUFFO1lBQ25ELFVBQVUsRUFBRSxpQkFBaUI7WUFDN0IsaUJBQWlCLEVBQUUsVUFBVSxDQUFDLGlCQUFpQixDQUFDLE9BQU87U0FDeEQsQ0FBQyxDQUFDO1FBRUgsdUJBQXVCO1FBQ3ZCLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ25FLE1BQU0scUJBQXFCLEdBQUcsZ0JBQWdCLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3BFLHFCQUFxQixDQUFDLFNBQVMsQ0FBQyxNQUFNLEVBQUUsaUJBQWlCLEVBQUU7WUFDekQsVUFBVSxFQUFFLGlCQUFpQjtZQUM3QixpQkFBaUIsRUFBRSxVQUFVLENBQUMsaUJBQWlCLENBQUMsT0FBTztTQUN4RCxDQUFDLENBQUM7UUFFSCx5QkFBeUI7UUFDekIsTUFBTSxhQUFhLEdBQUcsa0JBQWtCLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQzlELGFBQWEsQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLGlCQUFpQixFQUFFO1lBQ2pELFVBQVUsRUFBRSxpQkFBaUI7WUFDN0IsaUJBQWlCLEVBQUUsVUFBVSxDQUFDLGlCQUFpQixDQUFDLE9BQU87U0FDeEQsQ0FBQyxDQUFDO1FBRUgsaUNBQWlDO1FBQ2pDLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUMvRCxjQUFjLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO1FBRW5ELDRFQUE0RTtRQUM1RSxNQUFNLHdCQUF3QixHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsMEJBQTBCLEVBQUU7WUFDckYsWUFBWSxFQUFFLDhCQUE4QjtZQUM1QyxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ25DLE9BQU8sRUFBRSxvQkFBb0I7WUFDN0IsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLG9DQUFvQyxDQUFDO1lBQ2pFLE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDaEMsVUFBVSxFQUFFLEdBQUc7WUFDZixXQUFXLEVBQUU7Z0JBQ1gsc0JBQXNCLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFNBQVM7YUFDeEQ7WUFDRCxJQUFJLEVBQUUsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxzQkFBc0IsRUFBRTtnQkFDL0MsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLHNCQUFzQixDQUFDO2dCQUMzRCxlQUFlLEVBQUU7b0JBQ2YsR0FBRyxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsQ0FBQywwQ0FBMEMsQ0FBQztpQkFDdkY7Z0JBQ0QsY0FBYyxFQUFFO29CQUNkLHNCQUFzQixFQUFFLElBQUksR0FBRyxDQUFDLGNBQWMsQ0FBQzt3QkFDN0MsVUFBVSxFQUFFOzRCQUNWLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztnQ0FDdEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztnQ0FDeEIsT0FBTyxFQUFFO29DQUNQLGtCQUFrQjtvQ0FDbEIsa0JBQWtCO29DQUNsQixxQkFBcUI7b0NBQ3JCLHFCQUFxQjtvQ0FDckIsZ0JBQWdCO29DQUNoQixlQUFlO2lDQUNoQjtnQ0FDRCxTQUFTLEVBQUU7b0NBQ1QsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFFBQVE7b0NBQzlCLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFFBQVEsVUFBVTtpQ0FDNUM7NkJBQ0YsQ0FBQzs0QkFDRixJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7Z0NBQ3RCLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUs7Z0NBQ3hCLE9BQU8sRUFBRTtvQ0FDUCwrQkFBK0I7aUNBQ2hDO2dDQUNELFNBQVMsRUFBRSxDQUFDLDBDQUEwQyxDQUFDOzZCQUN4RCxDQUFDOzRCQUNGLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztnQ0FDdEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztnQ0FDeEIsT0FBTyxFQUFFO29DQUNQLGFBQWE7b0NBQ2IscUJBQXFCO2lDQUN0QjtnQ0FDRCxTQUFTLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQzs2QkFDdkMsQ0FBQzt5QkFDSDtxQkFDRixDQUFDO2lCQUNIO2FBQ0YsQ0FBQztTQUNILENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTUyQkQsNENBNDJCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgb3BlbnNlYXJjaHNlcnZlcmxlc3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLW9wZW5zZWFyY2hzZXJ2ZXJsZXNzJztcbmltcG9ydCAqIGFzIGttcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mta21zJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcbmltcG9ydCAqIGFzIHNucyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zJztcbmltcG9ydCAqIGFzIHNuc1N1YnNjcmlwdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucy1zdWJzY3JpcHRpb25zJztcbmltcG9ydCAqIGFzIHMzbiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMtbm90aWZpY2F0aW9ucyc7XG5pbXBvcnQgKiBhcyBzdGVwZnVuY3Rpb25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zdGVwZnVuY3Rpb25zJztcbmltcG9ydCAqIGFzIHN0ZXBmdW5jdGlvbnNUYXNrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucy10YXNrcyc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0ICogYXMgY29nbml0byBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29nbml0byc7XG5cbmV4cG9ydCBjbGFzcyBDb21wbGlBZ2VudFN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgLy8gQ29yZSBpbmZyYXN0cnVjdHVyZVxuICBwdWJsaWMgcmVhZG9ubHkgZW5jcnlwdGlvbktleToga21zLktleTtcbiAgcHVibGljIHJlYWRvbmx5IG1hc0RvY3NSYXdCdWNrZXQ6IHMzLkJ1Y2tldDtcbiAgcHVibGljIHJlYWRvbmx5IGludGVybmFsRG9jc1Jhd0J1Y2tldDogczMuQnVja2V0O1xuICBwdWJsaWMgcmVhZG9ubHkgcHJvY2Vzc2VkRG9jc0pzb25CdWNrZXQ6IHMzLkJ1Y2tldDtcbiAgcHVibGljIHJlYWRvbmx5IGdhcHNUYWJsZTogZHluYW1vZGIuVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSBhbWVuZG1lbnRzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgdmVjdG9yQ29sbGVjdGlvbjogb3BlbnNlYXJjaHNlcnZlcmxlc3MuQ2ZuQ29sbGVjdGlvbjtcbiAgXG4gIC8vIEFuYWx5c2lzIHdvcmtmbG93IGNvbXBvbmVudHNcbiAgcHVibGljIGdhcEFuYWx5c2lzV29ya2Zsb3chOiBzdGVwZnVuY3Rpb25zLlN0YXRlTWFjaGluZTtcbiAgcHVibGljIGFtZW5kbWVudERyYWZ0aW5nV29ya2Zsb3chOiBzdGVwZnVuY3Rpb25zLlN0YXRlTWFjaGluZTtcbiAgXG4gIC8vIEFQSSBMYXllciBjb21wb25lbnRzXG4gIHB1YmxpYyB1c2VyUG9vbCE6IGNvZ25pdG8uVXNlclBvb2w7XG4gIHB1YmxpYyByZXN0QXBpITogYXBpZ2F0ZXdheS5SZXN0QXBpO1xuICBwdWJsaWMgY29ubmVjdGlvbnNUYWJsZSE6IGR5bmFtb2RiLlRhYmxlO1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBDcmVhdGUgS01TIGtleSBmb3IgZW5jcnlwdGlvblxuICAgIHRoaXMuZW5jcnlwdGlvbktleSA9IG5ldyBrbXMuS2V5KHRoaXMsICdDb21wbGlBZ2VudEVuY3J5cHRpb25LZXknLCB7XG4gICAgICBlbmFibGVLZXlSb3RhdGlvbjogdHJ1ZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnS01TIGtleSBmb3IgQ29tcGxpQWdlbnQtU0cgZW5jcnlwdGlvbicsXG4gICAgICBhbGlhczogJ2FsaWFzL2NvbXBsaWFnZW50LXNnJyxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBTMyBidWNrZXRzIHdpdGggdW5pcXVlIG5hbWVzIHVzaW5nIGFjY291bnQgSUQgYW5kIHJlZ2lvblxuICAgIGNvbnN0IGFjY291bnRJZCA9IGNkay5TdGFjay5vZih0aGlzKS5hY2NvdW50O1xuICAgIGNvbnN0IHJlZ2lvbiA9IGNkay5TdGFjay5vZih0aGlzKS5yZWdpb247XG4gICAgXG4gICAgdGhpcy5tYXNEb2NzUmF3QnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnTWFzRG9jc1Jhd0J1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGBtYXMtZG9jcy1yYXctJHthY2NvdW50SWR9LSR7cmVnaW9ufWAsXG4gICAgICB2ZXJzaW9uZWQ6IHRydWUsXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLktNUyxcbiAgICAgIGVuY3J5cHRpb25LZXk6IHRoaXMuZW5jcnlwdGlvbktleSxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgICBsaWZlY3ljbGVSdWxlczogW3tcbiAgICAgICAgaWQ6ICdEZWxldGVPbGRWZXJzaW9ucycsXG4gICAgICAgIG5vbmN1cnJlbnRWZXJzaW9uRXhwaXJhdGlvbjogY2RrLkR1cmF0aW9uLmRheXMoOTApLFxuICAgICAgfV0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmludGVybmFsRG9jc1Jhd0J1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0ludGVybmFsRG9jc1Jhd0J1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGBpbnRlcm5hbC1kb2NzLXJhdy0ke2FjY291bnRJZH0tJHtyZWdpb259YCxcbiAgICAgIHZlcnNpb25lZDogdHJ1ZSxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uS01TLFxuICAgICAgZW5jcnlwdGlvbktleTogdGhpcy5lbmNyeXB0aW9uS2V5LFxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbe1xuICAgICAgICBpZDogJ0RlbGV0ZU9sZFZlcnNpb25zJyxcbiAgICAgICAgbm9uY3VycmVudFZlcnNpb25FeHBpcmF0aW9uOiBjZGsuRHVyYXRpb24uZGF5cyg5MCksXG4gICAgICB9XSxcbiAgICB9KTtcblxuICAgIHRoaXMucHJvY2Vzc2VkRG9jc0pzb25CdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdQcm9jZXNzZWREb2NzSnNvbkJ1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGBwcm9jZXNzZWQtZG9jcy1qc29uLSR7YWNjb3VudElkfS0ke3JlZ2lvbn1gLFxuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5LTVMsXG4gICAgICBlbmNyeXB0aW9uS2V5OiB0aGlzLmVuY3J5cHRpb25LZXksXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFt7XG4gICAgICAgIGlkOiAnRGVsZXRlT2xkUHJvY2Vzc2VkRG9jcycsXG4gICAgICAgIGV4cGlyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDM2NSksXG4gICAgICB9XSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBEeW5hbW9EQiB0YWJsZXNcbiAgICB0aGlzLmdhcHNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnR2Fwc1RhYmxlJywge1xuICAgICAgdGFibGVOYW1lOiAnQ29tcGxpQWdlbnQtR2Fwc1RhYmxlJyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZ2FwSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIGVuY3J5cHRpb246IGR5bmFtb2RiLlRhYmxlRW5jcnlwdGlvbi5DVVNUT01FUl9NQU5BR0VELFxuICAgICAgZW5jcnlwdGlvbktleTogdGhpcy5lbmNyeXB0aW9uS2V5LFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBHU0kgZm9yIHJlZ3VsYXRpb25JZCB0byBHYXBzVGFibGVcbiAgICB0aGlzLmdhcHNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdyZWd1bGF0aW9uSWRJbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3JlZ3VsYXRpb25JZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIEdTSSBmb3Igc3RhdHVzIHRvIEdhcHNUYWJsZVxuICAgIHRoaXMuZ2Fwc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ3N0YXR1c0luZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc3RhdHVzJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2NyZWF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hbWVuZG1lbnRzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ0FtZW5kbWVudHNUYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogJ0NvbXBsaUFnZW50LUFtZW5kbWVudHNUYWJsZScsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2FtZW5kbWVudElkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQ1VTVE9NRVJfTUFOQUdFRCxcbiAgICAgIGVuY3J5cHRpb25LZXk6IHRoaXMuZW5jcnlwdGlvbktleSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgR1NJIGZvciBnYXBJZCB0byBBbWVuZG1lbnRzVGFibGVcbiAgICB0aGlzLmFtZW5kbWVudHNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdnYXBJZEluZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZ2FwSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBHU0kgZm9yIHN0YXR1cyB0byBBbWVuZG1lbnRzVGFibGVcbiAgICB0aGlzLmFtZW5kbWVudHNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdzdGF0dXNJbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3N0YXR1cycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdjcmVhdGVkQXQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBkb2N1bWVudCB0cmFja2luZyB0YWJsZVxuICAgIGNvbnN0IGRvY3VtZW50VHJhY2tpbmdUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnRG9jdW1lbnRUcmFja2luZ1RhYmxlJywge1xuICAgICAgdGFibGVOYW1lOiAnQ29tcGxpQWdlbnQtRG9jdW1lbnRUcmFja2luZycsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2RvY3VtZW50X2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQ1VTVE9NRVJfTUFOQUdFRCxcbiAgICAgIGVuY3J5cHRpb25LZXk6IHRoaXMuZW5jcnlwdGlvbktleSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgR1NJIGZvciBVUkwgbG9va3Vwc1xuICAgIGRvY3VtZW50VHJhY2tpbmdUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICd1cmxJbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3VybCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIE9wZW5TZWFyY2ggU2VydmVybGVzcyBzZWN1cml0eSBwb2xpY2llc1xuICAgIGNvbnN0IGVuY3J5cHRpb25Qb2xpY3kgPSBuZXcgb3BlbnNlYXJjaHNlcnZlcmxlc3MuQ2ZuU2VjdXJpdHlQb2xpY3kodGhpcywgJ1ZlY3RvckNvbGxlY3Rpb25FbmNyeXB0aW9uUG9saWN5Jywge1xuICAgICAgbmFtZTogJ3ZlY3Rvci1jb2xsZWN0aW9uLWVuY3J5cHRpb24tcG9saWN5JyxcbiAgICAgIHR5cGU6ICdlbmNyeXB0aW9uJyxcbiAgICAgIHBvbGljeTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBSdWxlczogW3tcbiAgICAgICAgICBSZXNvdXJjZVR5cGU6ICdjb2xsZWN0aW9uJyxcbiAgICAgICAgICBSZXNvdXJjZTogWydjb2xsZWN0aW9uL3ZlY3Rvci1jb2xsZWN0aW9uJ11cbiAgICAgICAgfV0sXG4gICAgICAgIEFXU093bmVkS2V5OiB0cnVlXG4gICAgICB9KVxuICAgIH0pO1xuXG4gICAgY29uc3QgbmV0d29ya1BvbGljeSA9IG5ldyBvcGVuc2VhcmNoc2VydmVybGVzcy5DZm5TZWN1cml0eVBvbGljeSh0aGlzLCAnVmVjdG9yQ29sbGVjdGlvbk5ldHdvcmtQb2xpY3knLCB7XG4gICAgICBuYW1lOiAndmVjdG9yLWNvbGxlY3Rpb24tbmV0d29yay1wb2xpY3knLFxuICAgICAgdHlwZTogJ25ldHdvcmsnLFxuICAgICAgcG9saWN5OiBKU09OLnN0cmluZ2lmeShbe1xuICAgICAgICBSdWxlczogW3tcbiAgICAgICAgICBSZXNvdXJjZVR5cGU6ICdjb2xsZWN0aW9uJyxcbiAgICAgICAgICBSZXNvdXJjZTogWydjb2xsZWN0aW9uL3ZlY3Rvci1jb2xsZWN0aW9uJ11cbiAgICAgICAgfSwge1xuICAgICAgICAgIFJlc291cmNlVHlwZTogJ2Rhc2hib2FyZCcsXG4gICAgICAgICAgUmVzb3VyY2U6IFsnY29sbGVjdGlvbi92ZWN0b3ItY29sbGVjdGlvbiddXG4gICAgICAgIH1dLFxuICAgICAgICBBbGxvd0Zyb21QdWJsaWM6IHRydWVcbiAgICAgIH1dKVxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIE9wZW5TZWFyY2ggU2VydmVybGVzcyBjb2xsZWN0aW9uXG4gICAgdGhpcy52ZWN0b3JDb2xsZWN0aW9uID0gbmV3IG9wZW5zZWFyY2hzZXJ2ZXJsZXNzLkNmbkNvbGxlY3Rpb24odGhpcywgJ1ZlY3RvckNvbGxlY3Rpb24nLCB7XG4gICAgICBuYW1lOiAndmVjdG9yLWNvbGxlY3Rpb24nLFxuICAgICAgdHlwZTogJ1ZFQ1RPUlNFQVJDSCcsXG4gICAgICBkZXNjcmlwdGlvbjogJ1ZlY3RvciBjb2xsZWN0aW9uIGZvciBDb21wbGlBZ2VudC1TRyBkb2N1bWVudCBlbWJlZGRpbmdzJyxcbiAgICB9KTtcblxuICAgIC8vIEVuc3VyZSBjb2xsZWN0aW9uIGlzIGNyZWF0ZWQgYWZ0ZXIgc2VjdXJpdHkgcG9saWNpZXNcbiAgICB0aGlzLnZlY3RvckNvbGxlY3Rpb24uYWRkRGVwZW5kZW5jeShlbmNyeXB0aW9uUG9saWN5KTtcbiAgICB0aGlzLnZlY3RvckNvbGxlY3Rpb24uYWRkRGVwZW5kZW5jeShuZXR3b3JrUG9saWN5KTtcblxuICAgIC8vIENyZWF0ZSBTTlMgdG9waWMgZm9yIFRleHRyYWN0IGNvbXBsZXRpb24gbm90aWZpY2F0aW9uc1xuICAgIGNvbnN0IHRleHRyYWN0Q29tcGxldGlvblRvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAnVGV4dHJhY3RDb21wbGV0aW9uVG9waWMnLCB7XG4gICAgICB0b3BpY05hbWU6ICdDb21wbGlBZ2VudC1UZXh0cmFjdENvbXBsZXRpb24nLFxuICAgICAgZGlzcGxheU5hbWU6ICdUZXh0cmFjdCBKb2IgQ29tcGxldGlvbiBOb3RpZmljYXRpb25zJyxcbiAgICAgIG1hc3RlcktleTogdGhpcy5lbmNyeXB0aW9uS2V5LFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIElBTSByb2xlIGZvciBUZXh0cmFjdCB0byBwdWJsaXNoIHRvIFNOU1xuICAgIGNvbnN0IHRleHRyYWN0U2VydmljZVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1RleHRyYWN0U2VydmljZVJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgndGV4dHJhY3QuYW1hem9uYXdzLmNvbScpLFxuICAgICAgaW5saW5lUG9saWNpZXM6IHtcbiAgICAgICAgVGV4dHJhY3RTTlNQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICBhY3Rpb25zOiBbJ3NuczpQdWJsaXNoJ10sXG4gICAgICAgICAgICAgIHJlc291cmNlczogW3RleHRyYWN0Q29tcGxldGlvblRvcGljLnRvcGljQXJuXSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0pLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBNQVMgTW9uaXRvciBMYW1iZGEgZnVuY3Rpb25cbiAgICBjb25zdCBtYXNNb25pdG9yRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdNYXNNb25pdG9yRnVuY3Rpb24nLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6ICdDb21wbGlBZ2VudC1NYXNNb25pdG9yJyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzEwLFxuICAgICAgaGFuZGxlcjogJ2FwcC5sYW1iZGFfaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uLy4uL3NyYy9sYW1iZGEvbWFzX21vbml0b3InKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcbiAgICAgIG1lbW9yeVNpemU6IDUxMixcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIE1BU19ET0NTX0JVQ0tFVDogdGhpcy5tYXNEb2NzUmF3QnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgIFRSQUNLSU5HX1RBQkxFOiBkb2N1bWVudFRyYWNraW5nVGFibGUudGFibGVOYW1lLFxuICAgICAgfSxcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnTWFzTW9uaXRvclJvbGUnLCB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgICAgXSxcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcbiAgICAgICAgICBNYXNNb25pdG9yUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAnczM6UHV0T2JqZWN0JyxcbiAgICAgICAgICAgICAgICAgICdzMzpQdXRPYmplY3RBY2wnLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy5tYXNEb2NzUmF3QnVja2V0LmFybkZvck9iamVjdHMoJyonKV0sXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpHZXRJdGVtJyxcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpQdXRJdGVtJyxcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpVcGRhdGVJdGVtJyxcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpRdWVyeScsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgICAgICAgIGRvY3VtZW50VHJhY2tpbmdUYWJsZS50YWJsZUFybixcbiAgICAgICAgICAgICAgICAgIGAke2RvY3VtZW50VHJhY2tpbmdUYWJsZS50YWJsZUFybn0vaW5kZXgvKmAsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ2ttczpEZWNyeXB0JyxcbiAgICAgICAgICAgICAgICAgICdrbXM6R2VuZXJhdGVEYXRhS2V5JyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMuZW5jcnlwdGlvbktleS5rZXlBcm5dLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBFdmVudEJyaWRnZSBydWxlIHRvIHRyaWdnZXIgTUFTIG1vbml0b3IgZGFpbHlcbiAgICBjb25zdCBtYXNNb25pdG9yU2NoZWR1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ01hc01vbml0b3JTY2hlZHVsZScsIHtcbiAgICAgIHJ1bGVOYW1lOiAnQ29tcGxpQWdlbnQtTWFzTW9uaXRvclNjaGVkdWxlJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRGFpbHkgdHJpZ2dlciBmb3IgTUFTIGRvY3VtZW50IG1vbml0b3JpbmcnLFxuICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5jcm9uKHtcbiAgICAgICAgbWludXRlOiAnMCcsXG4gICAgICAgIGhvdXI6ICc5JywgLy8gOSBBTSBVVEMgZGFpbHlcbiAgICAgICAgZGF5OiAnKicsXG4gICAgICAgIG1vbnRoOiAnKicsXG4gICAgICAgIHllYXI6ICcqJyxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgbWFzTW9uaXRvclNjaGVkdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihtYXNNb25pdG9yRnVuY3Rpb24pKTtcblxuICAgIC8vIENyZWF0ZSBUZXh0cmFjdCBQcm9jZXNzb3IgTGFtYmRhIGZ1bmN0aW9uXG4gICAgY29uc3QgdGV4dHJhY3RQcm9jZXNzb3JGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1RleHRyYWN0UHJvY2Vzc29yRnVuY3Rpb24nLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6ICdDb21wbGlBZ2VudC1UZXh0cmFjdFByb2Nlc3NvcicsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMCxcbiAgICAgIGhhbmRsZXI6ICdhcHAubGFtYmRhX2hhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi8uLi9zcmMvbGFtYmRhL3RleHRyYWN0X3Byb2Nlc3NvcicpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxuICAgICAgbWVtb3J5U2l6ZTogMTAyNCxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFBST0NFU1NFRF9ET0NTX0JVQ0tFVDogdGhpcy5wcm9jZXNzZWREb2NzSnNvbkJ1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICBTTlNfVE9QSUNfQVJOOiB0ZXh0cmFjdENvbXBsZXRpb25Ub3BpYy50b3BpY0FybixcbiAgICAgICAgVEVYVFJBQ1RfUk9MRV9BUk46IHRleHRyYWN0U2VydmljZVJvbGUucm9sZUFybixcbiAgICAgIH0sXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ1RleHRyYWN0UHJvY2Vzc29yUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgICBdLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIFRleHRyYWN0UHJvY2Vzc29yUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAnczM6R2V0T2JqZWN0JyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgICAgICAgICAgdGhpcy5tYXNEb2NzUmF3QnVja2V0LmFybkZvck9iamVjdHMoJyonKSxcbiAgICAgICAgICAgICAgICAgIHRoaXMuaW50ZXJuYWxEb2NzUmF3QnVja2V0LmFybkZvck9iamVjdHMoJyonKSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAnczM6UHV0T2JqZWN0JyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMucHJvY2Vzc2VkRG9jc0pzb25CdWNrZXQuYXJuRm9yT2JqZWN0cygnKicpXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ3RleHRyYWN0OlN0YXJ0RG9jdW1lbnRBbmFseXNpcycsXG4gICAgICAgICAgICAgICAgICAndGV4dHJhY3Q6R2V0RG9jdW1lbnRBbmFseXNpcycsXG4gICAgICAgICAgICAgICAgICAndGV4dHJhY3Q6QW5hbHl6ZURvY3VtZW50JyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgICdpYW06UGFzc1JvbGUnLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbdGV4dHJhY3RTZXJ2aWNlUm9sZS5yb2xlQXJuXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ2ttczpEZWNyeXB0JyxcbiAgICAgICAgICAgICAgICAgICdrbXM6R2VuZXJhdGVEYXRhS2V5JyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMuZW5jcnlwdGlvbktleS5rZXlBcm5dLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBWZWN0b3JpemUgQ29udGVudCBMYW1iZGEgZnVuY3Rpb25cbiAgICBjb25zdCB2ZWN0b3JpemVDb250ZW50RnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdWZWN0b3JpemVDb250ZW50RnVuY3Rpb24nLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6ICdDb21wbGlBZ2VudC1WZWN0b3JpemVDb250ZW50JyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzEwLFxuICAgICAgaGFuZGxlcjogJ2FwcC5sYW1iZGFfaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uLy4uL3NyYy9sYW1iZGEvdmVjdG9yaXplX2NvbnRlbnQnKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcbiAgICAgIG1lbW9yeVNpemU6IDEwMjQsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBPUEVOU0VBUkNIX0VORFBPSU5UOiBgaHR0cHM6Ly8ke3RoaXMudmVjdG9yQ29sbGVjdGlvbi5hdHRyQ29sbGVjdGlvbkVuZHBvaW50fWAsXG4gICAgICAgIE9QRU5TRUFSQ0hfSU5ERVg6ICdkb2N1bWVudHMnLFxuICAgICAgfSxcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnVmVjdG9yaXplQ29udGVudFJvbGUnLCB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgICAgXSxcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcbiAgICAgICAgICBWZWN0b3JpemVDb250ZW50UG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAnczM6R2V0T2JqZWN0JyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMucHJvY2Vzc2VkRG9jc0pzb25CdWNrZXQuYXJuRm9yT2JqZWN0cygnKicpXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ2JlZHJvY2s6SW52b2tlTW9kZWwnLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJ2Fybjphd3M6YmVkcm9jazoqOjpmb3VuZGF0aW9uLW1vZGVsL2FtYXpvbi50aXRhbi1lbWJlZC10ZXh0LXYxJ10sXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgICdhb3NzOkFQSUFjY2Vzc0FsbCcsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLnZlY3RvckNvbGxlY3Rpb24uYXR0ckFybl0sXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgICdrbXM6RGVjcnlwdCcsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLmVuY3J5cHRpb25LZXkua2V5QXJuXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICAvLyBTZXQgdXAgUzMgZXZlbnQgbm90aWZpY2F0aW9uc1xuICAgIC8vIFRyaWdnZXIgVGV4dHJhY3QgcHJvY2Vzc29yIHdoZW4gbmV3IGRvY3VtZW50cyBhcmUgdXBsb2FkZWQgdG8gTUFTIGRvY3MgYnVja2V0XG4gICAgdGhpcy5tYXNEb2NzUmF3QnVja2V0LmFkZEV2ZW50Tm90aWZpY2F0aW9uKFxuICAgICAgczMuRXZlbnRUeXBlLk9CSkVDVF9DUkVBVEVELFxuICAgICAgbmV3IHMzbi5MYW1iZGFEZXN0aW5hdGlvbih0ZXh0cmFjdFByb2Nlc3NvckZ1bmN0aW9uKSxcbiAgICAgIHsgc3VmZml4OiAnLnBkZicgfVxuICAgICk7XG5cbiAgICB0aGlzLmludGVybmFsRG9jc1Jhd0J1Y2tldC5hZGRFdmVudE5vdGlmaWNhdGlvbihcbiAgICAgIHMzLkV2ZW50VHlwZS5PQkpFQ1RfQ1JFQVRFRCxcbiAgICAgIG5ldyBzM24uTGFtYmRhRGVzdGluYXRpb24odGV4dHJhY3RQcm9jZXNzb3JGdW5jdGlvbiksXG4gICAgICB7IHN1ZmZpeDogJy5wZGYnIH1cbiAgICApO1xuXG4gICAgLy8gVHJpZ2dlciB2ZWN0b3JpemF0aW9uIHdoZW4gcHJvY2Vzc2VkIGRvY3VtZW50cyBhcmUgdXBsb2FkZWRcbiAgICB0aGlzLnByb2Nlc3NlZERvY3NKc29uQnVja2V0LmFkZEV2ZW50Tm90aWZpY2F0aW9uKFxuICAgICAgczMuRXZlbnRUeXBlLk9CSkVDVF9DUkVBVEVELFxuICAgICAgbmV3IHMzbi5MYW1iZGFEZXN0aW5hdGlvbih2ZWN0b3JpemVDb250ZW50RnVuY3Rpb24pLFxuICAgICAgeyBwcmVmaXg6ICd0ZXh0cmFjdC1vdXRwdXQvJywgc3VmZml4OiAnLmpzb24nIH1cbiAgICApO1xuXG4gICAgLy8gU3Vic2NyaWJlIFRleHRyYWN0IHByb2Nlc3NvciB0byBTTlMgdG9waWMgZm9yIGpvYiBjb21wbGV0aW9uIG5vdGlmaWNhdGlvbnNcbiAgICB0ZXh0cmFjdENvbXBsZXRpb25Ub3BpYy5hZGRTdWJzY3JpcHRpb24oXG4gICAgICBuZXcgc25zU3Vic2NyaXB0aW9ucy5MYW1iZGFTdWJzY3JpcHRpb24odGV4dHJhY3RQcm9jZXNzb3JGdW5jdGlvbilcbiAgICApO1xuXG4gICAgLy8gQ3JlYXRlIE9wZW5TZWFyY2ggZGF0YSBhY2Nlc3MgcG9saWN5IGZvciBMYW1iZGEgZnVuY3Rpb25zXG4gICAgbmV3IG9wZW5zZWFyY2hzZXJ2ZXJsZXNzLkNmbkFjY2Vzc1BvbGljeSh0aGlzLCAnVmVjdG9yQ29sbGVjdGlvbkRhdGFBY2Nlc3NQb2xpY3knLCB7XG4gICAgICBuYW1lOiAndmVjdG9yLWNvbGxlY3Rpb24tZGF0YS1hY2Nlc3MtcG9saWN5JyxcbiAgICAgIHR5cGU6ICdkYXRhJyxcbiAgICAgIHBvbGljeTogSlNPTi5zdHJpbmdpZnkoW3tcbiAgICAgICAgUnVsZXM6IFt7XG4gICAgICAgICAgUmVzb3VyY2VUeXBlOiAnY29sbGVjdGlvbicsXG4gICAgICAgICAgUmVzb3VyY2U6IFsnY29sbGVjdGlvbi92ZWN0b3ItY29sbGVjdGlvbiddLFxuICAgICAgICAgIFBlcm1pc3Npb246IFtcbiAgICAgICAgICAgICdhb3NzOkNyZWF0ZUNvbGxlY3Rpb25JdGVtcycsXG4gICAgICAgICAgICAnYW9zczpEZWxldGVDb2xsZWN0aW9uSXRlbXMnLFxuICAgICAgICAgICAgJ2Fvc3M6VXBkYXRlQ29sbGVjdGlvbkl0ZW1zJyxcbiAgICAgICAgICAgICdhb3NzOkRlc2NyaWJlQ29sbGVjdGlvbkl0ZW1zJ1xuICAgICAgICAgIF1cbiAgICAgICAgfSwge1xuICAgICAgICAgIFJlc291cmNlVHlwZTogJ2luZGV4JyxcbiAgICAgICAgICBSZXNvdXJjZTogWydpbmRleC92ZWN0b3ItY29sbGVjdGlvbi8qJ10sXG4gICAgICAgICAgUGVybWlzc2lvbjogW1xuICAgICAgICAgICAgJ2Fvc3M6Q3JlYXRlSW5kZXgnLFxuICAgICAgICAgICAgJ2Fvc3M6RGVsZXRlSW5kZXgnLFxuICAgICAgICAgICAgJ2Fvc3M6VXBkYXRlSW5kZXgnLFxuICAgICAgICAgICAgJ2Fvc3M6RGVzY3JpYmVJbmRleCcsXG4gICAgICAgICAgICAnYW9zczpSZWFkRG9jdW1lbnQnLFxuICAgICAgICAgICAgJ2Fvc3M6V3JpdGVEb2N1bWVudCdcbiAgICAgICAgICBdXG4gICAgICAgIH1dLFxuICAgICAgICBQcmluY2lwYWw6IFtcbiAgICAgICAgICB2ZWN0b3JpemVDb250ZW50RnVuY3Rpb24ucm9sZT8ucm9sZUFybixcbiAgICAgICAgXS5maWx0ZXIoQm9vbGVhbilcbiAgICAgIH1dKVxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIEFuYWx5c2lzIFdvcmtmbG93IExhbWJkYSBGdW5jdGlvbnMgKGFmdGVyIHZlY3RvckNvbGxlY3Rpb24gaXMgY3JlYXRlZClcbiAgICB0aGlzLmNyZWF0ZUFuYWx5c2lzV29ya2Zsb3dGdW5jdGlvbnMoKTtcblxuICAgIC8vIENyZWF0ZSBBUEkgTGF5ZXIgY29tcG9uZW50c1xuICAgIHRoaXMuY3JlYXRlQVBJTGF5ZXIoKTtcblxuICAgIC8vIEFkZCB0YWdzIHRvIGFsbCByZXNvdXJjZXNcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ1Byb2plY3QnLCAnQ29tcGxpQWdlbnQtU0cnKTtcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ0Vudmlyb25tZW50JywgJ1Byb2R1Y3Rpb24nKTtcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ01hbmFnZWRCeScsICdDREsnKTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlQW5hbHlzaXNXb3JrZmxvd0Z1bmN0aW9ucygpOiB2b2lkIHtcbiAgICAvLyBPcGVuU2VhcmNoIFF1ZXJ5IExhbWJkYVxuICAgIGNvbnN0IG9wZW5zZWFyY2hRdWVyeUZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnT3BlblNlYXJjaFF1ZXJ5RnVuY3Rpb24nLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6ICdDb21wbGlBZ2VudC1PcGVuU2VhcmNoUXVlcnknLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfMTAsXG4gICAgICBoYW5kbGVyOiAnYXBwLmxhbWJkYV9oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi4vLi4vc3JjL2xhbWJkYS9vcGVuc2VhcmNoX3F1ZXJ5JyksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIG1lbW9yeVNpemU6IDUxMixcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIE9QRU5TRUFSQ0hfRU5EUE9JTlQ6IGBodHRwczovLyR7dGhpcy52ZWN0b3JDb2xsZWN0aW9uLmF0dHJDb2xsZWN0aW9uRW5kcG9pbnR9YCxcbiAgICAgICAgT1BFTlNFQVJDSF9JTkRFWDogJ2RvY3VtZW50cycsXG4gICAgICB9LFxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdPcGVuU2VhcmNoUXVlcnlSb2xlJywge1xuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgIF0sXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgT3BlblNlYXJjaFF1ZXJ5UG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAnYmVkcm9jazpJbnZva2VNb2RlbCcsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnYXJuOmF3czpiZWRyb2NrOio6OmZvdW5kYXRpb24tbW9kZWwvYW1hem9uLnRpdGFuLWVtYmVkLXRleHQtdjEnXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ2Fvc3M6QVBJQWNjZXNzQWxsJyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMudmVjdG9yQ29sbGVjdGlvbi5hdHRyQXJuXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICAvLyBCZWRyb2NrIEdhcCBBbmFseXNpcyBMYW1iZGFcbiAgICBjb25zdCBiZWRyb2NrR2FwQW5hbHlzaXNGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0JlZHJvY2tHYXBBbmFseXNpc0Z1bmN0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiAnQ29tcGxpQWdlbnQtQmVkcm9ja0dhcEFuYWx5c2lzJyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzEwLFxuICAgICAgaGFuZGxlcjogJ2FwcC5sYW1iZGFfaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uLy4uL3NyYy9sYW1iZGEvYmVkcm9ja19nYXBfYW5hbHlzaXMnKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEwKSxcbiAgICAgIG1lbW9yeVNpemU6IDEwMjQsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBDTEFVREVfTU9ERUxfSUQ6ICdhbnRocm9waWMuY2xhdWRlLTMtc29ubmV0LTIwMjQwMjI5LXYxOjAnLFxuICAgICAgfSxcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnQmVkcm9ja0dhcEFuYWx5c2lzUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgICBdLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIEJlZHJvY2tHYXBBbmFseXNpc1BvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ2JlZHJvY2s6SW52b2tlTW9kZWwnLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJ2Fybjphd3M6YmVkcm9jazoqOjpmb3VuZGF0aW9uLW1vZGVsL2FudGhyb3BpYy5jbGF1ZGUtMy1zb25uZXQtMjAyNDAyMjktdjE6MCddLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIC8vIFN0b3JlIEdhcHMgTGFtYmRhXG4gICAgY29uc3Qgc3RvcmVHYXBzRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTdG9yZUdhcHNGdW5jdGlvbicsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ0NvbXBsaUFnZW50LVN0b3JlR2FwcycsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMCxcbiAgICAgIGhhbmRsZXI6ICdhcHAubGFtYmRhX2hhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi8uLi9zcmMvbGFtYmRhL3N0b3JlX2dhcHMnKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgR0FQU19UQUJMRV9OQU1FOiB0aGlzLmdhcHNUYWJsZS50YWJsZU5hbWUsXG4gICAgICB9LFxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdTdG9yZUdhcHNSb2xlJywge1xuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgIF0sXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgU3RvcmVHYXBzUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6UHV0SXRlbScsXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6VXBkYXRlSXRlbScsXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6R2V0SXRlbScsXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6UXVlcnknLFxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlNjYW4nLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgICAgICAgICB0aGlzLmdhcHNUYWJsZS50YWJsZUFybixcbiAgICAgICAgICAgICAgICAgIGAke3RoaXMuZ2Fwc1RhYmxlLnRhYmxlQXJufS9pbmRleC8qYCxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAna21zOkRlY3J5cHQnLFxuICAgICAgICAgICAgICAgICAgJ2ttczpHZW5lcmF0ZURhdGFLZXknLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy5lbmNyeXB0aW9uS2V5LmtleUFybl0sXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIEdhcCBBbmFseXNpcyBXb3JrZmxvd1xuICAgIGNvbnN0IHF1ZXJ5VmVjdG9yU3RvcmUgPSBuZXcgc3RlcGZ1bmN0aW9uc1Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnUXVlcnlWZWN0b3JTdG9yZScsIHtcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiBvcGVuc2VhcmNoUXVlcnlGdW5jdGlvbixcbiAgICAgIG91dHB1dFBhdGg6ICckLlBheWxvYWQnLFxuICAgICAgcmV0cnlPblNlcnZpY2VFeGNlcHRpb25zOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgY29uc3QgYW5hbHl6ZUdhcHMgPSBuZXcgc3RlcGZ1bmN0aW9uc1Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnQW5hbHl6ZUdhcHMnLCB7XG4gICAgICBsYW1iZGFGdW5jdGlvbjogYmVkcm9ja0dhcEFuYWx5c2lzRnVuY3Rpb24sXG4gICAgICBpbnB1dFBhdGg6ICckJyxcbiAgICAgIG91dHB1dFBhdGg6ICckLlBheWxvYWQnLFxuICAgICAgcmV0cnlPblNlcnZpY2VFeGNlcHRpb25zOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgY29uc3Qgc3RvcmVHYXBzID0gbmV3IHN0ZXBmdW5jdGlvbnNUYXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ1N0b3JlR2FwcycsIHtcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiBzdG9yZUdhcHNGdW5jdGlvbixcbiAgICAgIGlucHV0UGF0aDogJyQuYm9keScsXG4gICAgICBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyxcbiAgICAgIHJldHJ5T25TZXJ2aWNlRXhjZXB0aW9uczogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIERlZmluZSB0aGUgd29ya2Zsb3cgY2hhaW5cbiAgICBjb25zdCBnYXBBbmFseXNpc0RlZmluaXRpb24gPSBxdWVyeVZlY3RvclN0b3JlLm5leHQoYW5hbHl6ZUdhcHMpLm5leHQoc3RvcmVHYXBzKTtcblxuICAgIC8vIENyZWF0ZSB0aGUgR2FwIEFuYWx5c2lzIFN0YXRlIE1hY2hpbmVcbiAgICB0aGlzLmdhcEFuYWx5c2lzV29ya2Zsb3cgPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdGF0ZU1hY2hpbmUodGhpcywgJ0dhcEFuYWx5c2lzV29ya2Zsb3cnLCB7XG4gICAgICBzdGF0ZU1hY2hpbmVOYW1lOiAnQ29tcGxpQWdlbnQtR2FwQW5hbHlzaXMnLFxuICAgICAgZGVmaW5pdGlvbjogZ2FwQW5hbHlzaXNEZWZpbml0aW9uLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMzApLFxuICAgICAgdHJhY2luZ0VuYWJsZWQ6IHRydWUsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUFQSUxheWVyKCk6IHZvaWQge1xuICAgIC8vIENyZWF0ZSBDb2duaXRvIFVzZXIgUG9vbCBmb3IgYXV0aGVudGljYXRpb25cbiAgICB0aGlzLnVzZXJQb29sID0gbmV3IGNvZ25pdG8uVXNlclBvb2wodGhpcywgJ0NvbXBsaUFnZW50VXNlclBvb2wnLCB7XG4gICAgICB1c2VyUG9vbE5hbWU6ICdDb21wbGlBZ2VudC1TRy1Vc2VycycsXG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogdHJ1ZSxcbiAgICAgIHNpZ25JbkFsaWFzZXM6IHtcbiAgICAgICAgZW1haWw6IHRydWUsXG4gICAgICB9LFxuICAgICAgYXV0b1ZlcmlmeToge1xuICAgICAgICBlbWFpbDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBwYXNzd29yZFBvbGljeToge1xuICAgICAgICBtaW5MZW5ndGg6IDgsXG4gICAgICAgIHJlcXVpcmVMb3dlcmNhc2U6IHRydWUsXG4gICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IHRydWUsXG4gICAgICAgIHJlcXVpcmVEaWdpdHM6IHRydWUsXG4gICAgICAgIHJlcXVpcmVTeW1ib2xzOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGFjY291bnRSZWNvdmVyeTogY29nbml0by5BY2NvdW50UmVjb3ZlcnkuRU1BSUxfT05MWSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBVc2VyIFBvb2wgQ2xpZW50XG4gICAgY29uc3QgdXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudCh0aGlzLCAnQ29tcGxpQWdlbnRVc2VyUG9vbENsaWVudCcsIHtcbiAgICAgIHVzZXJQb29sOiB0aGlzLnVzZXJQb29sLFxuICAgICAgdXNlclBvb2xDbGllbnROYW1lOiAnQ29tcGxpQWdlbnQtU0ctQ2xpZW50JyxcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiBmYWxzZSxcbiAgICAgIGF1dGhGbG93czoge1xuICAgICAgICB1c2VyUGFzc3dvcmQ6IHRydWUsXG4gICAgICAgIHVzZXJTcnA6IHRydWUsXG4gICAgICB9LFxuICAgICAgb0F1dGg6IHtcbiAgICAgICAgZmxvd3M6IHtcbiAgICAgICAgICBhdXRob3JpemF0aW9uQ29kZUdyYW50OiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICBzY29wZXM6IFtcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUuRU1BSUwsXG4gICAgICAgICAgY29nbml0by5PQXV0aFNjb3BlLk9QRU5JRCxcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUuUFJPRklMRSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgV2ViU29ja2V0IGNvbm5lY3Rpb25zIHRhYmxlXG4gICAgdGhpcy5jb25uZWN0aW9uc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdXZWJTb2NrZXRDb25uZWN0aW9uc1RhYmxlJywge1xuICAgICAgdGFibGVOYW1lOiAnQ29tcGxpQWdlbnQtV2ViU29ja2V0Q29ubmVjdGlvbnMnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdjb25uZWN0aW9uSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIGVuY3J5cHRpb246IGR5bmFtb2RiLlRhYmxlRW5jcnlwdGlvbi5DVVNUT01FUl9NQU5BR0VELFxuICAgICAgZW5jcnlwdGlvbktleTogdGhpcy5lbmNyeXB0aW9uS2V5LFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSwgLy8gV2ViU29ja2V0IGNvbm5lY3Rpb25zIGFyZSBlcGhlbWVyYWxcbiAgICAgIHRpbWVUb0xpdmVBdHRyaWJ1dGU6ICd0dGwnLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIEdTSSBmb3IgdXNlcklkIGxvb2t1cHNcbiAgICB0aGlzLmNvbm5lY3Rpb25zVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAndXNlcklkSW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICd1c2VySWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBBUEkgSGFuZGxlciBMYW1iZGFcbiAgICBjb25zdCBhcGlIYW5kbGVyRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdBcGlIYW5kbGVyRnVuY3Rpb24nLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6ICdDb21wbGlBZ2VudC1BcGlIYW5kbGVyJyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzEwLFxuICAgICAgaGFuZGxlcjogJ2FwcC5sYW1iZGFfaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uLy4uL3NyYy9sYW1iZGEvYXBpX2hhbmRsZXInKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgR0FQU19UQUJMRV9OQU1FOiB0aGlzLmdhcHNUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIEFNRU5ETUVOVFNfVEFCTEVfTkFNRTogdGhpcy5hbWVuZG1lbnRzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBHQVBfQU5BTFlTSVNfU1RBVEVfTUFDSElORV9BUk46IHRoaXMuZ2FwQW5hbHlzaXNXb3JrZmxvdy5zdGF0ZU1hY2hpbmVBcm4sXG4gICAgICB9LFxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdBcGlIYW5kbGVyUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgICBdLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIEFwaUhhbmRsZXJQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpHZXRJdGVtJyxcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpQdXRJdGVtJyxcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpVcGRhdGVJdGVtJyxcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpRdWVyeScsXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6U2NhbicsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgICAgICAgIHRoaXMuZ2Fwc1RhYmxlLnRhYmxlQXJuLFxuICAgICAgICAgICAgICAgICAgYCR7dGhpcy5nYXBzVGFibGUudGFibGVBcm59L2luZGV4LypgLFxuICAgICAgICAgICAgICAgICAgdGhpcy5hbWVuZG1lbnRzVGFibGUudGFibGVBcm4sXG4gICAgICAgICAgICAgICAgICBgJHt0aGlzLmFtZW5kbWVudHNUYWJsZS50YWJsZUFybn0vaW5kZXgvKmAsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ3N0YXRlczpTdGFydEV4ZWN1dGlvbicsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLmdhcEFuYWx5c2lzV29ya2Zsb3cuc3RhdGVNYWNoaW5lQXJuXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ2ttczpEZWNyeXB0JyxcbiAgICAgICAgICAgICAgICAgICdrbXM6R2VuZXJhdGVEYXRhS2V5JyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMuZW5jcnlwdGlvbktleS5rZXlBcm5dLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBDb2duaXRvIEF1dGhvcml6ZXJcbiAgICBjb25zdCBjb2duaXRvQXV0aG9yaXplciA9IG5ldyBhcGlnYXRld2F5LkNvZ25pdG9Vc2VyUG9vbHNBdXRob3JpemVyKHRoaXMsICdDb2duaXRvQXV0aG9yaXplcicsIHtcbiAgICAgIGNvZ25pdG9Vc2VyUG9vbHM6IFt0aGlzLnVzZXJQb29sXSxcbiAgICAgIGF1dGhvcml6ZXJOYW1lOiAnQ29tcGxpQWdlbnQtQXV0aG9yaXplcicsXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgUkVTVCBBUElcbiAgICB0aGlzLnJlc3RBcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdDb21wbGlBZ2VudFJlc3RBcGknLCB7XG4gICAgICByZXN0QXBpTmFtZTogJ0NvbXBsaUFnZW50LVNHLUFQSScsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JFU1QgQVBJIGZvciBDb21wbGlBZ2VudC1TRyBzeXN0ZW0nLFxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLFxuICAgICAgICBhbGxvd01ldGhvZHM6IGFwaWdhdGV3YXkuQ29ycy5BTExfTUVUSE9EUyxcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBbXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZScsXG4gICAgICAgICAgJ1gtQW16LURhdGUnLFxuICAgICAgICAgICdBdXRob3JpemF0aW9uJyxcbiAgICAgICAgICAnWC1BcGktS2V5JyxcbiAgICAgICAgICAnWC1BbXotU2VjdXJpdHktVG9rZW4nLFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICAgIGRlcGxveU9wdGlvbnM6IHtcbiAgICAgICAgc3RhZ2VOYW1lOiAncHJvZCcsXG4gICAgICAgIHRocm90dGxpbmdSYXRlTGltaXQ6IDEwMCxcbiAgICAgICAgdGhyb3R0bGluZ0J1cnN0TGltaXQ6IDIwMCxcbiAgICAgICAgbG9nZ2luZ0xldmVsOiBhcGlnYXRld2F5Lk1ldGhvZExvZ2dpbmdMZXZlbC5JTkZPLFxuICAgICAgICBkYXRhVHJhY2VFbmFibGVkOiB0cnVlLFxuICAgICAgICBtZXRyaWNzRW5hYmxlZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgTGFtYmRhIGludGVncmF0aW9uXG4gICAgY29uc3QgbGFtYmRhSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihhcGlIYW5kbGVyRnVuY3Rpb24sIHtcbiAgICAgIHJlcXVlc3RUZW1wbGF0ZXM6IHsgJ2FwcGxpY2F0aW9uL2pzb24nOiAneyBcInN0YXR1c0NvZGVcIjogXCIyMDBcIiB9JyB9LFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIEFQSSBlbmRwb2ludHNcbiAgICAvLyBHRVQgL2dhcHNcbiAgICBjb25zdCBnYXBzUmVzb3VyY2UgPSB0aGlzLnJlc3RBcGkucm9vdC5hZGRSZXNvdXJjZSgnZ2FwcycpO1xuICAgIGdhcHNSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGxhbWJkYUludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemVyOiBjb2duaXRvQXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8sXG4gICAgfSk7XG5cbiAgICAvLyBQT1NUIC9nYXBzL3tnYXBJZH0vYWNrbm93bGVkZ2VcbiAgICBjb25zdCBnYXBSZXNvdXJjZSA9IGdhcHNSZXNvdXJjZS5hZGRSZXNvdXJjZSgne2dhcElkfScpO1xuICAgIGNvbnN0IGFja25vd2xlZGdlUmVzb3VyY2UgPSBnYXBSZXNvdXJjZS5hZGRSZXNvdXJjZSgnYWNrbm93bGVkZ2UnKTtcbiAgICBhY2tub3dsZWRnZVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGxhbWJkYUludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemVyOiBjb2duaXRvQXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8sXG4gICAgfSk7XG5cbiAgICAvLyBHRVQgL2FtZW5kbWVudHNcbiAgICBjb25zdCBhbWVuZG1lbnRzUmVzb3VyY2UgPSB0aGlzLnJlc3RBcGkucm9vdC5hZGRSZXNvdXJjZSgnYW1lbmRtZW50cycpO1xuICAgIGFtZW5kbWVudHNSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGxhbWJkYUludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemVyOiBjb2duaXRvQXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8sXG4gICAgfSk7XG5cbiAgICAvLyBQT1NUIC9hbWVuZG1lbnRzL3thbWVuZG1lbnRJZH0vYXBwcm92ZVxuICAgIGNvbnN0IGFtZW5kbWVudFJlc291cmNlID0gYW1lbmRtZW50c1Jlc291cmNlLmFkZFJlc291cmNlKCd7YW1lbmRtZW50SWR9Jyk7XG4gICAgY29uc3QgYXBwcm92ZVJlc291cmNlID0gYW1lbmRtZW50UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2FwcHJvdmUnKTtcbiAgICBhcHByb3ZlUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgbGFtYmRhSW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6ZXI6IGNvZ25pdG9BdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUTyxcbiAgICB9KTtcblxuICAgIC8vIFBPU1QgL2FuYWx5c2lzL3N0YXJ0XG4gICAgY29uc3QgYW5hbHlzaXNSZXNvdXJjZSA9IHRoaXMucmVzdEFwaS5yb290LmFkZFJlc291cmNlKCdhbmFseXNpcycpO1xuICAgIGNvbnN0IHN0YXJ0QW5hbHlzaXNSZXNvdXJjZSA9IGFuYWx5c2lzUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3N0YXJ0Jyk7XG4gICAgc3RhcnRBbmFseXNpc1Jlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGxhbWJkYUludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemVyOiBjb2duaXRvQXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8sXG4gICAgfSk7XG5cbiAgICAvLyBQT1NUIC9hbWVuZG1lbnRzL2RyYWZ0XG4gICAgY29uc3QgZHJhZnRSZXNvdXJjZSA9IGFtZW5kbWVudHNSZXNvdXJjZS5hZGRSZXNvdXJjZSgnZHJhZnQnKTtcbiAgICBkcmFmdFJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGxhbWJkYUludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemVyOiBjb2duaXRvQXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8sXG4gICAgfSk7XG5cbiAgICAvLyBHRVQgL2hlYWx0aCAobm8gYXV0aCByZXF1aXJlZClcbiAgICBjb25zdCBoZWFsdGhSZXNvdXJjZSA9IHRoaXMucmVzdEFwaS5yb290LmFkZFJlc291cmNlKCdoZWFsdGgnKTtcbiAgICBoZWFsdGhSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGxhbWJkYUludGVncmF0aW9uKTtcblxuICAgIC8vIENyZWF0ZSBXZWJTb2NrZXQgSGFuZGxlciBMYW1iZGEgKGZvciBmdXR1cmUgV2ViU29ja2V0IEFQSSBpbXBsZW1lbnRhdGlvbilcbiAgICBjb25zdCB3ZWJTb2NrZXRIYW5kbGVyRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdXZWJTb2NrZXRIYW5kbGVyRnVuY3Rpb24nLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6ICdDb21wbGlBZ2VudC1XZWJTb2NrZXRIYW5kbGVyJyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzEwLFxuICAgICAgaGFuZGxlcjogJ2FwcC5sYW1iZGFfaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uLy4uL3NyYy9sYW1iZGEvd2Vic29ja2V0X2hhbmRsZXInKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgQ09OTkVDVElPTlNfVEFCTEVfTkFNRTogdGhpcy5jb25uZWN0aW9uc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgIH0sXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ1dlYlNvY2tldEhhbmRsZXJSb2xlJywge1xuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgIF0sXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgV2ViU29ja2V0SGFuZGxlclBvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOkdldEl0ZW0nLFxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlB1dEl0ZW0nLFxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlVwZGF0ZUl0ZW0nLFxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOkRlbGV0ZUl0ZW0nLFxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlF1ZXJ5JyxcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpTY2FuJyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgICAgICAgICAgdGhpcy5jb25uZWN0aW9uc1RhYmxlLnRhYmxlQXJuLFxuICAgICAgICAgICAgICAgICAgYCR7dGhpcy5jb25uZWN0aW9uc1RhYmxlLnRhYmxlQXJufS9pbmRleC8qYCxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAnZXhlY3V0ZS1hcGk6TWFuYWdlQ29ubmVjdGlvbnMnLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJ2Fybjphd3M6ZXhlY3V0ZS1hcGk6KjoqOiovQGNvbm5lY3Rpb25zLyonXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ2ttczpEZWNyeXB0JyxcbiAgICAgICAgICAgICAgICAgICdrbXM6R2VuZXJhdGVEYXRhS2V5JyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMuZW5jcnlwdGlvbktleS5rZXlBcm5dLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICB9KTtcbiAgfVxufVxuIl19