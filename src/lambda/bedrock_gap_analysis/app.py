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

class GapAnalysisService:
    """Service for analyzing compliance gaps using Bedrock Claude 3"""
    
    def __init__(self):
        self.bedrock_client = bedrock_client
        self.model_id = CLAUDE_MODEL_ID
    
    def analyze_compliance_gaps(self, regulatory_documents: List[Dict], 
                              internal_policies: List[Dict],
                              analysis_context: Optional[str] = None) -> List[Dict]:
        """Analyze gaps between regulatory documents and internal policies"""
        try:
            logger.info("Starting compliance gap analysis")
            
            # Construct the analysis prompt
            prompt = self._construct_gap_analysis_prompt(
                regulatory_documents,
                internal_policies,
                analysis_context
            )
            
            # Call Claude 3 for analysis
            response = self._call_claude(prompt)
            
            # Parse the response to extract gaps
            gaps = self._parse_gap_analysis_response(response)
            
            logger.info(f"Identified {len(gaps)} compliance gaps")
            return gaps
            
        except Exception as e:
            logger.error(f"Error in gap analysis: {str(e)}")
            raise
    
    def _construct_gap_analysis_prompt(self, regulatory_documents: List[Dict],
                                     internal_policies: List[Dict],
                                     analysis_context: Optional[str] = None) -> str:
        """Construct the prompt for gap analysis"""
        
        prompt = """You are a compliance expert analyzing regulatory documents against internal policies to identify gaps and compliance issues.

TASK: Compare the provided regulatory requirements with internal policies and identify specific gaps, inconsistencies, or missing requirements.

REGULATORY DOCUMENTS:
"""
        
        # Add regulatory documents
        for i, doc in enumerate(regulatory_documents[:5], 1):  # Limit to top 5 for context
            prompt += f"\n--- REGULATORY DOCUMENT {i} ---\n"
            prompt += f"Title: {doc.get('document_title', 'Unknown')}\n"
            prompt += f"Type: {doc.get('document_type', 'Unknown')}\n"
            prompt += f"Content: {doc.get('text', '')[:2000]}...\n"  # Limit content length
        
        prompt += "\nINTERNAL POLICIES:\n"
        
        # Add internal policies
        for i, doc in enumerate(internal_policies[:5], 1):  # Limit to top 5 for context
            prompt += f"\n--- INTERNAL POLICY {i} ---\n"
            prompt += f"Title: {doc.get('document_title', 'Unknown')}\n"
            prompt += f"Type: {doc.get('document_type', 'Unknown')}\n"
            prompt += f"Content: {doc.get('text', '')[:2000]}...\n"  # Limit content length
        
        if analysis_context:
            prompt += f"\nADDITIONAL CONTEXT:\n{analysis_context}\n"
        
        prompt += """
ANALYSIS INSTRUCTIONS:
1. Carefully compare regulatory requirements with internal policies
2. Identify specific gaps where internal policies don't address regulatory requirements
3. Note inconsistencies between regulations and current policies
4. Highlight missing controls or procedures
5. Assess the severity and risk level of each gap

OUTPUT FORMAT:
Provide your analysis as a JSON array of gap objects. Each gap should have:
- gap_id: Unique identifier for the gap
- title: Brief descriptive title of the gap
- description: Detailed description of the gap
- regulatory_reference: Reference to the specific regulatory requirement
- policy_reference: Reference to the relevant internal policy (if any)
- gap_type: One of ["missing_requirement", "inconsistency", "insufficient_control", "outdated_policy"]
- severity: One of ["critical", "high", "medium", "low"]
- risk_level: One of ["high", "medium", "low"]
- impact_description: Description of potential impact if not addressed
- recommended_action: High-level recommendation for addressing the gap

Example:
[
  {
    "gap_id": "GAP-001",
    "title": "Missing Data Retention Policy",
    "description": "Regulatory requirement for 7-year data retention not addressed in current policies",
    "regulatory_reference": "MAS Notice 123, Section 4.2",
    "policy_reference": "Data Management Policy v2.1",
    "gap_type": "missing_requirement",
    "severity": "high",
    "risk_level": "high",
    "impact_description": "Non-compliance with regulatory data retention requirements",
    "recommended_action": "Update Data Management Policy to include 7-year retention requirement"
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
                "temperature": 0.1,
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
    
    def _parse_gap_analysis_response(self, response: str) -> List[Dict]:
        """Parse Claude's response to extract gap information"""
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
            gaps = json.loads(json_str)
            
            # Validate and enhance gap data
            validated_gaps = []
            for gap in gaps:
                if isinstance(gap, dict):
                    # Ensure required fields exist
                    validated_gap = {
                        'gap_id': gap.get('gap_id', f"GAP-{str(uuid.uuid4())[:8]}"),
                        'title': gap.get('title', 'Unspecified Gap'),
                        'description': gap.get('description', ''),
                        'regulatory_reference': gap.get('regulatory_reference', ''),
                        'policy_reference': gap.get('policy_reference', ''),
                        'gap_type': gap.get('gap_type', 'missing_requirement'),
                        'severity': gap.get('severity', 'medium'),
                        'risk_level': gap.get('risk_level', 'medium'),
                        'impact_description': gap.get('impact_description', ''),
                        'recommended_action': gap.get('recommended_action', ''),
                        'identified_at': datetime.utcnow().isoformat(),
                        'status': 'identified'
                    }
                    validated_gaps.append(validated_gap)
            
            return validated_gaps
            
        except json.JSONDecodeError as e:
            logger.error(f"Error parsing JSON response: {str(e)}")
            logger.error(f"Response content: {response}")
            
            # Fallback: create a single gap indicating parsing error
            return [{
                'gap_id': f"GAP-PARSE-ERROR-{str(uuid.uuid4())[:8]}",
                'title': 'Gap Analysis Parsing Error',
                'description': f'Unable to parse gap analysis response: {str(e)}',
                'regulatory_reference': '',
                'policy_reference': '',
                'gap_type': 'analysis_error',
                'severity': 'medium',
                'risk_level': 'medium',
                'impact_description': 'Manual review required due to parsing error',
                'recommended_action': 'Review analysis manually and re-run if necessary',
                'identified_at': datetime.utcnow().isoformat(),
                'status': 'error'
            }]
        
        except Exception as e:
            logger.error(f"Error processing gap analysis response: {str(e)}")
            raise
    
    def analyze_specific_regulation(self, regulation_text: str,
                                  policy_documents: List[Dict],
                                  regulation_title: str = "") -> List[Dict]:
        """Analyze a specific regulation against policies"""
        try:
            # Create a focused prompt for specific regulation analysis
            prompt = f"""You are a compliance expert analyzing a specific regulation against internal policies.

REGULATION TO ANALYZE:
Title: {regulation_title}
Content: {regulation_text[:3000]}

INTERNAL POLICIES:
"""
            
            for i, doc in enumerate(policy_documents[:3], 1):
                prompt += f"\n--- POLICY {i} ---\n"
                prompt += f"Title: {doc.get('document_title', 'Unknown')}\n"
                prompt += f"Content: {doc.get('text', '')[:1500]}...\n"
            
            prompt += """
TASK: Identify specific requirements in the regulation that are not adequately addressed by the internal policies.

Focus on:
1. Specific regulatory requirements
2. Compliance obligations
3. Reporting requirements
4. Control requirements
5. Documentation requirements

Return your analysis as a JSON array following the same format as before.
"""
            
            response = self._call_claude(prompt)
            gaps = self._parse_gap_analysis_response(response)
            
            return gaps
            
        except Exception as e:
            logger.error(f"Error in specific regulation analysis: {str(e)}")
            raise

def lambda_handler(event, context):
    """Main Lambda handler for gap analysis"""
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Initialize the gap analysis service
        gap_service = GapAnalysisService()
        
        # Extract input data
        regulatory_documents = event.get('regulatory_documents', [])
        internal_policies = event.get('internal_policies', [])
        analysis_context = event.get('analysis_context')
        analysis_type = event.get('analysis_type', 'comprehensive')  # comprehensive or specific
        
        if not regulatory_documents:
            raise ValueError("regulatory_documents are required")
        
        if not internal_policies:
            logger.warning("No internal policies provided, analysis may be limited")
        
        # Perform gap analysis
        if analysis_type == 'specific' and len(regulatory_documents) == 1:
            # Analyze a specific regulation
            regulation = regulatory_documents[0]
            gaps = gap_service.analyze_specific_regulation(
                regulation.get('text', ''),
                internal_policies,
                regulation.get('document_title', '')
            )
        else:
            # Comprehensive analysis
            gaps = gap_service.analyze_compliance_gaps(
                regulatory_documents,
                internal_policies,
                analysis_context
            )
        
        # Prepare response
        response = {
            'statusCode': 200,
            'body': {
                'analysis_type': analysis_type,
                'total_gaps_identified': len(gaps),
                'gaps': gaps,
                'regulatory_documents_analyzed': len(regulatory_documents),
                'internal_policies_analyzed': len(internal_policies),
                'analysis_timestamp': datetime.utcnow().isoformat()
            }
        }
        
        logger.info(f"Gap analysis completed: {len(gaps)} gaps identified")
        return response
        
    except Exception as e:
        logger.error(f"Error in gap analysis Lambda: {str(e)}")
        return {
            'statusCode': 500,
            'body': {
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }
        }
