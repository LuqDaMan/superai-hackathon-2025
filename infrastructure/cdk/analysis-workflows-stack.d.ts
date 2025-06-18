import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as kms from 'aws-cdk-lib/aws-kms';
export interface AnalysisWorkflowsStackProps extends cdk.StackProps {
    gapsTable: dynamodb.Table;
    amendmentsTable: dynamodb.Table;
    vectorCollection: opensearchserverless.CfnCollection;
    encryptionKey: kms.Key;
}
export declare class AnalysisWorkflowsStack extends cdk.Stack {
    readonly gapAnalysisWorkflow: stepfunctions.StateMachine;
    readonly amendmentDraftingWorkflow: stepfunctions.StateMachine;
    readonly opensearchQueryFunction: lambda.Function;
    readonly bedrockGapAnalysisFunction: lambda.Function;
    readonly bedrockDraftAmendmentsFunction: lambda.Function;
    readonly storeGapsFunction: lambda.Function;
    readonly retrieveGapFunction: lambda.Function;
    readonly storeAmendmentsFunction: lambda.Function;
    constructor(scope: Construct, id: string, props: AnalysisWorkflowsStackProps);
    private createLambdaFunctions;
    private createGapAnalysisWorkflow;
    private createAmendmentDraftingWorkflow;
}
