#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CompliAgentStack } from './compliagent-stack';

const app = new cdk.App();

// Deploy the CompliAgent stack
new CompliAgentStack(app, 'CompliAgent-SG', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'CompliAgent-SG system with core infrastructure and document processing',
});

app.synth();
