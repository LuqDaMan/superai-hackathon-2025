#!/usr/bin/env python3
"""
Test script for CompliAgent-SG Analysis Workflows
"""

import boto3
import json
import time
from datetime import datetime

def test_analysis_workflows():
    """Test the analysis workflow components"""
    
    # Initialize AWS clients
    lambda_client = boto3.client('lambda')
    stepfunctions_client = boto3.client('stepfunctions')
    
    print("🧪 Testing CompliAgent-SG Analysis Workflows")
    print("=" * 60)
    
    # Test 1: Check Lambda functions
    print("\n1. Testing Analysis Lambda Functions...")
    
    analysis_functions = [
        'CompliAgent-OpenSearchQuery',
        'CompliAgent-BedrockGapAnalysis',
        'CompliAgent-StoreGaps',
        'CompliAgent-RetrieveGap',
        'CompliAgent-BedrockDraftAmendments',
        'CompliAgent-StoreAmendments'
    ]
    
    for function_name in analysis_functions:
        try:
            response = lambda_client.get_function(FunctionName=function_name)
            state = response['Configuration']['State']
            runtime = response['Configuration']['Runtime']
            print(f"   🔧 {function_name}: {state} ({runtime})")
        except Exception as e:
            print(f"   ❌ {function_name}: Not found or error - {str(e)}")
    
    # Test 2: Check Step Functions
    print("\n2. Testing Step Functions Workflows...")
    
    workflows = [
        'CompliAgent-GapAnalysis',
        'CompliAgent-AmendmentDrafting'
    ]
    
    for workflow_name in workflows:
        try:
            response = stepfunctions_client.describe_state_machine(
                stateMachineArn=f"arn:aws:states:{boto3.Session().region_name}:{boto3.client('sts').get_caller_identity()['Account']}:stateMachine:{workflow_name}"
            )
            status = response['status']
            print(f"   🔄 {workflow_name}: {status}")
        except Exception as e:
            print(f"   ❌ {workflow_name}: Not found or error - {str(e)}")
    
    # Test 3: Test OpenSearch Query Function
    print("\n3. Testing OpenSearch Query Function...")
    
    try:
        test_payload = {
            "query_text": "data retention policy",
            "search_type": "hybrid",
            "size": 5
        }
        
        response = lambda_client.invoke(
            FunctionName='CompliAgent-OpenSearchQuery',
            InvocationType='RequestResponse',
            Payload=json.dumps(test_payload)
        )
        
        result = json.loads(response['Payload'].read())
        print(f"   ✅ OpenSearch Query Response: {result.get('statusCode', 'Unknown')}")
        
        if result.get('statusCode') == 200:
            body = result.get('body', {})
            print(f"   📊 Search results: {body.get('total_results', 0)}")
        else:
            print(f"   ⚠️  Error: {result.get('body', {}).get('error', 'Unknown error')}")
        
    except Exception as e:
        print(f"   ❌ OpenSearch Query Error: {str(e)}")
    
    # Test 4: Test Gap Storage Function
    print("\n4. Testing Gap Storage Function...")
    
    try:
        test_gap = {
            "gap_id": "TEST-GAP-001",
            "title": "Test Compliance Gap",
            "description": "This is a test gap for validation",
            "regulatory_reference": "Test Regulation 123",
            "policy_reference": "Test Policy v1.0",
            "gap_type": "missing_requirement",
            "severity": "medium",
            "risk_level": "medium",
            "impact_description": "Test impact",
            "recommended_action": "Test action",
            "status": "identified"
        }
        
        test_payload = {
            "operation": "store",
            "gaps": [test_gap]
        }
        
        response = lambda_client.invoke(
            FunctionName='CompliAgent-StoreGaps',
            InvocationType='RequestResponse',
            Payload=json.dumps(test_payload)
        )
        
        result = json.loads(response['Payload'].read())
        print(f"   ✅ Store Gaps Response: {result.get('statusCode', 'Unknown')}")
        
        if result.get('statusCode') == 200:
            body = result.get('body', {})
            print(f"   📊 Stored gaps: {body.get('result', {}).get('stored_successfully', 0)}")
        
    except Exception as e:
        print(f"   ❌ Store Gaps Error: {str(e)}")
    
    # Test 5: Test Gap Retrieval Function
    print("\n5. Testing Gap Retrieval Function...")
    
    try:
        test_payload = {
            "operation": "query",
            "query_type": "status",
            "query_value": "identified",
            "limit": 5
        }
        
        response = lambda_client.invoke(
            FunctionName='CompliAgent-RetrieveGap',
            InvocationType='RequestResponse',
            Payload=json.dumps(test_payload)
        )
        
        result = json.loads(response['Payload'].read())
        print(f"   ✅ Retrieve Gap Response: {result.get('statusCode', 'Unknown')}")
        
        if result.get('statusCode') == 200:
            body = result.get('body', {})
            print(f"   📊 Retrieved gaps: {body.get('total_results', 0)}")
        
    except Exception as e:
        print(f"   ❌ Retrieve Gap Error: {str(e)}")
    
    # Test 6: Test Gap Analysis Workflow (if we have test data)
    print("\n6. Testing Gap Analysis Workflow...")
    
    try:
        # This would require actual documents in OpenSearch
        print("   ℹ️  Gap Analysis Workflow requires documents in OpenSearch to test")
        print("   💡 Upload documents first, then test with:")
        print("      aws stepfunctions start-execution --state-machine-arn <arn> --input '{\"query_text\":\"test\"}'")
        
    except Exception as e:
        print(f"   ❌ Gap Analysis Workflow Error: {str(e)}")
    
    print("\n" + "=" * 60)
    print("🏁 Analysis Workflows Test Complete")
    print("\n💡 Next steps to test the full workflow:")
    print("   1. Ensure documents are indexed in OpenSearch")
    print("   2. Test Gap Analysis workflow with real regulatory documents")
    print("   3. Test Amendment Drafting workflow with identified gaps")
    print("   4. Verify end-to-end gap identification and amendment generation")

if __name__ == "__main__":
    test_analysis_workflows()
