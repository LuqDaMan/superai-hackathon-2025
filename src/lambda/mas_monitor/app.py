import json
import boto3
import requests
from bs4 import BeautifulSoup
import logging
from datetime import datetime
import hashlib
import os
from urllib.parse import urljoin, urlparse
from typing import List, Dict, Optional

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# Environment variables
BUCKET_NAME = os.environ.get('MAS_DOCS_BUCKET')
TRACKING_TABLE = os.environ.get('TRACKING_TABLE', 'CompliAgent-DocumentTracking')

class MASDocumentScraper:
    """Scraper for MAS regulatory documents"""
    
    def __init__(self):
        self.base_url = "https://www.mas.gov.sg"
        self.regulations_url = f"{self.base_url}/regulation"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
    
    def scrape_documents(self) -> List[Dict]:
        """Scrape MAS website for regulatory documents"""
        try:
            logger.info(f"Starting scrape of {self.regulations_url}")
            response = self.session.get(self.regulations_url, timeout=30)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            documents = []
            
            # Look for document links (adjust selectors based on actual MAS website structure)
            document_links = soup.find_all('a', href=True)
            
            for link in document_links:
                href = link.get('href')
                if self._is_document_link(href):
                    doc_info = self._extract_document_info(link, href)
                    if doc_info:
                        documents.append(doc_info)
            
            logger.info(f"Found {len(documents)} potential documents")
            return documents
            
        except Exception as e:
            logger.error(f"Error scraping MAS website: {str(e)}")
            raise
    
    def _is_document_link(self, href: str) -> bool:
        """Check if link points to a document"""
        if not href:
            return False
        
        # Check for PDF links or regulation pages
        document_indicators = [
            '.pdf',
            '/regulation/',
            '/circular/',
            '/notice/',
            '/guideline/'
        ]
        
        return any(indicator in href.lower() for indicator in document_indicators)
    
    def _extract_document_info(self, link_element, href: str) -> Optional[Dict]:
        """Extract document information from link element"""
        try:
            # Make URL absolute
            full_url = urljoin(self.base_url, href)
            
            # Extract title
            title = link_element.get_text(strip=True)
            if not title:
                title = link_element.get('title', 'Unknown Document')
            
            # Generate document ID based on URL
            doc_id = hashlib.md5(full_url.encode()).hexdigest()
            
            # Extract document type from URL or title
            doc_type = self._determine_document_type(full_url, title)
            
            return {
                'document_id': doc_id,
                'title': title,
                'url': full_url,
                'type': doc_type,
                'discovered_at': datetime.utcnow().isoformat(),
                'status': 'discovered'
            }
            
        except Exception as e:
            logger.warning(f"Error extracting info from link {href}: {str(e)}")
            return None
    
    def _determine_document_type(self, url: str, title: str) -> str:
        """Determine document type from URL or title"""
        url_lower = url.lower()
        title_lower = title.lower()
        
        if 'circular' in url_lower or 'circular' in title_lower:
            return 'circular'
        elif 'notice' in url_lower or 'notice' in title_lower:
            return 'notice'
        elif 'guideline' in url_lower or 'guideline' in title_lower:
            return 'guideline'
        elif 'regulation' in url_lower or 'regulation' in title_lower:
            return 'regulation'
        else:
            return 'document'

class DocumentTracker:
    """Track processed documents to avoid duplicates"""
    
    def __init__(self, table_name: str):
        self.table = dynamodb.Table(table_name)
    
    def is_document_processed(self, doc_id: str) -> bool:
        """Check if document has already been processed"""
        try:
            response = self.table.get_item(Key={'document_id': doc_id})
            return 'Item' in response
        except Exception as e:
            logger.warning(f"Error checking document status: {str(e)}")
            return False
    
    def mark_document_processed(self, doc_info: Dict):
        """Mark document as processed"""
        try:
            self.table.put_item(Item={
                'document_id': doc_info['document_id'],
                'title': doc_info['title'],
                'url': doc_info['url'],
                'type': doc_info['type'],
                'processed_at': datetime.utcnow().isoformat(),
                'status': 'downloaded'
            })
        except Exception as e:
            logger.error(f"Error marking document as processed: {str(e)}")

class DocumentDownloader:
    """Download documents to S3"""
    
    def __init__(self, bucket_name: str):
        self.bucket_name = bucket_name
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
    
    def download_document(self, doc_info: Dict) -> bool:
        """Download document to S3"""
        try:
            logger.info(f"Downloading document: {doc_info['title']}")
            
            # Download the document
            response = self.session.get(doc_info['url'], timeout=60)
            response.raise_for_status()
            
            # Determine file extension
            content_type = response.headers.get('content-type', '').lower()
            if 'pdf' in content_type:
                extension = '.pdf'
            elif 'html' in content_type:
                extension = '.html'
            else:
                # Try to get extension from URL
                parsed_url = urlparse(doc_info['url'])
                if parsed_url.path.endswith('.pdf'):
                    extension = '.pdf'
                else:
                    extension = '.html'
            
            # Create S3 key
            timestamp = datetime.utcnow().strftime('%Y/%m/%d')
            s3_key = f"mas-documents/{timestamp}/{doc_info['document_id']}{extension}"
            
            # Upload to S3
            s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=response.content,
                ContentType=content_type,
                Metadata={
                    'title': doc_info['title'],
                    'source_url': doc_info['url'],
                    'document_type': doc_info['type'],
                    'downloaded_at': datetime.utcnow().isoformat()
                }
            )
            
            logger.info(f"Successfully uploaded document to s3://{self.bucket_name}/{s3_key}")
            return True
            
        except Exception as e:
            logger.error(f"Error downloading document {doc_info['title']}: {str(e)}")
            return False

def lambda_handler(event, context):
    """Main Lambda handler"""
    try:
        logger.info("Starting MAS document monitoring")
        
        # Validate environment variables
        if not BUCKET_NAME:
            raise ValueError("MAS_DOCS_BUCKET environment variable not set")
        
        # Initialize components
        scraper = MASDocumentScraper()
        tracker = DocumentTracker(TRACKING_TABLE)
        downloader = DocumentDownloader(BUCKET_NAME)
        
        # Scrape for documents
        documents = scraper.scrape_documents()
        
        # Process new documents
        new_documents = 0
        failed_downloads = 0
        
        for doc_info in documents:
            if not tracker.is_document_processed(doc_info['document_id']):
                if downloader.download_document(doc_info):
                    tracker.mark_document_processed(doc_info)
                    new_documents += 1
                else:
                    failed_downloads += 1
        
        # Prepare response
        result = {
            'statusCode': 200,
            'body': {
                'message': 'MAS document monitoring completed',
                'total_documents_found': len(documents),
                'new_documents_downloaded': new_documents,
                'failed_downloads': failed_downloads,
                'timestamp': datetime.utcnow().isoformat()
            }
        }
        
        logger.info(f"Monitoring completed: {json.dumps(result['body'])}")
        return result
        
    except Exception as e:
        logger.error(f"Error in MAS document monitoring: {str(e)}")
        return {
            'statusCode': 500,
            'body': {
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }
        }
