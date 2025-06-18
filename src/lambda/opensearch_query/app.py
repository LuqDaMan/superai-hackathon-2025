import json
import boto3
import logging
from datetime import datetime
import os
from typing import Dict, List, Optional
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
bedrock_client = boto3.client('bedrock-runtime')

# Environment variables
OPENSEARCH_ENDPOINT = os.environ.get('OPENSEARCH_ENDPOINT')
OPENSEARCH_INDEX = os.environ.get('OPENSEARCH_INDEX', 'documents')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')

class OpenSearchQueryService:
    """Service for querying OpenSearch with vector similarity"""
    
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
        self.bedrock_client = bedrock_client
    
    def generate_query_embedding(self, query_text: str) -> List[float]:
        """Generate embedding for query text using Bedrock"""
        try:
            body = json.dumps({
                "inputText": query_text
            })
            
            response = self.bedrock_client.invoke_model(
                modelId="amazon.titan-embed-text-v1",
                body=body,
                contentType='application/json',
                accept='application/json'
            )
            
            response_body = json.loads(response['body'].read())
            embedding = response_body.get('embedding', [])
            
            if not embedding:
                raise ValueError("No embedding returned from Bedrock")
            
            return embedding
            
        except Exception as e:
            logger.error(f"Error generating query embedding: {str(e)}")
            raise
    
    def search_similar_documents(self, query_embedding: List[float], 
                               size: int = 10, 
                               min_score: float = 0.7) -> List[Dict]:
        """Search for similar documents using vector similarity"""
        try:
            # Construct the search query
            search_body = {
                "size": size,
                "min_score": min_score,
                "query": {
                    "knn": {
                        "embedding": {
                            "vector": query_embedding,
                            "k": size
                        }
                    }
                },
                "_source": {
                    "includes": [
                        "text",
                        "document_id",
                        "document_title",
                        "document_type",
                        "source_location",
                        "created_at",
                        "metadata"
                    ]
                }
            }
            
            # Execute search
            response = self.client.search(
                index=self.index_name,
                body=search_body
            )
            
            # Process results
            hits = response.get('hits', {}).get('hits', [])
            documents = []
            
            for hit in hits:
                doc = {
                    'score': hit['_score'],
                    'document_id': hit['_source'].get('document_id', ''),
                    'document_title': hit['_source'].get('document_title', ''),
                    'document_type': hit['_source'].get('document_type', ''),
                    'text': hit['_source'].get('text', ''),
                    'source_location': hit['_source'].get('source_location', ''),
                    'created_at': hit['_source'].get('created_at', ''),
                    'metadata': hit['_source'].get('metadata', {})
                }
                documents.append(doc)
            
            logger.info(f"Found {len(documents)} similar documents")
            return documents
            
        except Exception as e:
            logger.error(f"Error searching documents: {str(e)}")
            raise
    
    def search_by_text_query(self, query_text: str, 
                           size: int = 10,
                           document_type: Optional[str] = None) -> List[Dict]:
        """Search documents using text-based query"""
        try:
            # Construct text search query
            search_body = {
                "size": size,
                "query": {
                    "bool": {
                        "must": [
                            {
                                "multi_match": {
                                    "query": query_text,
                                    "fields": ["text", "document_title"],
                                    "type": "best_fields",
                                    "fuzziness": "AUTO"
                                }
                            }
                        ]
                    }
                },
                "_source": {
                    "includes": [
                        "text",
                        "document_id", 
                        "document_title",
                        "document_type",
                        "source_location",
                        "created_at",
                        "metadata"
                    ]
                }
            }
            
            # Add document type filter if specified
            if document_type:
                search_body["query"]["bool"]["filter"] = [
                    {"term": {"document_type": document_type}}
                ]
            
            # Execute search
            response = self.client.search(
                index=self.index_name,
                body=search_body
            )
            
            # Process results
            hits = response.get('hits', {}).get('hits', [])
            documents = []
            
            for hit in hits:
                doc = {
                    'score': hit['_score'],
                    'document_id': hit['_source'].get('document_id', ''),
                    'document_title': hit['_source'].get('document_title', ''),
                    'document_type': hit['_source'].get('document_type', ''),
                    'text': hit['_source'].get('text', ''),
                    'source_location': hit['_source'].get('source_location', ''),
                    'created_at': hit['_source'].get('created_at', ''),
                    'metadata': hit['_source'].get('metadata', {})
                }
                documents.append(doc)
            
            logger.info(f"Found {len(documents)} documents for text query")
            return documents
            
        except Exception as e:
            logger.error(f"Error in text search: {str(e)}")
            raise
    
    def hybrid_search(self, query_text: str, 
                     size: int = 10,
                     vector_weight: float = 0.7,
                     text_weight: float = 0.3) -> List[Dict]:
        """Perform hybrid search combining vector and text search"""
        try:
            # Generate embedding for vector search
            query_embedding = self.generate_query_embedding(query_text)
            
            # Perform vector search
            vector_results = self.search_similar_documents(
                query_embedding, 
                size=size,
                min_score=0.5
            )
            
            # Perform text search
            text_results = self.search_by_text_query(
                query_text,
                size=size
            )
            
            # Combine and rank results
            combined_results = self._combine_search_results(
                vector_results, 
                text_results,
                vector_weight,
                text_weight
            )
            
            return combined_results[:size]
            
        except Exception as e:
            logger.error(f"Error in hybrid search: {str(e)}")
            raise
    
    def _combine_search_results(self, vector_results: List[Dict], 
                              text_results: List[Dict],
                              vector_weight: float,
                              text_weight: float) -> List[Dict]:
        """Combine and rank results from vector and text search"""
        # Create a dictionary to store combined scores
        combined_scores = {}
        
        # Add vector search results
        for doc in vector_results:
            doc_id = doc['document_id']
            combined_scores[doc_id] = {
                'document': doc,
                'vector_score': doc['score'],
                'text_score': 0.0
            }
        
        # Add text search results
        for doc in text_results:
            doc_id = doc['document_id']
            if doc_id in combined_scores:
                combined_scores[doc_id]['text_score'] = doc['score']
            else:
                combined_scores[doc_id] = {
                    'document': doc,
                    'vector_score': 0.0,
                    'text_score': doc['score']
                }
        
        # Calculate combined scores and sort
        ranked_results = []
        for doc_id, scores in combined_scores.items():
            # Normalize scores (assuming max score is around 1.0 for vector, variable for text)
            normalized_vector = min(scores['vector_score'], 1.0)
            normalized_text = min(scores['text_score'] / 10.0, 1.0)  # Adjust based on typical text scores
            
            combined_score = (normalized_vector * vector_weight) + (normalized_text * text_weight)
            
            result_doc = scores['document'].copy()
            result_doc['combined_score'] = combined_score
            result_doc['vector_score'] = scores['vector_score']
            result_doc['text_score'] = scores['text_score']
            
            ranked_results.append(result_doc)
        
        # Sort by combined score
        ranked_results.sort(key=lambda x: x['combined_score'], reverse=True)
        
        return ranked_results

def lambda_handler(event, context):
    """Main Lambda handler for OpenSearch queries"""
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Initialize the search service
        search_service = OpenSearchQueryService()
        
        # Extract query parameters
        query_text = event.get('query_text', '')
        search_type = event.get('search_type', 'hybrid')  # vector, text, or hybrid
        size = event.get('size', 10)
        document_type = event.get('document_type')
        
        if not query_text:
            raise ValueError("query_text is required")
        
        # Perform search based on type
        if search_type == 'vector':
            query_embedding = search_service.generate_query_embedding(query_text)
            results = search_service.search_similar_documents(
                query_embedding, 
                size=size
            )
        elif search_type == 'text':
            results = search_service.search_by_text_query(
                query_text,
                size=size,
                document_type=document_type
            )
        else:  # hybrid
            results = search_service.hybrid_search(
                query_text,
                size=size
            )
        
        # Prepare response
        response = {
            'statusCode': 200,
            'body': {
                'query_text': query_text,
                'search_type': search_type,
                'total_results': len(results),
                'documents': results,
                'timestamp': datetime.utcnow().isoformat()
            }
        }
        
        logger.info(f"Query completed successfully: {len(results)} results found")
        return response
        
    except Exception as e:
        logger.error(f"Error in OpenSearch query: {str(e)}")
        return {
            'statusCode': 500,
            'body': {
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }
        }
