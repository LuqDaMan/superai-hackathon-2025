#!/usr/bin/env python3
"""
Test script for CompliAgent-SG Document Processing Pipeline
"""

import boto3
import json
import time
from datetime import datetime

def test_document_processing():
    """Test the document processing pipeline"""
    
    # Initialize AWS clients
    lambda_client = boto3.client('lambda')
    s3_client = boto3.client('s3')
    
    print("🧪 Testing CompliAgent-SG Document Processing Pipeline")
    print("=" * 60)
    
    # Test 1: Invoke MAS Monitor Lambda
    print("\n1. Testing MAS Monitor Lambda...")
    try:
        response = lambda_client.invoke(
            FunctionName='CompliAgent-MasMonitor',
            InvocationType='RequestResponse',
            Payload=json.dumps({})
        )
        
        result = json.loads(response['Payload'].read())
        print(f"   ✅ MAS Monitor Response: {result.get('statusCode', 'Unknown')}")
        
        if result.get('statusCode') == 200:
            body = result.get('body', {})
            print(f"   📊 Documents found: {body.get('total_documents_found', 0)}")
            print(f"   📥 New downloads: {body.get('new_documents_downloaded', 0)}")
        
    except Exception as e:
        print(f"   ❌ MAS Monitor Error: {str(e)}")
    
    # Test 2: Check S3 buckets
    print("\n2. Checking S3 buckets...")
    
    try:
        # Get account ID for bucket names
        sts_client = boto3.client('sts')
        account_id = sts_client.get_caller_identity()['Account']
        region = boto3.Session().region_name or 'us-east-1'
        
        buckets_to_check = [
            f'mas-docs-raw-{account_id}-{region}',
            f'internal-docs-raw-{account_id}-{region}',
            f'processed-docs-json-{account_id}-{region}'
        ]
        
        for bucket_name in buckets_to_check:
            try:
                response = s3_client.list_objects_v2(Bucket=bucket_name, MaxKeys=5)
                object_count = response.get('KeyCount', 0)
                print(f"   📁 {bucket_name}: {object_count} objects")
            except Exception as e:
                print(f"   ❌ {bucket_name}: Error - {str(e)}")
                
    except Exception as e:
        print(f"   ❌ S3 Check Error: {str(e)}")
    
    # Test 3: Check Lambda functions exist
    print("\n3. Checking Lambda functions...")
    
    functions_to_check = [
        'CompliAgent-MasMonitor',
        'CompliAgent-TextractProcessor',
        'CompliAgent-VectorizeContent'
    ]
    
    for function_name in functions_to_check:
        try:
            response = lambda_client.get_function(FunctionName=function_name)
            state = response['Configuration']['State']
            print(f"   🔧 {function_name}: {state}")
        except Exception as e:
            print(f"   ❌ {function_name}: Not found or error - {str(e)}")
    
    # Test 4: Check DynamoDB tables
    print("\n4. Checking DynamoDB tables...")
    
    dynamodb = boto3.client('dynamodb')
    tables_to_check = [
        'CompliAgent-GapsTable',
        'CompliAgent-AmendmentsTable',
        'CompliAgent-DocumentTracking'
    ]
    
    for table_name in tables_to_check:
        try:
            response = dynamodb.describe_table(TableName=table_name)
            status = response['Table']['TableStatus']
            item_count = response['Table']['ItemCount']
            print(f"   🗃️  {table_name}: {status} ({item_count} items)")
        except Exception as e:
            print(f"   ❌ {table_name}: Not found or error - {str(e)}")
    
    # Test 5: Check OpenSearch Serverless collection
    print("\n5. Checking OpenSearch Serverless...")
    
    try:
        opensearch_client = boto3.client('opensearchserverless')
        response = opensearch_client.list_collections()
        
        vector_collection = None
        for collection in response.get('collectionSummaries', []):
            if collection['name'] == 'vector-collection':
                vector_collection = collection
                break
        
        if vector_collection:
            print(f"   🔍 vector-collection: {vector_collection['status']}")
        else:
            print("   ❌ vector-collection: Not found")
            
    except Exception as e:
        print(f"   ❌ OpenSearch Check Error: {str(e)}")
    
    print("\n" + "=" * 60)
    print("🏁 Document Processing Pipeline Test Complete")
    print("\n💡 To test the full pipeline:")
    print("   1. Upload a PDF to the MAS docs bucket")
    print("   2. Check CloudWatch logs for processing")
    print("   3. Verify processed JSON in processed docs bucket")
    print("   4. Check OpenSearch for indexed vectors")

if __name__ == "__main__":
    test_document_processing()
