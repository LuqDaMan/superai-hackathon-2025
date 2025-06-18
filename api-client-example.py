#!/usr/bin/env python3
"""
Example API client for CompliAgent-SG
Demonstrates how to interact with the REST API
"""

import requests
import json
import boto3
from datetime import datetime

class CompliAgentAPIClient:
    """Client for interacting with CompliAgent-SG API"""
    
    def __init__(self, api_endpoint, jwt_token=None):
        self.api_endpoint = api_endpoint.rstrip('/')
        self.jwt_token = jwt_token
        self.session = requests.Session()
        
        if jwt_token:
            self.session.headers.update({
                'Authorization': f'Bearer {jwt_token}',
                'Content-Type': 'application/json'
            })
    
    def health_check(self):
        """Check API health status"""
        try:
            response = self.session.get(f'{self.api_endpoint}/health')
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Health check failed: {e}")
            return None
    
    def get_gaps(self, status=None, severity=None, regulation_id=None, limit=50):
        """Get compliance gaps with optional filtering"""
        try:
            params = {'limit': limit}
            if status:
                params['status'] = status
            if severity:
                params['severity'] = severity
            if regulation_id:
                params['regulationId'] = regulation_id
            
            response = self.session.get(f'{self.api_endpoint}/gaps', params=params)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Get gaps failed: {e}")
            return None
    
    def acknowledge_gap(self, gap_id, acknowledged_by, notes=""):
        """Acknowledge a specific gap"""
        try:
            data = {
                'acknowledgedBy': acknowledged_by,
                'notes': notes
            }
            
            response = self.session.post(
                f'{self.api_endpoint}/gaps/{gap_id}/acknowledge',
                json=data
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Acknowledge gap failed: {e}")
            return None
    
    def get_amendments(self, gap_id=None, status=None, limit=50):
        """Get policy amendments with optional filtering"""
        try:
            params = {'limit': limit}
            if gap_id:
                params['gapId'] = gap_id
            if status:
                params['status'] = status
            
            response = self.session.get(f'{self.api_endpoint}/amendments', params=params)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Get amendments failed: {e}")
            return None
    
    def approve_amendment(self, amendment_id, approved_by, approval_notes=""):
        """Approve a specific amendment"""
        try:
            data = {
                'approvedBy': approved_by,
                'approvalNotes': approval_notes
            }
            
            response = self.session.post(
                f'{self.api_endpoint}/amendments/{amendment_id}/approve',
                json=data
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Approve amendment failed: {e}")
            return None
    
    def start_gap_analysis(self, query_text, search_type="hybrid", size=10, analysis_context=""):
        """Start gap analysis workflow"""
        try:
            data = {
                'queryText': query_text,
                'searchType': search_type,
                'size': size,
                'analysisContext': analysis_context
            }
            
            response = self.session.post(f'{self.api_endpoint}/analysis/start', json=data)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Start gap analysis failed: {e}")
            return None
    
    def draft_amendments(self, gap_ids, organization_context=""):
        """Start amendment drafting workflow"""
        try:
            data = {
                'gapIds': gap_ids,
                'organizationContext': organization_context
            }
            
            response = self.session.post(f'{self.api_endpoint}/amendments/draft', json=data)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Draft amendments failed: {e}")
            return None

def get_cognito_token(user_pool_id, client_id, username, password):
    """Get JWT token from Cognito"""
    try:
        cognito_client = boto3.client('cognito-idp')
        
        response = cognito_client.admin_initiate_auth(
            UserPoolId=user_pool_id,
            ClientId=client_id,
            AuthFlow='ADMIN_NO_SRP_AUTH',
            AuthParameters={
                'USERNAME': username,
                'PASSWORD': password
            }
        )
        
        return response['AuthenticationResult']['AccessToken']
    except Exception as e:
        print(f"Authentication failed: {e}")
        return None

def demo_api_usage():
    """Demonstrate API usage"""
    
    # Configuration - Update these values
    API_ENDPOINT = "https://your-api-id.execute-api.region.amazonaws.com/prod"
    USER_POOL_ID = "your-user-pool-id"
    CLIENT_ID = "your-client-id"
    USERNAME = "test@example.com"
    PASSWORD = "TempPassword123!"
    
    print("🚀 CompliAgent-SG API Client Demo")
    print("=" * 50)
    
    # Test health endpoint (no auth required)
    print("\n1. Testing Health Endpoint...")
    client = CompliAgentAPIClient(API_ENDPOINT)
    health = client.health_check()
    if health:
        print(f"   ✅ API Status: {health.get('status', 'Unknown')}")
        print(f"   📊 Version: {health.get('version', 'Unknown')}")
    else:
        print("   ❌ Health check failed")
        return
    
    # Get authentication token
    print("\n2. Authenticating with Cognito...")
    jwt_token = get_cognito_token(USER_POOL_ID, CLIENT_ID, USERNAME, PASSWORD)
    if not jwt_token:
        print("   ❌ Authentication failed - using demo mode")
        print("   💡 Update the configuration values and create a test user")
        return
    
    print("   ✅ Authentication successful")
    
    # Create authenticated client
    auth_client = CompliAgentAPIClient(API_ENDPOINT, jwt_token)
    
    # Test getting gaps
    print("\n3. Getting Compliance Gaps...")
    gaps = auth_client.get_gaps(limit=5)
    if gaps:
        print(f"   📊 Found {gaps.get('total', 0)} gaps")
        for gap in gaps.get('gaps', [])[:3]:
            print(f"   🔍 {gap.get('gapId', 'Unknown')}: {gap.get('title', 'No title')}")
    
    # Test getting amendments
    print("\n4. Getting Policy Amendments...")
    amendments = auth_client.get_amendments(limit=5)
    if amendments:
        print(f"   📊 Found {amendments.get('total', 0)} amendments")
        for amendment in amendments.get('amendments', [])[:3]:
            print(f"   📝 {amendment.get('amendmentId', 'Unknown')}: {amendment.get('amendmentTitle', 'No title')}")
    
    # Test starting gap analysis
    print("\n5. Starting Gap Analysis...")
    analysis = auth_client.start_gap_analysis(
        query_text="data protection requirements",
        analysis_context="Focus on customer data handling"
    )
    if analysis:
        print(f"   ✅ Analysis started: {analysis.get('requestId', 'Unknown')}")
        print(f"   🔄 Execution ARN: {analysis.get('executionArn', 'Unknown')}")
    
    print("\n" + "=" * 50)
    print("🏁 API Demo Complete")

if __name__ == "__main__":
    demo_api_usage()
