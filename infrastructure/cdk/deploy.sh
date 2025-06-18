#!/bin/bash

# CompliAgent-SG Infrastructure Deployment Script

set -e

echo "🚀 Starting CompliAgent-SG Infrastructure Deployment"

# Check if AWS CLI is configured
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "❌ AWS CLI is not configured or credentials are invalid"
    echo "Please run 'aws configure' to set up your credentials"
    exit 1
fi

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    echo "❌ AWS CDK CLI is not installed"
    echo "Please install it with: npm install -g aws-cdk"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Bootstrap CDK if needed
echo "🏗️  Checking CDK bootstrap..."
if ! cdk bootstrap --show-template > /dev/null 2>&1; then
    echo "🏗️  Bootstrapping CDK..."
    cdk bootstrap
fi

# Show diff
echo "📋 Showing deployment diff..."
npm run diff

# Ask for confirmation
read -p "Do you want to proceed with deployment? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled"
    exit 1
fi

# Deploy
echo "🚀 Deploying infrastructure..."
npm run deploy

echo "✅ Infrastructure deployment completed successfully!"
echo ""
echo "📝 Next steps:"
echo "1. Verify resources in AWS Console"
echo "2. Proceed with document processing Lambda implementation"
echo "3. Set up Step Functions workflows"
echo "4. Create API layer"
echo "5. Deploy frontend application"
