import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctionsTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export class CompliAgentStack extends cdk.Stack {
  // Core infrastructure
  public readonly encryptionKey: kms.Key;
  public readonly masDocsRawBucket: s3.Bucket;
  public readonly internalDocsRawBucket: s3.Bucket;
  public readonly processedDocsJsonBucket: s3.Bucket;
  public readonly gapsTable: dynamodb.Table;
  public readonly amendmentsTable: dynamodb.Table;
  public readonly vectorCollection: opensearchserverless.CfnCollection;
  
  // Analysis workflow components
  public gapAnalysisWorkflow!: stepfunctions.StateMachine;
  public amendmentDraftingWorkflow!: stepfunctions.StateMachine;
  
  // API Layer components
  public userPool!: cognito.UserPool;
  public restApi!: apigateway.RestApi;
  public connectionsTable!: dynamodb.Table;
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
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
        hour: '9', // 9 AM UTC daily
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
    this.masDocsRawBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(textractProcessorFunction),
      { suffix: '.pdf' }
    );

    this.internalDocsRawBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(textractProcessorFunction),
      { suffix: '.pdf' }
    );

    // Trigger vectorization when processed documents are uploaded
    this.processedDocsJsonBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(vectorizeContentFunction),
      { prefix: 'textract-output/', suffix: '.json' }
    );

    // Subscribe Textract processor to SNS topic for job completion notifications
    textractCompletionTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(textractProcessorFunction)
    );

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

  private createAnalysisWorkflowFunctions(): void {
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

  private createAPILayer(): void {
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
      removalPolicy: cdk.RemovalPolicy.DESTROY, // WebSocket connections are ephemeral
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
