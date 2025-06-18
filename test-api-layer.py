#!/usr/bin/env python3
"""
Test script for CompliAgent-SG API Layer
"""

import boto3
import json
import requests
import time
from datetime import datetime

def test_api_layer():
    """Test the API layer components"""
    
    # Initialize AWS clients
    lambda_client = boto3.client('lambda')
    apigateway_client = boto3.client('apigateway')
    cognito_client = boto3.client('cognito-idp')
    
    print("🧪 Testing CompliAgent-SG API Layer")
    print("=" * 60)
    
    # Test 1: Check Lambda functions
    print("\n1. Testing API Lambda Functions...")
    
    api_functions = [
        'CompliAgent-ApiHandler',
        'CompliAgent-WebSocketHandler'
    ]
    
    for function_name in api_functions:
        try:
            response = lambda_client.get_function(FunctionName=function_name)
            state = response['Configuration']['State']
            runtime = response['Configuration']['Runtime']
            print(f"   🔧 {function_name}: {state} ({runtime})")
        except Exception as e:
            print(f"   ❌ {function_name}: Not found or error - {str(e)}")
    
    # Test 2: Check API Gateway
    print("\n2. Testing API Gateway...")
    
    try:
        # List REST APIs
        response = apigateway_client.get_rest_apis()
        compliagent_apis = [api for api in response['items'] if 'CompliAgent' in api['name']]
        
        for api in compliagent_apis:
            print(f"   🌐 {api['name']}: {api['id']} ({api.get('description', 'No description')})")
            
            # Get API endpoint
            api_endpoint = f"https://{api['id']}.execute-api.{boto3.Session().region_name}.amazonaws.com/prod"
            print(f"      📍 Endpoint: {api_endpoint}")
            
    except Exception as e:
        print(f"   ❌ API Gateway Error: {str(e)}")
    
    # Test 3: Check Cognito User Pool
    print("\n3. Testing Cognito User Pool...")
    
    try:
        # List user pools
        response = cognito_client.list_user_pools(MaxResults=10)
        compliagent_pools = [pool for pool in response['UserPools'] if 'CompliAgent' in pool['Name']]
        
        for pool in compliagent_pools:
            print(f"   👥 {pool['Name']}: {pool['Id']}")
            
            # Get pool details
            pool_details = cognito_client.describe_user_pool(UserPoolId=pool['Id'])
            pool_info = pool_details['UserPool']
            
            print(f"      📧 Email verification: {pool_info.get('AutoVerifiedAttributes', [])}")
            print(f"      🔐 Password policy: Min length {pool_info.get('Policies', {}).get('PasswordPolicy', {}).get('MinimumLength', 'N/A')}")
            
    except Exception as e:
        print(f"   ❌ Cognito Error: {str(e)}")
    
    # Test 4: Test API Handler Function directly
    print("\n4. Testing API Handler Function...")
    
    try:
        # Test health endpoint
        test_event = {
            "httpMethod": "GET",
            "path": "/health",
            "pathParameters": None,
            "queryStringParameters": None,
            "body": None,
            "headers": {
                "Content-Type": "application/json"
            }
        }
        
        response = lambda_client.invoke(
            FunctionName='CompliAgent-ApiHandler',
            InvocationType='RequestResponse',
            Payload=json.dumps(test_event)
        )
        
        result = json.loads(response['Payload'].read())
        print(f"   ✅ Health Check Response: {result.get('statusCode', 'Unknown')}")
        
        if result.get('statusCode') == 200:
            body = json.loads(result.get('body', '{}'))
            print(f"   💚 Service Status: {body.get('status', 'Unknown')}")
            print(f"   📊 Service Version: {body.get('version', 'Unknown')}")
        
    except Exception as e:
        print(f"   ❌ API Handler Test Error: {str(e)}")
    
    # Test 5: Test CORS preflight
    print("\n5. Testing CORS Support...")
    
    try:
        # Test OPTIONS request
        options_event = {
            "httpMethod": "OPTIONS",
            "path": "/gaps",
            "pathParameters": None,
            "queryStringParameters": None,
            "body": None,
            "headers": {
                "Origin": "https://example.com",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "Content-Type,Authorization"
            }
        }
        
        response = lambda_client.invoke(
            FunctionName='CompliAgent-ApiHandler',
            InvocationType='RequestResponse',
            Payload=json.dumps(options_event)
        )
        
        result = json.loads(response['Payload'].read())
        print(f"   ✅ CORS Preflight Response: {result.get('statusCode', 'Unknown')}")
        
        if result.get('statusCode') == 200:
            headers = result.get('headers', {})
            print(f"   🌐 CORS Origin: {headers.get('Access-Control-Allow-Origin', 'Not set')}")
            print(f"   📝 CORS Methods: {headers.get('Access-Control-Allow-Methods', 'Not set')}")
        
    except Exception as e:
        print(f"   ❌ CORS Test Error: {str(e)}")
    
    # Test 6: Test WebSocket Handler
    print("\n6. Testing WebSocket Handler...")
    
    try:
        # Test WebSocket connection event
        connect_event = {
            "requestContext": {
                "routeKey": "$connect",
                "connectionId": "test-connection-123"
            },
            "queryStringParameters": {
                "userId": "test-user",
                "userRole": "admin"
            }
        }
        
        response = lambda_client.invoke(
            FunctionName='CompliAgent-WebSocketHandler',
            InvocationType='RequestResponse',
            Payload=json.dumps(connect_event)
        )
        
        result = json.loads(response['Payload'].read())
        print(f"   ✅ WebSocket Connect Response: {result.get('statusCode', 'Unknown')}")
        
    except Exception as e:
        print(f"   ❌ WebSocket Handler Test Error: {str(e)}")
    
    # Test 7: Check DynamoDB Tables
    print("\n7. Checking DynamoDB Tables...")
    
    dynamodb = boto3.client('dynamodb')
    tables_to_check = [
        'CompliAgent-GapsTable',
        'CompliAgent-AmendmentsTable',
        'CompliAgent-WebSocketConnections'
    ]
    
    for table_name in tables_to_check:
        try:
            response = dynamodb.describe_table(TableName=table_name)
            status = response['Table']['TableStatus']
            item_count = response['Table']['ItemCount']
            print(f"   🗃️  {table_name}: {status} ({item_count} items)")
        except Exception as e:
            print(f"   ❌ {table_name}: Not found or error - {str(e)}")
    
    print("\n" + "=" * 60)
    print("🏁 API Layer Test Complete")
    print("\n💡 Next steps to test the full API:")
    print("   1. Create a Cognito user for testing")
    print("   2. Get authentication tokens")
    print("   3. Test authenticated API endpoints")
    print("   4. Test real-time WebSocket connections")
    print("   5. Integrate with frontend application")
    print("\n🔧 Example API usage:")
    print("   # Get API endpoint from AWS Console")
    print("   # curl -X GET https://your-api-id.execute-api.region.amazonaws.com/prod/health")

def create_test_user():
    """Helper function to create a test user in Cognito"""
    print("\n🔧 Creating test user in Cognito...")
    
    try:
        cognito_client = boto3.client('cognito-idp')
        
        # List user pools to find CompliAgent pool
        response = cognito_client.list_user_pools(MaxResults=10)
        compliagent_pools = [pool for pool in response['UserPools'] if 'CompliAgent' in pool['Name']]
        
        if not compliagent_pools:
            print("   ❌ No CompliAgent user pool found")
            return
        
        user_pool_id = compliagent_pools[0]['Id']
        
        # Create test user
        test_email = "test@example.com"
        test_password = "TempPassword123!"
        
        try:
            cognito_client.admin_create_user(
                UserPoolId=user_pool_id,
                Username=test_email,
                TemporaryPassword=test_password,
                MessageAction='SUPPRESS'
            )
            
            # Set permanent password
            cognito_client.admin_set_user_password(
                UserPoolId=user_pool_id,
                Username=test_email,
                Password=test_password,
                Permanent=True
            )
            
            print(f"   ✅ Test user created: {test_email}")
            print(f"   🔑 Password: {test_password}")
            
        except cognito_client.exceptions.UsernameExistsException:
            print(f"   ℹ️  Test user already exists: {test_email}")
        
    except Exception as e:
        print(f"   ❌ Error creating test user: {str(e)}")

if __name__ == "__main__":
    test_api_layer()
    
    # Optionally create test user
    create_test = input("\nDo you want to create a test user in Cognito? (y/N): ")
    if create_test.lower() == 'y':
        create_test_user()
