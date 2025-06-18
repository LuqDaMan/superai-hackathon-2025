import json
import boto3
import logging
from datetime import datetime
import os
from typing import Dict, List, Optional
import hashlib
import re
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
bedrock_client = boto3.client('bedrock-runtime')
s3_client = boto3.client('s3')

# Environment variables
OPENSEARCH_ENDPOINT = os.environ.get('OPENSEARCH_ENDPOINT')
OPENSEARCH_INDEX = os.environ.get('OPENSEARCH_INDEX', 'documents')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')

class TextChunker:
    """Split text into chunks for vectorization"""
    
    def __init__(self, chunk_size: int = 1000, overlap: int = 200):
        self.chunk_size = chunk_size
        self.overlap = overlap
    
    def chunk_text(self, text: str, metadata: Dict = None) -> List[Dict]:
        """Split text into overlapping chunks"""
        if not text or not text.strip():
            return []
        
        # Clean and normalize text
        text = self._clean_text(text)
        
        # Split into sentences for better chunking
        sentences = self._split_into_sentences(text)
        
        chunks = []
        current_chunk = ""
        current_length = 0
        
        for sentence in sentences:
            sentence_length = len(sentence)
            
            # If adding this sentence would exceed chunk size, save current chunk
            if current_length + sentence_length > self.chunk_size and current_chunk:
                chunk_data = {
                    'text': current_chunk.strip(),
                    'chunk_id': self._generate_chunk_id(current_chunk),
                    'length': current_length,
                    'metadata': metadata or {}
                }
                chunks.append(chunk_data)
                
                # Start new chunk with overlap
                overlap_text = self._get_overlap_text(current_chunk)
                current_chunk = overlap_text + " " + sentence
                current_length = len(current_chunk)
            else:
                current_chunk += " " + sentence if current_chunk else sentence
                current_length += sentence_length
        
        # Add the last chunk
        if current_chunk.strip():
            chunk_data = {
                'text': current_chunk.strip(),
                'chunk_id': self._generate_chunk_id(current_chunk),
                'length': current_length,
                'metadata': metadata or {}
            }
            chunks.append(chunk_data)
        
        logger.info(f"Split text into {len(chunks)} chunks")
        return chunks
    
    def _clean_text(self, text: str) -> str:
        """Clean and normalize text"""
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text)
        # Remove special characters but keep punctuation
        text = re.sub(r'[^\w\s\.\,\!\?\;\:\-\(\)]', ' ', text)
        return text.strip()
    
    def _split_into_sentences(self, text: str) -> List[str]:
        """Split text into sentences"""
        # Simple sentence splitting - can be enhanced with NLTK
        sentences = re.split(r'[.!?]+', text)
        return [s.strip() for s in sentences if s.strip()]
    
    def _get_overlap_text(self, text: str) -> str:
        """Get overlap text from the end of current chunk"""
        words = text.split()
        overlap_words = words[-self.overlap//10:] if len(words) > self.overlap//10 else words
        return " ".join(overlap_words)
    
    def _generate_chunk_id(self, text: str) -> str:
        """Generate unique ID for chunk"""
        return hashlib.md5(text.encode()).hexdigest()[:16]

class BedrockEmbeddings:
    """Generate embeddings using Amazon Bedrock"""
    
    def __init__(self):
        self.client = bedrock_client
        self.model_id = "amazon.titan-embed-text-v1"
    
    def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for text"""
        try:
            # Prepare the request
            body = json.dumps({
                "inputText": text
            })
            
            # Call Bedrock
            response = self.client.invoke_model(
                modelId=self.model_id,
                body=body,
                contentType='application/json',
                accept='application/json'
            )
            
            # Parse response
            response_body = json.loads(response['body'].read())
            embedding = response_body.get('embedding', [])
            
            if not embedding:
                raise ValueError("No embedding returned from Bedrock")
            
            return embedding
            
        except Exception as e:
            logger.error(f"Error generating embedding: {str(e)}")
            raise
    
    def generate_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for multiple texts"""
        embeddings = []
        for text in texts:
            embedding = self.generate_embedding(text)
            embeddings.append(embedding)
        return embeddings

class OpenSearchVectorStore:
    """Store and search vectors in OpenSearch Serverless"""
    
    def __init__(self):
        # Set up authentication for OpenSearch Serverless
        credentials = boto3.Session().get_credentials()
        awsauth = AWS4Auth(
            credentials.access_key,
            credentials.secret_key,
            AWS_REGION,
            'aoss',
            session_token=credentials.token
        )
        
        # Initialize OpenSearch client
        self.client = OpenSearch(
            hosts=[{'host': OPENSEARCH_ENDPOINT.replace('https://', ''), 'port': 443}],
            http_auth=awsauth,
            use_ssl=True,
            verify_certs=True,
            connection_class=RequestsHttpConnection,
            timeout=60
        )
        
        self.index_name = OPENSEARCH_INDEX
        self._ensure_index_exists()
    
    def _ensure_index_exists(self):
        """Create index if it doesn't exist"""
        try:
            if not self.client.indices.exists(index=self.index_name):
                # Define index mapping for vector search
                mapping = {
                    "mappings": {
                        "properties": {
                            "text": {"type": "text"},
                            "embedding": {
                                "type": "knn_vector",
                                "dimension": 1536,  # Titan embeddings dimension
                                "method": {
                                    "name": "hnsw",
                                    "space_type": "cosinesimil",
                                    "engine": "nmslib"
                                }
                            },
                            "chunk_id": {"type": "keyword"},
                            "document_id": {"type": "keyword"},
                            "document_title": {"type": "text"},
                            "document_type": {"type": "keyword"},
                            "source_location": {"type": "keyword"},
                            "created_at": {"type": "date"},
                            "metadata": {"type": "object"}
                        }
                    },
                    "settings": {
                        "index": {
                            "knn": True,
                            "knn.algo_param.ef_search": 100
                        }
                    }
                }
                
                self.client.indices.create(index=self.index_name, body=mapping)
                logger.info(f"Created OpenSearch index: {self.index_name}")
        
        except Exception as e:
            logger.error(f"Error ensuring index exists: {str(e)}")
            raise
    
    def store_vectors(self, chunks: List[Dict], embeddings: List[List[float]], document_metadata: Dict):
        """Store text chunks and their embeddings"""
        try:
            documents = []
            
            for chunk, embedding in zip(chunks, embeddings):
                doc = {
                    "text": chunk['text'],
                    "embedding": embedding,
                    "chunk_id": chunk['chunk_id'],
                    "document_id": document_metadata.get('document_id', ''),
                    "document_title": document_metadata.get('title', ''),
                    "document_type": document_metadata.get('type', ''),
                    "source_location": document_metadata.get('source_location', ''),
                    "created_at": datetime.utcnow().isoformat(),
                    "metadata": {
                        **chunk.get('metadata', {}),
                        **document_metadata
                    }
                }
                documents.append(doc)
            
            # Bulk index documents
            bulk_body = []
            for doc in documents:
                bulk_body.append({"index": {"_index": self.index_name, "_id": doc['chunk_id']}})
                bulk_body.append(doc)
            
            response = self.client.bulk(body=bulk_body)
            
            # Check for errors
            if response.get('errors'):
                logger.warning("Some documents failed to index")
                for item in response['items']:
                    if 'error' in item.get('index', {}):
                        logger.error(f"Indexing error: {item['index']['error']}")
            
            logger.info(f"Stored {len(documents)} document chunks in OpenSearch")
            return len(documents)
            
        except Exception as e:
            logger.error(f"Error storing vectors: {str(e)}")
            raise

class DocumentVectorizer:
    """Main class for document vectorization"""
    
    def __init__(self):
        self.chunker = TextChunker()
        self.embeddings = BedrockEmbeddings()
        self.vector_store = OpenSearchVectorStore()
    
    def vectorize_document(self, processed_doc_data: Dict) -> Dict:
        """Vectorize a processed document"""
        try:
            logger.info("Starting document vectorization")
            
            # Extract text and metadata
            text = processed_doc_data.get('text', '')
            if not text:
                raise ValueError("No text found in processed document")
            
            # Generate document metadata
            document_metadata = {
                'document_id': self._generate_document_id(processed_doc_data),
                'title': processed_doc_data.get('source_document', '').split('/')[-1],
                'type': 'regulatory_document',
                'source_location': processed_doc_data.get('source_document', ''),
                'processed_at': processed_doc_data.get('processing_completed_at', ''),
                'textract_job_id': processed_doc_data.get('textract_job_id', '')
            }
            
            # Chunk the text
            chunks = self.chunker.chunk_text(text, document_metadata)
            if not chunks:
                raise ValueError("No chunks generated from document text")
            
            # Generate embeddings
            texts = [chunk['text'] for chunk in chunks]
            embeddings = self.embeddings.generate_embeddings_batch(texts)
            
            # Store in vector database
            stored_count = self.vector_store.store_vectors(chunks, embeddings, document_metadata)
            
            result = {
                'document_id': document_metadata['document_id'],
                'chunks_created': len(chunks),
                'vectors_stored': stored_count,
                'vectorization_completed_at': datetime.utcnow().isoformat(),
                'status': 'completed'
            }
            
            logger.info(f"Vectorization completed: {json.dumps(result)}")
            return result
            
        except Exception as e:
            logger.error(f"Error vectorizing document: {str(e)}")
            raise
    
    def _generate_document_id(self, processed_doc_data: Dict) -> str:
        """Generate unique document ID"""
        source = processed_doc_data.get('source_document', '')
        job_id = processed_doc_data.get('textract_job_id', '')
        
        if job_id:
            return f"doc_{job_id}"
        else:
            return f"doc_{hashlib.md5(source.encode()).hexdigest()[:16]}"

def lambda_handler(event, context):
    """Main Lambda handler"""
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        vectorizer = DocumentVectorizer()
        
        # Handle S3 event (processed document uploaded)
        if 'Records' in event:
            results = []
            
            for record in event['Records']:
                if record.get('eventSource') == 'aws:s3':
                    bucket = record['s3']['bucket']['name']
                    key = record['s3']['object']['key']
                    
                    # Download processed document data
                    response = s3_client.get_object(Bucket=bucket, Key=key)
                    processed_doc_data = json.loads(response['Body'].read())
                    
                    # Vectorize the document
                    result = vectorizer.vectorize_document(processed_doc_data)
                    results.append(result)
            
            return {
                'statusCode': 200,
                'body': {
                    'message': 'Documents vectorized',
                    'results': results,
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
        
        # Handle direct invocation with document data
        elif 'processed_document' in event:
            result = vectorizer.vectorize_document(event['processed_document'])
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
        logger.error(f"Error in vectorization: {str(e)}")
        return {
            'statusCode': 500,
            'body': {
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }
        }
