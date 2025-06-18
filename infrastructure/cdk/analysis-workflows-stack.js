"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalysisWorkflowsStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const stepfunctions = require("aws-cdk-lib/aws-stepfunctions");
const stepfunctionsTasks = require("aws-cdk-lib/aws-stepfunctions-tasks");
const iam = require("aws-cdk-lib/aws-iam");
const logs = require("aws-cdk-lib/aws-logs");
class AnalysisWorkflowsStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { gapsTable, amendmentsTable, vectorCollection, encryptionKey } = props;
        // Create Lambda functions for analysis workflows
        this.createLambdaFunctions(gapsTable, amendmentsTable, vectorCollection, encryptionKey);
        // Create Step Functions workflows
        this.createGapAnalysisWorkflow();
        this.createAmendmentDraftingWorkflow();
        // Add tags
        cdk.Tags.of(this).add('Project', 'CompliAgent-SG');
        cdk.Tags.of(this).add('Environment', 'Production');
        cdk.Tags.of(this).add('ManagedBy', 'CDK');
        cdk.Tags.of(this).add('Component', 'AnalysisWorkflows');
    }
    createLambdaFunctions(gapsTable, amendmentsTable, vectorCollection, encryptionKey) {
        // OpenSearch Query Lambda
        this.opensearchQueryFunction = new lambda.Function(this, 'OpenSearchQueryFunction', {
            functionName: 'CompliAgent-OpenSearchQuery',
            runtime: lambda.Runtime.PYTHON_3_10,
            handler: 'app.lambda_handler',
            code: lambda.Code.fromAsset('../../src/lambda/opensearch_query'),
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
            environment: {
                OPENSEARCH_ENDPOINT: `https://${vectorCollection.attrCollectionEndpoint}`,
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
                                resources: [vectorCollection.attrArn],
                            }),
                        ],
                    }),
                },
            }),
        });
        // Bedrock Gap Analysis Lambda
        this.bedrockGapAnalysisFunction = new lambda.Function(this, 'BedrockGapAnalysisFunction', {
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
        // Bedrock Draft Amendments Lambda
        this.bedrockDraftAmendmentsFunction = new lambda.Function(this, 'BedrockDraftAmendmentsFunction', {
            functionName: 'CompliAgent-BedrockDraftAmendments',
            runtime: lambda.Runtime.PYTHON_3_10,
            handler: 'app.lambda_handler',
            code: lambda.Code.fromAsset('../../src/lambda/bedrock_draft_amendments'),
            timeout: cdk.Duration.minutes(10),
            memorySize: 1024,
            environment: {
                CLAUDE_MODEL_ID: 'anthropic.claude-3-sonnet-20240229-v1:0',
            },
            role: new iam.Role(this, 'BedrockDraftAmendmentsRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                ],
                inlinePolicies: {
                    BedrockDraftAmendmentsPolicy: new iam.PolicyDocument({
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
        this.storeGapsFunction = new lambda.Function(this, 'StoreGapsFunction', {
            functionName: 'CompliAgent-StoreGaps',
            runtime: lambda.Runtime.PYTHON_3_10,
            handler: 'app.lambda_handler',
            code: lambda.Code.fromAsset('../../src/lambda/store_gaps'),
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
            environment: {
                GAPS_TABLE_NAME: gapsTable.tableName,
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
                                    gapsTable.tableArn,
                                    `${gapsTable.tableArn}/index/*`,
                                ],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'kms:Decrypt',
                                    'kms:GenerateDataKey',
                                ],
                                resources: [encryptionKey.keyArn],
                            }),
                        ],
                    }),
                },
            }),
        });
        // Retrieve Gap Lambda
        this.retrieveGapFunction = new lambda.Function(this, 'RetrieveGapFunction', {
            functionName: 'CompliAgent-RetrieveGap',
            runtime: lambda.Runtime.PYTHON_3_10,
            handler: 'app.lambda_handler',
            code: lambda.Code.fromAsset('../../src/lambda/retrieve_gap'),
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
            environment: {
                GAPS_TABLE_NAME: gapsTable.tableName,
            },
            role: new iam.Role(this, 'RetrieveGapRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                ],
                inlinePolicies: {
                    RetrieveGapPolicy: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'dynamodb:GetItem',
                                    'dynamodb:Query',
                                    'dynamodb:Scan',
                                ],
                                resources: [
                                    gapsTable.tableArn,
                                    `${gapsTable.tableArn}/index/*`,
                                ],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'kms:Decrypt',
                                ],
                                resources: [encryptionKey.keyArn],
                            }),
                        ],
                    }),
                },
            }),
        });
        // Store Amendments Lambda
        this.storeAmendmentsFunction = new lambda.Function(this, 'StoreAmendmentsFunction', {
            functionName: 'CompliAgent-StoreAmendments',
            runtime: lambda.Runtime.PYTHON_3_10,
            handler: 'app.lambda_handler',
            code: lambda.Code.fromAsset('../../src/lambda/store_amendments'),
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
            environment: {
                AMENDMENTS_TABLE_NAME: amendmentsTable.tableName,
            },
            role: new iam.Role(this, 'StoreAmendmentsRole', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                ],
                inlinePolicies: {
                    StoreAmendmentsPolicy: new iam.PolicyDocument({
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
                                    amendmentsTable.tableArn,
                                    `${amendmentsTable.tableArn}/index/*`,
                                ],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'kms:Decrypt',
                                    'kms:GenerateDataKey',
                                ],
                                resources: [encryptionKey.keyArn],
                            }),
                        ],
                    }),
                },
            }),
        });
    }
    createGapAnalysisWorkflow() {
        // Create CloudWatch Log Group for the workflow
        const gapAnalysisLogGroup = new logs.LogGroup(this, 'GapAnalysisWorkflowLogGroup', {
            logGroupName: '/aws/stepfunctions/CompliAgent-GapAnalysis',
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        // Define the Gap Analysis workflow
        const queryVectorStore = new stepfunctionsTasks.LambdaInvoke(this, 'QueryVectorStore', {
            lambdaFunction: this.opensearchQueryFunction,
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        });
        const analyzeGaps = new stepfunctionsTasks.LambdaInvoke(this, 'AnalyzeGaps', {
            lambdaFunction: this.bedrockGapAnalysisFunction,
            inputPath: '$',
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        });
        const storeGaps = new stepfunctionsTasks.LambdaInvoke(this, 'StoreGaps', {
            lambdaFunction: this.storeGapsFunction,
            inputPath: '$.body',
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        });
        // Handle errors
        const handleError = new stepfunctions.Pass(this, 'HandleGapAnalysisError', {
            result: stepfunctions.Result.fromObject({
                error: 'Gap analysis workflow failed',
                timestamp: stepfunctions.JsonPath.stringAt('$$.State.EnteredTime')
            }),
        });
        // Define the workflow chain
        const definition = queryVectorStore
            .addCatch(handleError, {
            errors: ['States.ALL'],
            resultPath: '$.error'
        })
            .next(analyzeGaps
            .addCatch(handleError, {
            errors: ['States.ALL'],
            resultPath: '$.error'
        }))
            .next(storeGaps
            .addCatch(handleError, {
            errors: ['States.ALL'],
            resultPath: '$.error'
        }));
        // Create the State Machine
        this.gapAnalysisWorkflow = new stepfunctions.StateMachine(this, 'GapAnalysisWorkflow', {
            stateMachineName: 'CompliAgent-GapAnalysis',
            definition,
            timeout: cdk.Duration.minutes(30),
            logs: {
                destination: gapAnalysisLogGroup,
                level: stepfunctions.LogLevel.ALL,
            },
            tracingEnabled: true,
        });
    }
    createAmendmentDraftingWorkflow() {
        // Create CloudWatch Log Group for the workflow
        const amendmentDraftingLogGroup = new logs.LogGroup(this, 'AmendmentDraftingWorkflowLogGroup', {
            logGroupName: '/aws/stepfunctions/CompliAgent-AmendmentDrafting',
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        // Define the Amendment Drafting workflow
        const retrieveGapDetails = new stepfunctionsTasks.LambdaInvoke(this, 'RetrieveGapDetails', {
            lambdaFunction: this.retrieveGapFunction,
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        });
        const draftAmendments = new stepfunctionsTasks.LambdaInvoke(this, 'DraftAmendments', {
            lambdaFunction: this.bedrockDraftAmendmentsFunction,
            inputPath: '$',
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        });
        const storeAmendments = new stepfunctionsTasks.LambdaInvoke(this, 'StoreAmendments', {
            lambdaFunction: this.storeAmendmentsFunction,
            inputPath: '$.body',
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        });
        // Handle errors
        const handleAmendmentError = new stepfunctions.Pass(this, 'HandleAmendmentDraftingError', {
            result: stepfunctions.Result.fromObject({
                error: 'Amendment drafting workflow failed',
                timestamp: stepfunctions.JsonPath.stringAt('$$.State.EnteredTime')
            }),
        });
        // Define the workflow chain
        const definition = retrieveGapDetails
            .addCatch(handleAmendmentError, {
            errors: ['States.ALL'],
            resultPath: '$.error'
        })
            .next(draftAmendments
            .addCatch(handleAmendmentError, {
            errors: ['States.ALL'],
            resultPath: '$.error'
        }))
            .next(storeAmendments
            .addCatch(handleAmendmentError, {
            errors: ['States.ALL'],
            resultPath: '$.error'
        }));
        // Create the State Machine
        this.amendmentDraftingWorkflow = new stepfunctions.StateMachine(this, 'AmendmentDraftingWorkflow', {
            stateMachineName: 'CompliAgent-AmendmentDrafting',
            definition,
            timeout: cdk.Duration.minutes(30),
            logs: {
                destination: amendmentDraftingLogGroup,
                level: stepfunctions.LogLevel.ALL,
            },
            tracingEnabled: true,
        });
    }
}
exports.AnalysisWorkflowsStack = AnalysisWorkflowsStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW5hbHlzaXMtd29ya2Zsb3dzLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYW5hbHlzaXMtd29ya2Zsb3dzLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUVuQyxpREFBaUQ7QUFDakQsK0RBQStEO0FBQy9ELDBFQUEwRTtBQUMxRSwyQ0FBMkM7QUFDM0MsNkNBQTZDO0FBWTdDLE1BQWEsc0JBQXVCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFZbkQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFrQztRQUMxRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsU0FBUyxFQUFFLGVBQWUsRUFBRSxnQkFBZ0IsRUFBRSxhQUFhLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFOUUsaURBQWlEO1FBQ2pELElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxTQUFTLEVBQUUsZUFBZSxFQUFFLGdCQUFnQixFQUFFLGFBQWEsQ0FBQyxDQUFDO1FBRXhGLGtDQUFrQztRQUNsQyxJQUFJLENBQUMseUJBQXlCLEVBQUUsQ0FBQztRQUNqQyxJQUFJLENBQUMsK0JBQStCLEVBQUUsQ0FBQztRQUV2QyxXQUFXO1FBQ1gsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO1FBQ25ELEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsWUFBWSxDQUFDLENBQUM7UUFDbkQsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUMxQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxH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LENBQUMsb0JBQW9CLEVBQUU7WUFDOUIsTUFBTSxFQUFFLENBQUMsWUFBWSxDQUFDO1lBQ3RCLFVBQVUsRUFBRSxTQUFTO1NBQ3RCLENBQUMsQ0FBQyxDQUFDO1FBRVIsMkJBQTJCO1FBQzNCLElBQUksQ0FBQyx5QkFBeUIsR0FBRyxJQUFJLGFBQWEsQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLDJCQUEyQixFQUFFO1lBQ2pHLGdCQUFnQixFQUFFLCtCQUErQjtZQUNqRCxVQUFVO1lBQ1YsT0FBTyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUNqQyxJQUFJLEVBQUU7Z0JBQ0osV0FBVyxFQUFFLHlCQUF5QjtnQkFDdEMsS0FBSyxFQUFFLGFBQWEsQ0FBQyxRQUFRLENBQUMsR0FBRzthQUNsQztZQUNELGNBQWMsRUFBRSxJQUFJO1NBQ3JCLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTdaRCx3REE2WkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBzdGVwZnVuY3Rpb25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zdGVwZnVuY3Rpb25zJztcbmltcG9ydCAqIGFzIHN0ZXBmdW5jdGlvbnNUYXNrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucy10YXNrcyc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XG5pbXBvcnQgKiBhcyBvcGVuc2VhcmNoc2VydmVybGVzcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtb3BlbnNlYXJjaHNlcnZlcmxlc3MnO1xuaW1wb3J0ICogYXMga21zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1rbXMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEFuYWx5c2lzV29ya2Zsb3dzU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgZ2Fwc1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgYW1lbmRtZW50c1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgdmVjdG9yQ29sbGVjdGlvbjogb3BlbnNlYXJjaHNlcnZlcmxlc3MuQ2ZuQ29sbGVjdGlvbjtcbiAgZW5jcnlwdGlvbktleToga21zLktleTtcbn1cblxuZXhwb3J0IGNsYXNzIEFuYWx5c2lzV29ya2Zsb3dzU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgZ2FwQW5hbHlzaXNXb3JrZmxvdzogc3RlcGZ1bmN0aW9ucy5TdGF0ZU1hY2hpbmU7XG4gIHB1YmxpYyByZWFkb25seSBhbWVuZG1lbnREcmFmdGluZ1dvcmtmbG93OiBzdGVwZnVuY3Rpb25zLlN0YXRlTWFjaGluZTtcbiAgXG4gIC8vIExhbWJkYSBmdW5jdGlvbnNcbiAgcHVibGljIHJlYWRvbmx5IG9wZW5zZWFyY2hRdWVyeUZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XG4gIHB1YmxpYyByZWFkb25seSBiZWRyb2NrR2FwQW5hbHlzaXNGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uO1xuICBwdWJsaWMgcmVhZG9ubHkgYmVkcm9ja0RyYWZ0QW1lbmRtZW50c0Z1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XG4gIHB1YmxpYyByZWFkb25seSBzdG9yZUdhcHNGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uO1xuICBwdWJsaWMgcmVhZG9ubHkgcmV0cmlldmVHYXBGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uO1xuICBwdWJsaWMgcmVhZG9ubHkgc3RvcmVBbWVuZG1lbnRzRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQW5hbHlzaXNXb3JrZmxvd3NTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGdhcHNUYWJsZSwgYW1lbmRtZW50c1RhYmxlLCB2ZWN0b3JDb2xsZWN0aW9uLCBlbmNyeXB0aW9uS2V5IH0gPSBwcm9wcztcblxuICAgIC8vIENyZWF0ZSBMYW1iZGEgZnVuY3Rpb25zIGZvciBhbmFseXNpcyB3b3JrZmxvd3NcbiAgICB0aGlzLmNyZWF0ZUxhbWJkYUZ1bmN0aW9ucyhnYXBzVGFibGUsIGFtZW5kbWVudHNUYWJsZSwgdmVjdG9yQ29sbGVjdGlvbiwgZW5jcnlwdGlvbktleSk7XG5cbiAgICAvLyBDcmVhdGUgU3RlcCBGdW5jdGlvbnMgd29ya2Zsb3dzXG4gICAgdGhpcy5jcmVhdGVHYXBBbmFseXNpc1dvcmtmbG93KCk7XG4gICAgdGhpcy5jcmVhdGVBbWVuZG1lbnREcmFmdGluZ1dvcmtmbG93KCk7XG5cbiAgICAvLyBBZGQgdGFnc1xuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnUHJvamVjdCcsICdDb21wbGlBZ2VudC1TRycpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnRW52aXJvbm1lbnQnLCAnUHJvZHVjdGlvbicpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnTWFuYWdlZEJ5JywgJ0NESycpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnQ29tcG9uZW50JywgJ0FuYWx5c2lzV29ya2Zsb3dzJyk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUxhbWJkYUZ1bmN0aW9ucyhcbiAgICBnYXBzVGFibGU6IGR5bmFtb2RiLlRhYmxlLFxuICAgIGFtZW5kbWVudHNUYWJsZTogZHluYW1vZGIuVGFibGUsXG4gICAgdmVjdG9yQ29sbGVjdGlvbjogb3BlbnNlYXJjaHNlcnZlcmxlc3MuQ2ZuQ29sbGVjdGlvbixcbiAgICBlbmNyeXB0aW9uS2V5OiBrbXMuS2V5XG4gICk6IHZvaWQge1xuICAgIC8vIE9wZW5TZWFyY2ggUXVlcnkgTGFtYmRhXG4gICAgdGhpcy5vcGVuc2VhcmNoUXVlcnlGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ09wZW5TZWFyY2hRdWVyeUZ1bmN0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiAnQ29tcGxpQWdlbnQtT3BlblNlYXJjaFF1ZXJ5JyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzEwLFxuICAgICAgaGFuZGxlcjogJ2FwcC5sYW1iZGFfaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uLy4uL3NyYy9sYW1iZGEvb3BlbnNlYXJjaF9xdWVyeScpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBPUEVOU0VBUkNIX0VORFBPSU5UOiBgaHR0cHM6Ly8ke3ZlY3RvckNvbGxlY3Rpb24uYXR0ckNvbGxlY3Rpb25FbmRwb2ludH1gLFxuICAgICAgICBPUEVOU0VBUkNIX0lOREVYOiAnZG9jdW1lbnRzJyxcbiAgICAgIH0sXG4gICAgICByb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ09wZW5TZWFyY2hRdWVyeVJvbGUnLCB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgICAgXSxcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcbiAgICAgICAgICBPcGVuU2VhcmNoUXVlcnlQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsJyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWydhcm46YXdzOmJlZHJvY2s6Kjo6Zm91bmRhdGlvbi1tb2RlbC9hbWF6b24udGl0YW4tZW1iZWQtdGV4dC12MSddLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAnYW9zczpBUElBY2Nlc3NBbGwnLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbdmVjdG9yQ29sbGVjdGlvbi5hdHRyQXJuXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICAvLyBCZWRyb2NrIEdhcCBBbmFseXNpcyBMYW1iZGFcbiAgICB0aGlzLmJlZHJvY2tHYXBBbmFseXNpc0Z1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQmVkcm9ja0dhcEFuYWx5c2lzRnVuY3Rpb24nLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6ICdDb21wbGlBZ2VudC1CZWRyb2NrR2FwQW5hbHlzaXMnLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfMTAsXG4gICAgICBoYW5kbGVyOiAnYXBwLmxhbWJkYV9oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi4vLi4vc3JjL2xhbWJkYS9iZWRyb2NrX2dhcF9hbmFseXNpcycpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTApLFxuICAgICAgbWVtb3J5U2l6ZTogMTAyNCxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIENMQVVERV9NT0RFTF9JRDogJ2FudGhyb3BpYy5jbGF1ZGUtMy1zb25uZXQtMjAyNDAyMjktdjE6MCcsXG4gICAgICB9LFxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdCZWRyb2NrR2FwQW5hbHlzaXNSb2xlJywge1xuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgIF0sXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgQmVkcm9ja0dhcEFuYWx5c2lzUG9saWN5OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAnYmVkcm9jazpJbnZva2VNb2RlbCcsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnYXJuOmF3czpiZWRyb2NrOio6OmZvdW5kYXRpb24tbW9kZWwvYW50aHJvcGljLmNsYXVkZS0zLXNvbm5ldC0yMDI0MDIyOS12MTowJ10sXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgLy8gQmVkcm9jayBEcmFmdCBBbWVuZG1lbnRzIExhbWJkYVxuICAgIHRoaXMuYmVkcm9ja0RyYWZ0QW1lbmRtZW50c0Z1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQmVkcm9ja0RyYWZ0QW1lbmRtZW50c0Z1bmN0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiAnQ29tcGxpQWdlbnQtQmVkcm9ja0RyYWZ0QW1lbmRtZW50cycsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMCxcbiAgICAgIGhhbmRsZXI6ICdhcHAubGFtYmRhX2hhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi8uLi9zcmMvbGFtYmRhL2JlZHJvY2tfZHJhZnRfYW1lbmRtZW50cycpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTApLFxuICAgICAgbWVtb3J5U2l6ZTogMTAyNCxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIENMQVVERV9NT0RFTF9JRDogJ2FudGhyb3BpYy5jbGF1ZGUtMy1zb25uZXQtMjAyNDAyMjktdjE6MCcsXG4gICAgICB9LFxuICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdCZWRyb2NrRHJhZnRBbWVuZG1lbnRzUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgICBdLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIEJlZHJvY2tEcmFmdEFtZW5kbWVudHNQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsJyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWydhcm46YXdzOmJlZHJvY2s6Kjo6Zm91bmRhdGlvbi1tb2RlbC9hbnRocm9waWMuY2xhdWRlLTMtc29ubmV0LTIwMjQwMjI5LXYxOjAnXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICAvLyBTdG9yZSBHYXBzIExhbWJkYVxuICAgIHRoaXMuc3RvcmVHYXBzRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTdG9yZUdhcHNGdW5jdGlvbicsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ0NvbXBsaUFnZW50LVN0b3JlR2FwcycsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMCxcbiAgICAgIGhhbmRsZXI6ICdhcHAubGFtYmRhX2hhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi8uLi9zcmMvbGFtYmRhL3N0b3JlX2dhcHMnKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgR0FQU19UQUJMRV9OQU1FOiBnYXBzVGFibGUudGFibGVOYW1lLFxuICAgICAgfSxcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnU3RvcmVHYXBzUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgICBdLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIFN0b3JlR2Fwc1BvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlB1dEl0ZW0nLFxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlVwZGF0ZUl0ZW0nLFxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOkdldEl0ZW0nLFxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlF1ZXJ5JyxcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpTY2FuJyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgICAgICAgICAgZ2Fwc1RhYmxlLnRhYmxlQXJuLFxuICAgICAgICAgICAgICAgICAgYCR7Z2Fwc1RhYmxlLnRhYmxlQXJufS9pbmRleC8qYCxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAna21zOkRlY3J5cHQnLFxuICAgICAgICAgICAgICAgICAgJ2ttczpHZW5lcmF0ZURhdGFLZXknLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbZW5jcnlwdGlvbktleS5rZXlBcm5dLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIC8vIFJldHJpZXZlIEdhcCBMYW1iZGFcbiAgICB0aGlzLnJldHJpZXZlR2FwRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdSZXRyaWV2ZUdhcEZ1bmN0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiAnQ29tcGxpQWdlbnQtUmV0cmlldmVHYXAnLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfMTAsXG4gICAgICBoYW5kbGVyOiAnYXBwLmxhbWJkYV9oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi4vLi4vc3JjL2xhbWJkYS9yZXRyaWV2ZV9nYXAnKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgR0FQU19UQUJMRV9OQU1FOiBnYXBzVGFibGUudGFibGVOYW1lLFxuICAgICAgfSxcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnUmV0cmlldmVHYXBSb2xlJywge1xuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgIF0sXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgUmV0cmlldmVHYXBQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpHZXRJdGVtJyxcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpRdWVyeScsXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6U2NhbicsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgICAgICAgIGdhcHNUYWJsZS50YWJsZUFybixcbiAgICAgICAgICAgICAgICAgIGAke2dhcHNUYWJsZS50YWJsZUFybn0vaW5kZXgvKmAsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ2ttczpEZWNyeXB0JyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW2VuY3J5cHRpb25LZXkua2V5QXJuXSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICAvLyBTdG9yZSBBbWVuZG1lbnRzIExhbWJkYVxuICAgIHRoaXMuc3RvcmVBbWVuZG1lbnRzRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTdG9yZUFtZW5kbWVudHNGdW5jdGlvbicsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ0NvbXBsaUFnZW50LVN0b3JlQW1lbmRtZW50cycsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMCxcbiAgICAgIGhhbmRsZXI6ICdhcHAubGFtYmRhX2hhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi8uLi9zcmMvbGFtYmRhL3N0b3JlX2FtZW5kbWVudHMnKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgQU1FTkRNRU5UU19UQUJMRV9OQU1FOiBhbWVuZG1lbnRzVGFibGUudGFibGVOYW1lLFxuICAgICAgfSxcbiAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnU3RvcmVBbWVuZG1lbnRzUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgICBdLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIFN0b3JlQW1lbmRtZW50c1BvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlB1dEl0ZW0nLFxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlVwZGF0ZUl0ZW0nLFxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOkdldEl0ZW0nLFxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlF1ZXJ5JyxcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpTY2FuJyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgICAgICAgICAgYW1lbmRtZW50c1RhYmxlLnRhYmxlQXJuLFxuICAgICAgICAgICAgICAgICAgYCR7YW1lbmRtZW50c1RhYmxlLnRhYmxlQXJufS9pbmRleC8qYCxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAna21zOkRlY3J5cHQnLFxuICAgICAgICAgICAgICAgICAgJ2ttczpHZW5lcmF0ZURhdGFLZXknLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbZW5jcnlwdGlvbktleS5rZXlBcm5dLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlR2FwQW5hbHlzaXNXb3JrZmxvdygpOiB2b2lkIHtcbiAgICAvLyBDcmVhdGUgQ2xvdWRXYXRjaCBMb2cgR3JvdXAgZm9yIHRoZSB3b3JrZmxvd1xuICAgIGNvbnN0IGdhcEFuYWx5c2lzTG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnR2FwQW5hbHlzaXNXb3JrZmxvd0xvZ0dyb3VwJywge1xuICAgICAgbG9nR3JvdXBOYW1lOiAnL2F3cy9zdGVwZnVuY3Rpb25zL0NvbXBsaUFnZW50LUdhcEFuYWx5c2lzJyxcbiAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICB9KTtcblxuICAgIC8vIERlZmluZSB0aGUgR2FwIEFuYWx5c2lzIHdvcmtmbG93XG4gICAgY29uc3QgcXVlcnlWZWN0b3JTdG9yZSA9IG5ldyBzdGVwZnVuY3Rpb25zVGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdRdWVyeVZlY3RvclN0b3JlJywge1xuICAgICAgbGFtYmRhRnVuY3Rpb246IHRoaXMub3BlbnNlYXJjaFF1ZXJ5RnVuY3Rpb24sXG4gICAgICBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyxcbiAgICAgIHJldHJ5T25TZXJ2aWNlRXhjZXB0aW9uczogdHJ1ZSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGFuYWx5emVHYXBzID0gbmV3IHN0ZXBmdW5jdGlvbnNUYXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ0FuYWx5emVHYXBzJywge1xuICAgICAgbGFtYmRhRnVuY3Rpb246IHRoaXMuYmVkcm9ja0dhcEFuYWx5c2lzRnVuY3Rpb24sXG4gICAgICBpbnB1dFBhdGg6ICckJyxcbiAgICAgIG91dHB1dFBhdGg6ICckLlBheWxvYWQnLFxuICAgICAgcmV0cnlPblNlcnZpY2VFeGNlcHRpb25zOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgY29uc3Qgc3RvcmVHYXBzID0gbmV3IHN0ZXBmdW5jdGlvbnNUYXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ1N0b3JlR2FwcycsIHtcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiB0aGlzLnN0b3JlR2Fwc0Z1bmN0aW9uLFxuICAgICAgaW5wdXRQYXRoOiAnJC5ib2R5JyxcbiAgICAgIG91dHB1dFBhdGg6ICckLlBheWxvYWQnLFxuICAgICAgcmV0cnlPblNlcnZpY2VFeGNlcHRpb25zOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gSGFuZGxlIGVycm9yc1xuICAgIGNvbnN0IGhhbmRsZUVycm9yID0gbmV3IHN0ZXBmdW5jdGlvbnMuUGFzcyh0aGlzLCAnSGFuZGxlR2FwQW5hbHlzaXNFcnJvcicsIHtcbiAgICAgIHJlc3VsdDogc3RlcGZ1bmN0aW9ucy5SZXN1bHQuZnJvbU9iamVjdCh7XG4gICAgICAgIGVycm9yOiAnR2FwIGFuYWx5c2lzIHdvcmtmbG93IGZhaWxlZCcsXG4gICAgICAgIHRpbWVzdGFtcDogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJCQuU3RhdGUuRW50ZXJlZFRpbWUnKVxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICAvLyBEZWZpbmUgdGhlIHdvcmtmbG93IGNoYWluXG4gICAgY29uc3QgZGVmaW5pdGlvbiA9IHF1ZXJ5VmVjdG9yU3RvcmVcbiAgICAgIC5hZGRDYXRjaChoYW5kbGVFcnJvciwge1xuICAgICAgICBlcnJvcnM6IFsnU3RhdGVzLkFMTCddLFxuICAgICAgICByZXN1bHRQYXRoOiAnJC5lcnJvcidcbiAgICAgIH0pXG4gICAgICAubmV4dChhbmFseXplR2Fwc1xuICAgICAgICAuYWRkQ2F0Y2goaGFuZGxlRXJyb3IsIHtcbiAgICAgICAgICBlcnJvcnM6IFsnU3RhdGVzLkFMTCddLFxuICAgICAgICAgIHJlc3VsdFBhdGg6ICckLmVycm9yJ1xuICAgICAgICB9KSlcbiAgICAgIC5uZXh0KHN0b3JlR2Fwc1xuICAgICAgICAuYWRkQ2F0Y2goaGFuZGxlRXJyb3IsIHtcbiAgICAgICAgICBlcnJvcnM6IFsnU3RhdGVzLkFMTCddLFxuICAgICAgICAgIHJlc3VsdFBhdGg6ICckLmVycm9yJ1xuICAgICAgICB9KSk7XG5cbiAgICAvLyBDcmVhdGUgdGhlIFN0YXRlIE1hY2hpbmVcbiAgICB0aGlzLmdhcEFuYWx5c2lzV29ya2Zsb3cgPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdGF0ZU1hY2hpbmUodGhpcywgJ0dhcEFuYWx5c2lzV29ya2Zsb3cnLCB7XG4gICAgICBzdGF0ZU1hY2hpbmVOYW1lOiAnQ29tcGxpQWdlbnQtR2FwQW5hbHlzaXMnLFxuICAgICAgZGVmaW5pdGlvbixcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDMwKSxcbiAgICAgIGxvZ3M6IHtcbiAgICAgICAgZGVzdGluYXRpb246IGdhcEFuYWx5c2lzTG9nR3JvdXAsXG4gICAgICAgIGxldmVsOiBzdGVwZnVuY3Rpb25zLkxvZ0xldmVsLkFMTCxcbiAgICAgIH0sXG4gICAgICB0cmFjaW5nRW5hYmxlZDogdHJ1ZSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlQW1lbmRtZW50RHJhZnRpbmdXb3JrZmxvdygpOiB2b2lkIHtcbiAgICAvLyBDcmVhdGUgQ2xvdWRXYXRjaCBMb2cgR3JvdXAgZm9yIHRoZSB3b3JrZmxvd1xuICAgIGNvbnN0IGFtZW5kbWVudERyYWZ0aW5nTG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnQW1lbmRtZW50RHJhZnRpbmdXb3JrZmxvd0xvZ0dyb3VwJywge1xuICAgICAgbG9nR3JvdXBOYW1lOiAnL2F3cy9zdGVwZnVuY3Rpb25zL0NvbXBsaUFnZW50LUFtZW5kbWVudERyYWZ0aW5nJyxcbiAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICB9KTtcblxuICAgIC8vIERlZmluZSB0aGUgQW1lbmRtZW50IERyYWZ0aW5nIHdvcmtmbG93XG4gICAgY29uc3QgcmV0cmlldmVHYXBEZXRhaWxzID0gbmV3IHN0ZXBmdW5jdGlvbnNUYXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ1JldHJpZXZlR2FwRGV0YWlscycsIHtcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiB0aGlzLnJldHJpZXZlR2FwRnVuY3Rpb24sXG4gICAgICBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyxcbiAgICAgIHJldHJ5T25TZXJ2aWNlRXhjZXB0aW9uczogdHJ1ZSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGRyYWZ0QW1lbmRtZW50cyA9IG5ldyBzdGVwZnVuY3Rpb25zVGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdEcmFmdEFtZW5kbWVudHMnLCB7XG4gICAgICBsYW1iZGFGdW5jdGlvbjogdGhpcy5iZWRyb2NrRHJhZnRBbWVuZG1lbnRzRnVuY3Rpb24sXG4gICAgICBpbnB1dFBhdGg6ICckJyxcbiAgICAgIG91dHB1dFBhdGg6ICckLlBheWxvYWQnLFxuICAgICAgcmV0cnlPblNlcnZpY2VFeGNlcHRpb25zOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgY29uc3Qgc3RvcmVBbWVuZG1lbnRzID0gbmV3IHN0ZXBmdW5jdGlvbnNUYXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ1N0b3JlQW1lbmRtZW50cycsIHtcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiB0aGlzLnN0b3JlQW1lbmRtZW50c0Z1bmN0aW9uLFxuICAgICAgaW5wdXRQYXRoOiAnJC5ib2R5JyxcbiAgICAgIG91dHB1dFBhdGg6ICckLlBheWxvYWQnLFxuICAgICAgcmV0cnlPblNlcnZpY2VFeGNlcHRpb25zOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gSGFuZGxlIGVycm9yc1xuICAgIGNvbnN0IGhhbmRsZUFtZW5kbWVudEVycm9yID0gbmV3IHN0ZXBmdW5jdGlvbnMuUGFzcyh0aGlzLCAnSGFuZGxlQW1lbmRtZW50RHJhZnRpbmdFcnJvcicsIHtcbiAgICAgIHJlc3VsdDogc3RlcGZ1bmN0aW9ucy5SZXN1bHQuZnJvbU9iamVjdCh7XG4gICAgICAgIGVycm9yOiAnQW1lbmRtZW50IGRyYWZ0aW5nIHdvcmtmbG93IGZhaWxlZCcsXG4gICAgICAgIHRpbWVzdGFtcDogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJCQuU3RhdGUuRW50ZXJlZFRpbWUnKVxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICAvLyBEZWZpbmUgdGhlIHdvcmtmbG93IGNoYWluXG4gICAgY29uc3QgZGVmaW5pdGlvbiA9IHJldHJpZXZlR2FwRGV0YWlsc1xuICAgICAgLmFkZENhdGNoKGhhbmRsZUFtZW5kbWVudEVycm9yLCB7XG4gICAgICAgIGVycm9yczogWydTdGF0ZXMuQUxMJ10sXG4gICAgICAgIHJlc3VsdFBhdGg6ICckLmVycm9yJ1xuICAgICAgfSlcbiAgICAgIC5uZXh0KGRyYWZ0QW1lbmRtZW50c1xuICAgICAgICAuYWRkQ2F0Y2goaGFuZGxlQW1lbmRtZW50RXJyb3IsIHtcbiAgICAgICAgICBlcnJvcnM6IFsnU3RhdGVzLkFMTCddLFxuICAgICAgICAgIHJlc3VsdFBhdGg6ICckLmVycm9yJ1xuICAgICAgICB9KSlcbiAgICAgIC5uZXh0KHN0b3JlQW1lbmRtZW50c1xuICAgICAgICAuYWRkQ2F0Y2goaGFuZGxlQW1lbmRtZW50RXJyb3IsIHtcbiAgICAgICAgICBlcnJvcnM6IFsnU3RhdGVzLkFMTCddLFxuICAgICAgICAgIHJlc3VsdFBhdGg6ICckLmVycm9yJ1xuICAgICAgICB9KSk7XG5cbiAgICAvLyBDcmVhdGUgdGhlIFN0YXRlIE1hY2hpbmVcbiAgICB0aGlzLmFtZW5kbWVudERyYWZ0aW5nV29ya2Zsb3cgPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdGF0ZU1hY2hpbmUodGhpcywgJ0FtZW5kbWVudERyYWZ0aW5nV29ya2Zsb3cnLCB7XG4gICAgICBzdGF0ZU1hY2hpbmVOYW1lOiAnQ29tcGxpQWdlbnQtQW1lbmRtZW50RHJhZnRpbmcnLFxuICAgICAgZGVmaW5pdGlvbixcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDMwKSxcbiAgICAgIGxvZ3M6IHtcbiAgICAgICAgZGVzdGluYXRpb246IGFtZW5kbWVudERyYWZ0aW5nTG9nR3JvdXAsXG4gICAgICAgIGxldmVsOiBzdGVwZnVuY3Rpb25zLkxvZ0xldmVsLkFMTCxcbiAgICAgIH0sXG4gICAgICB0cmFjaW5nRW5hYmxlZDogdHJ1ZSxcbiAgICB9KTtcbiAgfVxufVxuIl19