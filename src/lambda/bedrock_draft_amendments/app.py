import json
import boto3
import logging
from datetime import datetime
import os
import uuid
from typing import Dict, List, Optional

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
bedrock_client = boto3.client('bedrock-runtime')

# Environment variables
CLAUDE_MODEL_ID = os.environ.get('CLAUDE_MODEL_ID', 'anthropic.claude-3-sonnet-20240229-v1:0')

class AmendmentDraftingService:
    """Service for drafting policy amendments using Bedrock Claude 3"""
    
    def __init__(self):
        self.bedrock_client = bedrock_client
        self.model_id = CLAUDE_MODEL_ID
    
    def draft_amendments(self, gaps: List[Dict], 
                        existing_policies: List[Dict],
                        organization_context: Optional[str] = None) -> List[Dict]:
        """Draft amendments to address identified compliance gaps"""
        try:
            logger.info(f"Starting amendment drafting for {len(gaps)} gaps")
            
            amendments = []
            
            # Process gaps in batches to avoid token limits
            batch_size = 3
            for i in range(0, len(gaps), batch_size):
                gap_batch = gaps[i:i + batch_size]
                batch_amendments = self._draft_amendments_batch(
                    gap_batch,
                    existing_policies,
                    organization_context
                )
                amendments.extend(batch_amendments)
            
            logger.info(f"Drafted {len(amendments)} amendments")
            return amendments
            
        except Exception as e:
            logger.error(f"Error in amendment drafting: {str(e)}")
            raise
    
    def _draft_amendments_batch(self, gaps: List[Dict],
                              existing_policies: List[Dict],
                              organization_context: Optional[str] = None) -> List[Dict]:
        """Draft amendments for a batch of gaps"""
        try:
            # Construct the amendment drafting prompt
            prompt = self._construct_amendment_prompt(
                gaps,
                existing_policies,
                organization_context
            )
            
            # Call Claude 3 for amendment drafting
            response = self._call_claude(prompt)
            
            # Parse the response to extract amendments
            amendments = self._parse_amendment_response(response, gaps)
            
            return amendments
            
        except Exception as e:
            logger.error(f"Error drafting amendments batch: {str(e)}")
            raise
    
    def _construct_amendment_prompt(self, gaps: List[Dict],
                                  existing_policies: List[Dict],
                                  organization_context: Optional[str] = None) -> str:
        """Construct the prompt for amendment drafting"""
        
        prompt = """You are a policy expert tasked with drafting specific amendments to address identified compliance gaps.

TASK: For each compliance gap provided, draft specific, actionable amendments to existing policies or create new policy sections.

COMPLIANCE GAPS TO ADDRESS:
"""
        
        # Add gaps information
        for i, gap in enumerate(gaps, 1):
            prompt += f"\n--- GAP {i} ---\n"
            prompt += f"Gap ID: {gap.get('gap_id', '')}\n"
            prompt += f"Title: {gap.get('title', '')}\n"
            prompt += f"Description: {gap.get('description', '')}\n"
            prompt += f"Regulatory Reference: {gap.get('regulatory_reference', '')}\n"
            prompt += f"Policy Reference: {gap.get('policy_reference', '')}\n"
            prompt += f"Severity: {gap.get('severity', '')}\n"
            prompt += f"Recommended Action: {gap.get('recommended_action', '')}\n"
        
        prompt += "\nEXISTING POLICIES FOR REFERENCE:\n"
        
        # Add existing policies for context
        for i, policy in enumerate(existing_policies[:3], 1):  # Limit to top 3 for context
            prompt += f"\n--- EXISTING POLICY {i} ---\n"
            prompt += f"Title: {policy.get('document_title', 'Unknown')}\n"
            prompt += f"Type: {policy.get('document_type', 'Unknown')}\n"
            prompt += f"Content: {policy.get('text', '')[:1500]}...\n"
        
        if organization_context:
            prompt += f"\nORGANIZATION CONTEXT:\n{organization_context}\n"
        
        prompt += """
AMENDMENT DRAFTING INSTRUCTIONS:
1. For each gap, draft specific, actionable amendments
2. Use clear, professional policy language
3. Include specific requirements, procedures, and controls
4. Reference relevant regulatory requirements
5. Ensure amendments are practical and implementable
6. Consider existing organizational structure and processes
7. Include compliance monitoring and reporting requirements where appropriate

OUTPUT FORMAT:
Provide your amendments as a JSON array. Each amendment should have:
- amendment_id: Unique identifier for the amendment
- gap_id: ID of the gap this amendment addresses
- amendment_type: One of ["policy_update", "new_policy_section", "procedure_addition", "control_enhancement"]
- target_policy: Name/reference of the policy to be amended
- amendment_title: Brief title of the amendment
- amendment_text: Complete text of the proposed amendment
- rationale: Explanation of why this amendment addresses the gap
- implementation_notes: Practical notes for implementation
- compliance_monitoring: How compliance with this amendment will be monitored
- effective_date_recommendation: Recommended timeframe for implementation
- priority: One of ["immediate", "high", "medium", "low"]

Example:
[
  {
    "amendment_id": "AMD-001",
    "gap_id": "GAP-001",
    "amendment_type": "policy_update",
    "target_policy": "Data Management Policy",
    "amendment_title": "Data Retention Requirements",
    "amendment_text": "Section 4.2 Data Retention: All customer data must be retained for a minimum of seven (7) years from the date of account closure or last transaction, whichever is later. This includes transaction records, customer communications, and supporting documentation as required by MAS Notice 123.",
    "rationale": "Addresses regulatory requirement for 7-year data retention not currently specified in policy",
    "implementation_notes": "Coordinate with IT to ensure backup systems can support extended retention periods",
    "compliance_monitoring": "Annual audit of data retention practices and quarterly reporting to compliance committee",
    "effective_date_recommendation": "90 days from approval",
    "priority": "high"
  }
]

IMPORTANT: Return ONLY the JSON array, no additional text or formatting.
"""
        
        return prompt
    
    def _call_claude(self, prompt: str) -> str:
        """Call Claude 3 model via Bedrock"""
        try:
            # Prepare the request body for Claude 3
            body = json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 4000,
                "temperature": 0.2,  # Slightly higher for more creative policy language
                "messages": [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            })
            
            # Call Bedrock
            response = self.bedrock_client.invoke_model(
                modelId=self.model_id,
                body=body,
                contentType='application/json',
                accept='application/json'
            )
            
            # Parse response
            response_body = json.loads(response['body'].read())
            
            if 'content' in response_body and len(response_body['content']) > 0:
                return response_body['content'][0]['text']
            else:
                raise ValueError("No content in Claude response")
                
        except Exception as e:
            logger.error(f"Error calling Claude: {str(e)}")
            raise
    
    def _parse_amendment_response(self, response: str, gaps: List[Dict]) -> List[Dict]:
        """Parse Claude's response to extract amendment information"""
        try:
            # Clean the response to extract JSON
            response = response.strip()
            
            # Find JSON array in the response
            start_idx = response.find('[')
            end_idx = response.rfind(']') + 1
            
            if start_idx == -1 or end_idx == 0:
                logger.warning("No JSON array found in response, attempting to parse entire response")
                json_str = response
            else:
                json_str = response[start_idx:end_idx]
            
            # Parse JSON
            amendments = json.loads(json_str)
            
            # Validate and enhance amendment data
            validated_amendments = []
            for amendment in amendments:
                if isinstance(amendment, dict):
                    # Ensure required fields exist
                    validated_amendment = {
                        'amendment_id': amendment.get('amendment_id', f"AMD-{str(uuid.uuid4())[:8]}"),
                        'gap_id': amendment.get('gap_id', ''),
                        'amendment_type': amendment.get('amendment_type', 'policy_update'),
                        'target_policy': amendment.get('target_policy', 'Unspecified Policy'),
                        'amendment_title': amendment.get('amendment_title', 'Policy Amendment'),
                        'amendment_text': amendment.get('amendment_text', ''),
                        'rationale': amendment.get('rationale', ''),
                        'implementation_notes': amendment.get('implementation_notes', ''),
                        'compliance_monitoring': amendment.get('compliance_monitoring', ''),
                        'effective_date_recommendation': amendment.get('effective_date_recommendation', '90 days'),
                        'priority': amendment.get('priority', 'medium'),
                        'drafted_at': datetime.utcnow().isoformat(),
                        'status': 'draft',
                        'version': '1.0'
                    }
                    validated_amendments.append(validated_amendment)
            
            return validated_amendments
            
        except json.JSONDecodeError as e:
            logger.error(f"Error parsing JSON response: {str(e)}")
            logger.error(f"Response content: {response}")
            
            # Fallback: create amendments for each gap indicating parsing error
            fallback_amendments = []
            for gap in gaps:
                fallback_amendments.append({
                    'amendment_id': f"AMD-PARSE-ERROR-{str(uuid.uuid4())[:8]}",
                    'gap_id': gap.get('gap_id', ''),
                    'amendment_type': 'analysis_error',
                    'target_policy': 'Unknown',
                    'amendment_title': 'Amendment Drafting Error',
                    'amendment_text': f'Unable to parse amendment response: {str(e)}',
                    'rationale': 'Manual review required due to parsing error',
                    'implementation_notes': 'Review and re-draft manually',
                    'compliance_monitoring': 'Manual review required',
                    'effective_date_recommendation': 'TBD',
                    'priority': 'medium',
                    'drafted_at': datetime.utcnow().isoformat(),
                    'status': 'error',
                    'version': '1.0'
                })
            
            return fallback_amendments
        
        except Exception as e:
            logger.error(f"Error processing amendment response: {str(e)}")
            raise
    
    def draft_single_amendment(self, gap: Dict,
                             related_policies: List[Dict],
                             organization_context: Optional[str] = None) -> Dict:
        """Draft a single amendment for a specific gap"""
        try:
            amendments = self._draft_amendments_batch(
                [gap],
                related_policies,
                organization_context
            )
            
            return amendments[0] if amendments else None
            
        except Exception as e:
            logger.error(f"Error drafting single amendment: {str(e)}")
            raise

def lambda_handler(event, context):
    """Main Lambda handler for amendment drafting"""
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Initialize the amendment drafting service
        amendment_service = AmendmentDraftingService()
        
        # Extract input data
        gaps = event.get('gaps', [])
        existing_policies = event.get('existing_policies', [])
        organization_context = event.get('organization_context')
        drafting_mode = event.get('drafting_mode', 'batch')  # batch or single
        
        if not gaps:
            raise ValueError("gaps are required for amendment drafting")
        
        # Draft amendments
        if drafting_mode == 'single' and len(gaps) == 1:
            # Draft single amendment
            amendment = amendment_service.draft_single_amendment(
                gaps[0],
                existing_policies,
                organization_context
            )
            amendments = [amendment] if amendment else []
        else:
            # Draft amendments in batch
            amendments = amendment_service.draft_amendments(
                gaps,
                existing_policies,
                organization_context
            )
        
        # Prepare response
        response = {
            'statusCode': 200,
            'body': {
                'drafting_mode': drafting_mode,
                'total_amendments_drafted': len(amendments),
                'amendments': amendments,
                'gaps_processed': len(gaps),
                'policies_referenced': len(existing_policies),
                'drafting_timestamp': datetime.utcnow().isoformat()
            }
        }
        
        logger.info(f"Amendment drafting completed: {len(amendments)} amendments drafted")
        return response
        
    except Exception as e:
        logger.error(f"Error in amendment drafting Lambda: {str(e)}")
        return {
            'statusCode': 500,
            'body': {
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }
        }
