import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { CoreInfrastructureStack } from './core-infrastructure-stack';
export interface DocumentProcessingStackProps extends cdk.StackProps {
    coreInfrastructure: CoreInfrastructureStack;
}
export declare class DocumentProcessingStack extends cdk.Stack {
    readonly masMonitorFunction: lambda.Function;
    readonly textractProcessorFunction: lambda.Function;
    readonly vectorizeContentFunction: lambda.Function;
    readonly textractCompletionTopic: sns.Topic;
    readonly documentTrackingTable: dynamodb.Table;
    constructor(scope: Construct, id: string, props: DocumentProcessingStackProps);
}
