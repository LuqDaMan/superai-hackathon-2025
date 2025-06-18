import json
import boto3
import logging
from datetime import datetime
import os
from typing import Dict, List, Optional
import uuid

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
textract_client = boto3.client('textract')
s3_client = boto3.client('s3')
sns_client = boto3.client('sns')

# Environment variables
PROCESSED_DOCS_BUCKET = os.environ.get('PROCESSED_DOCS_BUCKET')
SNS_TOPIC_ARN = os.environ.get('SNS_TOPIC_ARN')
TEXTRACT_ROLE_ARN = os.environ.get('TEXTRACT_ROLE_ARN')

class TextractProcessor:
    """Process documents using Amazon Textract"""
    
    def __init__(self):
        self.textract_client = textract_client
        self.s3_client = s3_client
        self.sns_client = sns_client
    
    def process_document(self, bucket: str, key: str) -> Dict:
        """Process document with Textract"""
        try:
            logger.info(f"Processing document: s3://{bucket}/{key}")
            
            # Check if document is PDF or image
            if key.lower().endswith('.pdf'):
                return self._process_pdf_document(bucket, key)
            elif key.lower().endswith(('.png', '.jpg', '.jpeg')):
                return self._process_image_document(bucket, key)
            else:
                logger.warning(f"Unsupported document type: {key}")
                return {'error': 'Unsupported document type'}
                
        except Exception as e:
            logger.error(f"Error processing document {key}: {str(e)}")
            raise
    
    def _process_pdf_document(self, bucket: str, key: str) -> Dict:
        """Process PDF document asynchronously"""
        try:
            # Generate job ID
            job_id = str(uuid.uuid4())
            
            # Start async document analysis
            response = self.textract_client.start_document_analysis(
                DocumentLocation={
                    'S3Object': {
                        'Bucket': bucket,
                        'Name': key
                    }
                },
                FeatureTypes=['TABLES', 'FORMS'],
                NotificationChannel={
                    'SNSTopicArn': SNS_TOPIC_ARN,
                    'RoleArn': TEXTRACT_ROLE_ARN
                },
                JobTag=json.dumps({
                    'source_bucket': bucket,
                    'source_key': key,
                    'job_id': job_id,
                    'started_at': datetime.utcnow().isoformat()
                })
            )
            
            textract_job_id = response['JobId']
            logger.info(f"Started Textract job {textract_job_id} for {key}")
            
            return {
                'job_id': textract_job_id,
                'status': 'IN_PROGRESS',
                'document_location': f"s3://{bucket}/{key}",
                'started_at': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error starting Textract job for {key}: {str(e)}")
            raise
    
    def _process_image_document(self, bucket: str, key: str) -> Dict:
        """Process image document synchronously"""
        try:
            # For images, use synchronous processing
            response = self.textract_client.analyze_document(
                Document={
                    'S3Object': {
                        'Bucket': bucket,
                        'Name': key
                    }
                },
                FeatureTypes=['TABLES', 'FORMS']
            )
            
            # Process the response immediately
            processed_data = self._extract_text_from_response(response)
            
            # Save processed data to S3
            output_key = self._save_processed_data(bucket, key, processed_data)
            
            return {
                'status': 'COMPLETED',
                'document_location': f"s3://{bucket}/{key}",
                'output_location': f"s3://{PROCESSED_DOCS_BUCKET}/{output_key}",
                'completed_at': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error processing image {key}: {str(e)}")
            raise
    
    def process_textract_completion(self, job_id: str) -> Dict:
        """Process completed Textract job"""
        try:
            logger.info(f"Processing completed Textract job: {job_id}")
            
            # Get job results
            response = self.textract_client.get_document_analysis(JobId=job_id)
            
            if response['JobStatus'] != 'SUCCEEDED':
                logger.error(f"Textract job {job_id} failed: {response.get('StatusMessage', 'Unknown error')}")
                return {'error': f"Textract job failed: {response.get('StatusMessage', 'Unknown error')}"}
            
            # Extract text and metadata
            processed_data = self._extract_text_from_response(response)
            
            # Get additional pages if they exist
            next_token = response.get('NextToken')
            while next_token:
                response = self.textract_client.get_document_analysis(
                    JobId=job_id,
                    NextToken=next_token
                )
                additional_data = self._extract_text_from_response(response)
                processed_data['text'] += '\n' + additional_data['text']
                processed_data['blocks'].extend(additional_data['blocks'])
                next_token = response.get('NextToken')
            
            # Save processed data
            output_key = self._save_processed_data_from_job(job_id, processed_data)
            
            return {
                'job_id': job_id,
                'status': 'COMPLETED',
                'output_location': f"s3://{PROCESSED_DOCS_BUCKET}/{output_key}",
                'completed_at': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error processing Textract completion for job {job_id}: {str(e)}")
            raise
    
    def _extract_text_from_response(self, response: Dict) -> Dict:
        """Extract text and structure from Textract response"""
        blocks = response.get('Blocks', [])
        
        # Extract text content
        text_blocks = []
        tables = []
        forms = []
        
        for block in blocks:
            if block['BlockType'] == 'LINE':
                text_blocks.append(block.get('Text', ''))
            elif block['BlockType'] == 'TABLE':
                tables.append(self._extract_table_data(block, blocks))
            elif block['BlockType'] == 'KEY_VALUE_SET':
                forms.append(self._extract_form_data(block, blocks))
        
        # Combine all text
        full_text = '\n'.join(text_blocks)
        
        return {
            'text': full_text,
            'blocks': blocks,
            'tables': tables,
            'forms': forms,
            'extracted_at': datetime.utcnow().isoformat()
        }
    
    def _extract_table_data(self, table_block: Dict, all_blocks: List[Dict]) -> Dict:
        """Extract table data from Textract blocks"""
        # Simplified table extraction - can be enhanced
        return {
            'id': table_block.get('Id'),
            'confidence': table_block.get('Confidence', 0),
            'geometry': table_block.get('Geometry', {})
        }
    
    def _extract_form_data(self, form_block: Dict, all_blocks: List[Dict]) -> Dict:
        """Extract form data from Textract blocks"""
        # Simplified form extraction - can be enhanced
        return {
            'id': form_block.get('Id'),
            'confidence': form_block.get('Confidence', 0),
            'geometry': form_block.get('Geometry', {})
        }
    
    def _save_processed_data(self, source_bucket: str, source_key: str, processed_data: Dict) -> str:
        """Save processed data to S3"""
        try:
            # Generate output key
            timestamp = datetime.utcnow().strftime('%Y/%m/%d')
            filename = source_key.split('/')[-1].split('.')[0]
            output_key = f"textract-output/{timestamp}/{filename}.json"
            
            # Add metadata
            processed_data['source_document'] = f"s3://{source_bucket}/{source_key}"
            processed_data['processing_completed_at'] = datetime.utcnow().isoformat()
            
            # Save to S3
            self.s3_client.put_object(
                Bucket=PROCESSED_DOCS_BUCKET,
                Key=output_key,
                Body=json.dumps(processed_data, indent=2),
                ContentType='application/json',
                Metadata={
                    'source_bucket': source_bucket,
                    'source_key': source_key,
                    'processed_at': datetime.utcnow().isoformat()
                }
            )
            
            logger.info(f"Saved processed data to s3://{PROCESSED_DOCS_BUCKET}/{output_key}")
            return output_key
            
        except Exception as e:
            logger.error(f"Error saving processed data: {str(e)}")
            raise
    
    def _save_processed_data_from_job(self, job_id: str, processed_data: Dict) -> str:
        """Save processed data from Textract job"""
        try:
            timestamp = datetime.utcnow().strftime('%Y/%m/%d')
            output_key = f"textract-output/{timestamp}/{job_id}.json"
            
            processed_data['textract_job_id'] = job_id
            processed_data['processing_completed_at'] = datetime.utcnow().isoformat()
            
            self.s3_client.put_object(
                Bucket=PROCESSED_DOCS_BUCKET,
                Key=output_key,
                Body=json.dumps(processed_data, indent=2),
                ContentType='application/json',
                Metadata={
                    'textract_job_id': job_id,
                    'processed_at': datetime.utcnow().isoformat()
                }
            )
            
            logger.info(f"Saved processed data to s3://{PROCESSED_DOCS_BUCKET}/{output_key}")
            return output_key
            
        except Exception as e:
            logger.error(f"Error saving processed data for job {job_id}: {str(e)}")
            raise

def lambda_handler(event, context):
    """Main Lambda handler"""
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        processor = TextractProcessor()
        
        # Handle S3 event (new document uploaded)
        if 'Records' in event:
            results = []
            for record in event['Records']:
                if record.get('eventSource') == 'aws:s3':
                    bucket = record['s3']['bucket']['name']
                    key = record['s3']['object']['key']
                    
                    result = processor.process_document(bucket, key)
                    results.append(result)
            
            return {
                'statusCode': 200,
                'body': {
                    'message': 'Documents processed',
                    'results': results,
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
        
        # Handle SNS notification (Textract job completion)
        elif 'Records' in event and event['Records'][0].get('EventSource') == 'aws:sns':
            sns_message = json.loads(event['Records'][0]['Sns']['Message'])
            
            if sns_message.get('API') == 'GetDocumentAnalysis':
                job_id = sns_message.get('JobId')
                if job_id:
                    result = processor.process_textract_completion(job_id)
                    
                    return {
                        'statusCode': 200,
                        'body': {
                            'message': 'Textract job processed',
                            'result': result,
                            'timestamp': datetime.utcnow().isoformat()
                        }
                    }
        
        # Handle direct invocation
        elif 'job_id' in event:
            result = processor.process_textract_completion(event['job_id'])
            return {
                'statusCode': 200,
                'body': result
            }
        
        else:
            logger.warning("Unrecognized event format")
            return {
                'statusCode': 400,
                'body': {
                    'error': 'Unrecognized event format',
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
            
    except Exception as e:
        logger.error(f"Error in Textract processor: {str(e)}")
        return {
            'statusCode': 500,
            'body': {
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }
        }
