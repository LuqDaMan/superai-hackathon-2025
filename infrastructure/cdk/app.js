#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const cdk = require("aws-cdk-lib");
const compliagent_stack_1 = require("./compliagent-stack");
const app = new cdk.App();
// Deploy the CompliAgent stack
new compliagent_stack_1.CompliAgentStack(app, 'CompliAgent-SG', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
    description: 'CompliAgent-SG system with core infrastructure and document processing',
});
app.synth();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBwLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLHVDQUFxQztBQUNyQyxtQ0FBbUM7QUFDbkMsMkRBQXVEO0FBRXZELE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLCtCQUErQjtBQUMvQixJQUFJLG9DQUFnQixDQUFDLEdBQUcsRUFBRSxnQkFBZ0IsRUFBRTtJQUMxQyxHQUFHLEVBQUU7UUFDSCxPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUI7UUFDeEMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLElBQUksV0FBVztLQUN0RDtJQUNELFdBQVcsRUFBRSx3RUFBd0U7Q0FDdEYsQ0FBQyxDQUFDO0FBRUgsR0FBRyxDQUFDLEtBQUssRUFBRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxyXG5pbXBvcnQgJ3NvdXJjZS1tYXAtc3VwcG9ydC9yZWdpc3Rlcic7XHJcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCB7IENvbXBsaUFnZW50U3RhY2sgfSBmcm9tICcuL2NvbXBsaWFnZW50LXN0YWNrJztcclxuXHJcbmNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XHJcblxyXG4vLyBEZXBsb3kgdGhlIENvbXBsaUFnZW50IHN0YWNrXHJcbm5ldyBDb21wbGlBZ2VudFN0YWNrKGFwcCwgJ0NvbXBsaUFnZW50LVNHJywge1xyXG4gIGVudjoge1xyXG4gICAgYWNjb3VudDogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCxcclxuICAgIHJlZ2lvbjogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfUkVHSU9OIHx8ICd1cy1lYXN0LTEnLFxyXG4gIH0sXHJcbiAgZGVzY3JpcHRpb246ICdDb21wbGlBZ2VudC1TRyBzeXN0ZW0gd2l0aCBjb3JlIGluZnJhc3RydWN0dXJlIGFuZCBkb2N1bWVudCBwcm9jZXNzaW5nJyxcclxufSk7XHJcblxyXG5hcHAuc3ludGgoKTtcclxuIl19