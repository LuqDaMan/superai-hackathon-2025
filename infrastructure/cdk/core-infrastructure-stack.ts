import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as opensearchserverless from "aws-cdk-lib/aws-opensearchserverless";
import * as kms from "aws-cdk-lib/aws-kms";
import * as iam from "aws-cdk-lib/aws-iam";

export class CoreInfrastructureStack extends cdk.Stack {
  // Public properties to expose resources to other stacks
  public readonly masDocsRawBucket: s3.Bucket;
  public readonly internalDocsRawBucket: s3.Bucket;
  public readonly processedDocsJsonBucket: s3.Bucket;
  public readonly gapsTable: dynamodb.Table;
  public readonly amendmentsTable: dynamodb.Table;
  public readonly vectorCollection: opensearchserverless.CfnCollection;
  public readonly encryptionKey: kms.Key;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create KMS key for encryption
    this.encryptionKey = new kms.Key(this, "CompliAgentEncryptionKey", {
      enableKeyRotation: true,
      description: "KMS key for CompliAgent-SG encryption",
      alias: "alias/compliagent-sg",
    });

    // Create S3 buckets with unique names using account ID and region
    const accountId = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    this.masDocsRawBucket = new s3.Bucket(this, "MasDocsRawBucket", {
      bucketName: `mas-docs-raw-${accountId}-${region}`,
      versioned: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: "DeleteOldVersions",
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
    });

    this.internalDocsRawBucket = new s3.Bucket(this, "InternalDocsRawBucket", {
      bucketName: `internal-docs-raw-${accountId}-${region}`,
      versioned: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: "DeleteOldVersions",
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
    });

    this.processedDocsJsonBucket = new s3.Bucket(
      this,
      "ProcessedDocsJsonBucket",
      {
        bucketName: `processed-docs-json-${accountId}-${region}`,
        encryption: s3.BucketEncryption.KMS,
        encryptionKey: this.encryptionKey,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        lifecycleRules: [
          {
            id: "DeleteOldProcessedDocs",
            expiration: cdk.Duration.days(365),
          },
        ],
      }
    );

    // Create DynamoDB tables
    this.gapsTable = new dynamodb.Table(this, "GapsTable", {
      tableName: "CompliAgent-GapsTable",
      partitionKey: { name: "gapId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.encryptionKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // Add GSI for regulationId to GapsTable
    this.gapsTable.addGlobalSecondaryIndex({
      indexName: "regulationIdIndex",
      partitionKey: {
        name: "regulationId",
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI for status to GapsTable
    this.gapsTable.addGlobalSecondaryIndex({
      indexName: "statusIndex",
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.amendmentsTable = new dynamodb.Table(this, "AmendmentsTable", {
      tableName: "CompliAgent-AmendmentsTable",
      partitionKey: {
        name: "amendmentId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.encryptionKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // Add GSI for gapId to AmendmentsTable
    this.amendmentsTable.addGlobalSecondaryIndex({
      indexName: "gapIdIndex",
      partitionKey: { name: "gapId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI for status to AmendmentsTable
    this.amendmentsTable.addGlobalSecondaryIndex({
      indexName: "statusIndex",
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Create OpenSearch Serverless security policies
    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(
      this,
      "VectorCEPolicy",
      {
        name: "vector-ce-policy",
        type: "encryption",
        policy: JSON.stringify({
          Rules: [
            {
              ResourceType: "collection",
              Resource: ["collection/vector-collection"],
            },
          ],
          AWSOwnedKey: true,
        }),
      }
    );

    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(
      this,
      "VectorCNPolicy",
      {
        name: "vector-cn-policy",
        type: "network",
        policy: JSON.stringify([
          {
            Rules: [
              {
                ResourceType: "collection",
                Resource: ["collection/vector-collection"],
              },
              {
                ResourceType: "dashboard",
                Resource: ["collection/vector-collection"],
              },
            ],
            AllowFromPublic: true,
          },
        ]),
      }
    );

    // Create OpenSearch Serverless collection
    this.vectorCollection = new opensearchserverless.CfnCollection(
      this,
      "VectorCollection",
      {
        name: "vector-collection",
        type: "VECTORSEARCH",
        description: "Vector collection for CompliAgent-SG document embeddings",
      }
    );

    // Ensure collection is created after security policies
    this.vectorCollection.addDependency(encryptionPolicy);
    this.vectorCollection.addDependency(networkPolicy);

    // Add tags to all resources
    cdk.Tags.of(this).add("Project", "CompliAgent-SG");
    cdk.Tags.of(this).add("Environment", "Production");
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }

  // Helper method to create IAM roles for Lambda functions
  public createLambdaRole(
    name: string,
    policyStatements: iam.PolicyStatement[]
  ): iam.Role {
    return new iam.Role(this, name, {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
      ],
      inlinePolicies: {
        [`${name}Policy`]: new iam.PolicyDocument({
          statements: policyStatements,
        }),
      },
    });
  }

  // Helper method to create Step Functions role
  public createStepFunctionsRole(): iam.Role {
    return new iam.Role(this, "StepFunctionsRole", {
      assumedBy: new iam.ServicePrincipal("states.amazonaws.com"),
      inlinePolicies: {
        StepFunctionsPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["lambda:InvokeFunction"],
              resources: ["arn:aws:lambda:*:*:function:*"],
            }),
          ],
        }),
      },
    });
  }
}
