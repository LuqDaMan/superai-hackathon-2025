#!/bin/bash

# CompliAgent-SG Document Processing Deployment Script

set -e

echo "🚀 Starting CompliAgent-SG Document Processing Deployment"

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

# Install Lambda dependencies
echo "📦 Installing Lambda dependencies..."

# MAS Monitor Lambda
echo "  - Installing MAS Monitor dependencies..."
cd ../src/lambda/mas_monitor
pip install -r requirements.txt -t .
cd ../../../infrastructure/cdk

# Textract Processor Lambda
echo "  - Installing Textract Processor dependencies..."
cd ../src/lambda/textract_processor
pip install -r requirements.txt -t .
cd ../../../infrastructure/cdk

# Vectorize Content Lambda
echo "  - Installing Vectorize Content dependencies..."
cd ../src/lambda/vectorize_content
pip install -r requirements.txt -t .
cd ../../../infrastructure/cdk

# Install CDK dependencies
echo "📦 Installing CDK dependencies..."
npm install

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Show diff
echo "📋 Showing deployment diff..."
npm run diff

# Ask for confirmation
read -p "Do you want to proceed with document processing deployment? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled"
    exit 1
fi

# Deploy the stack
echo "🚀 Deploying infrastructure..."
cdk deploy CompliAgent-SG --require-approval never

echo "✅ Document processing deployment completed successfully!"
echo ""
echo "📝 Next steps:"
echo "1. Verify Lambda functions in AWS Console"
echo "2. Test the MAS monitor function manually"
echo "3. Upload a test PDF to trigger the processing pipeline"
echo "4. Check OpenSearch Serverless for indexed documents"
echo "5. Proceed with analysis workflows implementation"
