import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import { CoreInfrastructureStack } from './core-infrastructure-stack';

export interface DocumentProcessingStackProps extends cdk.StackProps {
  coreInfrastructure: CoreInfrastructureStack;
}

export class DocumentProcessingStack extends cdk.Stack {
  public readonly masMonitorFunction: lambda.Function;
  public readonly textractProcessorFunction: lambda.Function;
  public readonly vectorizeContentFunction: lambda.Function;
  public readonly textractCompletionTopic: sns.Topic;
  public readonly documentTrackingTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DocumentProcessingStackProps) {
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
        hour: '9', // 9 AM UTC daily
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
    coreInfrastructure.masDocsRawBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(this.textractProcessorFunction),
      { suffix: '.pdf' }
    );

    coreInfrastructure.internalDocsRawBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(this.textractProcessorFunction),
      { suffix: '.pdf' }
    );

    // Trigger vectorization when processed documents are uploaded
    coreInfrastructure.processedDocsJsonBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(this.vectorizeContentFunction),
      { prefix: 'textract-output/', suffix: '.json' }
    );

    // Subscribe Textract processor to SNS topic for job completion notifications
    this.textractCompletionTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(this.textractProcessorFunction)
    );

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
