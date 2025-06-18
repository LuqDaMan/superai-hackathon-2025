import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
export declare class CompliAgentStack extends cdk.Stack {
    readonly encryptionKey: kms.Key;
    readonly masDocsRawBucket: s3.Bucket;
    readonly internalDocsRawBucket: s3.Bucket;
    readonly processedDocsJsonBucket: s3.Bucket;
    readonly gapsTable: dynamodb.Table;
    readonly amendmentsTable: dynamodb.Table;
    readonly vectorCollection: opensearchserverless.CfnCollection;
    gapAnalysisWorkflow: stepfunctions.StateMachine;
    amendmentDraftingWorkflow: stepfunctions.StateMachine;
    userPool: cognito.UserPool;
    restApi: apigateway.RestApi;
    connectionsTable: dynamodb.Table;
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
    private createAnalysisWorkflowFunctions;
    private createAPILayer;
}
