import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
export declare class CoreInfrastructureStack extends cdk.Stack {
    readonly masDocsRawBucket: s3.Bucket;
    readonly internalDocsRawBucket: s3.Bucket;
    readonly processedDocsJsonBucket: s3.Bucket;
    readonly gapsTable: dynamodb.Table;
    readonly amendmentsTable: dynamodb.Table;
    readonly vectorCollection: opensearchserverless.CfnCollection;
    readonly encryptionKey: kms.Key;
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
    createLambdaRole(name: string, policyStatements: iam.PolicyStatement[]): iam.Role;
    createStepFunctionsRole(): iam.Role;
}
