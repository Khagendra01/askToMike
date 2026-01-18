"""
Conversation Storage Service

Manages conversation persistence in MongoDB with Voyage embeddings for vector search.
Stores full conversations when sessions end and enables semantic retrieval.
"""

import os
from typing import Optional, Dict, Any, List
from datetime import datetime
import uuid

import voyageai
from pymongo import MongoClient
from pymongo.operations import SearchIndexModel
from pymongo.errors import ServerSelectionTimeoutError

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import Config
from services.mongo_service import MongoService


class ConversationStorageService:
    """Manages conversation storage in MongoDB with vector search"""
    
    def __init__(self, config: Config):
        self.config = config
        self.mongo_service = MongoService(config)
        self.vo_client: Optional[voyageai.Client] = None
        self.embedding_model = "voyage-3-large"
        self.collection_name = "conversations"
        self.index_name = "conversation_vector_index"
        self._embedding_dims: Optional[int] = None
    
    def _get_voyage_client(self) -> voyageai.Client:
        """Get or create Voyage AI client"""
        if self.vo_client is None:
            api_key = os.getenv("VOYAGE_API_KEY")
            if not api_key:
                raise ValueError("VOYAGE_API_KEY must be set in environment variables")
            self.vo_client = voyageai.Client(api_key=api_key)
        return self.vo_client
    
    async def _get_embedding_dimensions(self) -> int:
        """Get embedding dimensions from Voyage model"""
        if self._embedding_dims is None:
            vo = self._get_voyage_client()
            # Sample embedding to get dimensions
            sample_vec = vo.embed(
                texts=["dimension probe"],
                model=self.embedding_model
            ).embeddings[0]
            self._embedding_dims = len(sample_vec)
        return self._embedding_dims
    
    async def save_conversation(
        self,
        session_id: str,
        room_name: str,
        messages: List[Dict[str, Any]],
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Save a complete conversation to MongoDB with embeddings.
        
        Args:
            session_id: Unique session identifier (e.g., LiveKit job ID)
            room_name: Room name where conversation took place
            messages: List of conversation messages with 'role' and 'message' keys
            metadata: Optional metadata about the conversation
        
        Returns:
            MongoDB document _id as string
        """
        if not messages:
            raise ValueError("Cannot save empty conversation")
        
        # Extract key actions/tools used for better searchability
        actions_taken = []
        for msg in messages:
            message_text = msg.get('message', '').lower()
            # Detect tool calls and actions
            if 'linkedin' in message_text and ('post' in message_text or 'queue' in message_text):
                actions_taken.append("LinkedIn post created")
            if 'calendar' in message_text and ('created' in message_text or 'event' in message_text):
                actions_taken.append("Calendar event created")
            if 'slack' in message_text and ('message' in message_text or 'sent' in message_text):
                actions_taken.append("Slack message sent")
            if 'twitter' in message_text or 'x post' in message_text:
                actions_taken.append("Twitter/X post created")
            if '[tool:' in message_text or '[called tools:' in message_text:
                actions_taken.append(f"Tool used: {message_text[:100]}")
        
        # Remove duplicates while preserving order
        actions_taken = list(dict.fromkeys(actions_taken))
        
        # Combine all messages into a single searchable text
        conversation_text = "\n".join([
            f"{msg.get('role', 'unknown')}: {msg.get('message', '')}"
            for msg in messages
        ])
        
        # Add actions summary at the end for better embedding
        if actions_taken:
            actions_summary = "\n\nACTIONS TAKEN IN THIS CONVERSATION:\n" + "\n".join(f"- {a}" for a in actions_taken)
            conversation_text += actions_summary
            print(f"   📋 Actions detected: {actions_taken}")
        
        # Create embeddings for the full conversation (with retry for rate limits)
        vo = self._get_voyage_client()
        embedding = None
        max_retries = 3
        retry_delay = 20  # seconds - Voyage free tier is 3 RPM, so wait 20s between retries
        
        for attempt in range(max_retries):
            try:
                emb_result = vo.embed(
                    texts=[conversation_text],
                    model=self.embedding_model
                )
                embedding = emb_result.embeddings[0]
                break  # Success, exit retry loop
            except Exception as e:
                error_str = str(e).lower()
                is_rate_limit = "rate" in error_str or "limit" in error_str or "429" in error_str
                
                if is_rate_limit and attempt < max_retries - 1:
                    wait_time = retry_delay * (attempt + 1)  # Exponential backoff
                    print(f"⏳ Voyage API rate limited, waiting {wait_time}s before retry {attempt + 2}/{max_retries}...")
                    import time
                    time.sleep(wait_time)
                else:
                    raise RuntimeError(f"Failed to generate embedding: {e}") from e
        
        if embedding is None:
            raise RuntimeError("Failed to generate embedding after all retries")
        
        # Create document
        doc_id = str(uuid.uuid4())
        doc = {
            "_id": doc_id,
            "session_id": session_id,
            "room_name": room_name,
            "messages": messages,
            "conversation_text": conversation_text,
            "embedding": embedding,
            "message_count": len(messages),
            "saved_at": datetime.utcnow().isoformat(),
            "metadata": metadata or {}
        }
        
        # Insert into MongoDB
        try:
            coll = self.mongo_service.get_collection(self.collection_name)
            coll.insert_one(doc)
            print(f"   ✅ Document inserted into MongoDB")
            print(f"   📝 Embedding dimensions: {len(embedding)}")
            return doc_id
        except Exception as e:
            raise RuntimeError(f"Failed to save conversation to MongoDB: {e}") from e
    
    async def search_conversations(
        self,
        query: str,
        limit: int = 5,
        filter_dict: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Search previous conversations using vector similarity.
        
        Args:
            query: Search query text
            limit: Maximum number of results to return
            filter_dict: Optional MongoDB filter (e.g., {"room_name": "room123"})
        
        Returns:
            List of matching conversation documents with similarity scores
        """
        # Generate query embedding (with retry for rate limits)
        vo = self._get_voyage_client()
        query_emb = None
        max_retries = 3
        retry_delay = 20  # seconds
        
        for attempt in range(max_retries):
            try:
                query_emb = vo.embed(
                    texts=[query],
                    model=self.embedding_model
                ).embeddings[0]
                break  # Success
            except Exception as e:
                error_str = str(e).lower()
                is_rate_limit = "rate" in error_str or "limit" in error_str or "429" in error_str
                
                if is_rate_limit and attempt < max_retries - 1:
                    wait_time = retry_delay * (attempt + 1)
                    print(f"⏳ Voyage API rate limited, waiting {wait_time}s before retry {attempt + 2}/{max_retries}...")
                    import time
                    time.sleep(wait_time)
                else:
                    raise RuntimeError(f"Failed to generate query embedding: {e}") from e
        
        if query_emb is None:
            raise RuntimeError("Failed to generate query embedding after all retries")
        
        # Build aggregation pipeline for vector search
        pipeline = [
            {
                "$vectorSearch": {
                    "index": self.index_name,
                    "path": "embedding",
                    "queryVector": query_emb,
                    "numCandidates": min(100, limit * 10),  # Search more candidates
                    "limit": limit,
                    **({"filter": filter_dict} if filter_dict else {})
                }
            },
            {
                "$project": {
                    "_id": 1,
                    "session_id": 1,
                    "room_name": 1,
                    "messages": 1,
                    "message_count": 1,
                    "saved_at": 1,
                    "metadata": 1,
                    "score": {"$meta": "vectorSearchScore"}
                }
            }
        ]
        
        # Execute search
        try:
            coll = self.mongo_service.get_collection(self.collection_name)
            results = list(coll.aggregate(pipeline))
            return results
        except Exception as e:
            # If index doesn't exist yet, return empty list with warning
            if "index" in str(e).lower() or "vectorSearch" in str(e).lower():
                print(f"⚠️ Vector search index not found. Run create_index() first. Error: {e}")
                return []
            raise RuntimeError(f"Failed to search conversations: {e}") from e
    
    async def ensure_vector_index(self, wait_until_ready: bool = False, max_wait_seconds: int = 30) -> bool:
        """
        Ensure the Vector Search index exists. This is idempotent - safe to call multiple times.
        
        Args:
            wait_until_ready: Whether to wait until index is ready (default: False for non-blocking startup)
            max_wait_seconds: Maximum time to wait for index to be ready
        
        Returns:
            True if index exists or was created successfully
        """
        try:
            coll = self.mongo_service.get_collection(self.collection_name)
            
            # Ensure collection exists (MongoDB creates collections automatically on first insert,
            # but search indexes require the collection to exist)
            # Try to create collection if it doesn't exist
            try:
                db = self.mongo_service.get_database()
                # Try to get collection info - if it fails, collection doesn't exist
                try:
                    db.validate_collection(self.collection_name)
                except Exception:
                    # Collection doesn't exist, create it by inserting and deleting a dummy document
                    coll.insert_one({"_id": "temp_init", "temp": True})
                    coll.delete_one({"_id": "temp_init"})
            except Exception as e:
                # If validation or creation fails, try a simpler approach
                try:
                    # Just try to insert and delete to ensure collection exists
                    coll.insert_one({"_id": "temp_init_check", "temp": True})
                    coll.delete_one({"_id": "temp_init_check"})
                except Exception:
                    pass  # Collection may already exist or will be created on first real insert
            
            # Check if index already exists
            try:
                existing_indexes = list(coll.list_search_indexes(self.index_name))
                if existing_indexes:
                    idx = existing_indexes[0]
                    status = idx.get("status", "").upper()
                    if status == "READY":
                        print(f"✅ Vector search index '{self.index_name}' exists and is READY")
                        return True
                    elif status in ("BUILDING", "PENDING"):
                        print(f"⏳ Vector search index '{self.index_name}' exists but is {status}. Waiting...")
                        if wait_until_ready:
                            return await self._wait_for_index_ready(coll, max_wait_seconds)
                        return True  # Index exists, just not ready yet
                    elif status == "FAILED":
                        print(f"❌ Vector search index '{self.index_name}' is FAILED. Please check MongoDB Atlas.")
                        return False
            except Exception as e:
                # If list_search_indexes fails, might be M0 tier (not supported via driver)
                if "command not found" in str(e).lower() or "not supported" in str(e).lower():
                    print(f"⚠️  Warning: Cannot check index status via driver. Your MongoDB cluster might be M0 (free tier).")
                    print(f"   M0 clusters require creating the vector search index via MongoDB Atlas UI.")
                    print(f"   Please create the index manually: Atlas → Data Explorer → Collections → Search Indexes")
                    return False
                raise
            
            # Index doesn't exist, create it
            print(f"🔄 Creating vector search index '{self.index_name}'...")
            dims = await self._get_embedding_dimensions()
            
            vector_index = SearchIndexModel(
                name=self.index_name,
                type="vectorSearch",
                definition={
                    "fields": [
                        {
                            "type": "vector",
                            "path": "embedding",
                            "numDimensions": dims,
                            "similarity": "cosine"  # cosine, euclidean, or dotProduct
                        }
                    ]
                }
            )
            
            # Create index (async operation)
            try:
                coll.create_search_index(model=vector_index)
                print(f"✅ Vector search index creation started (async)")
                
                if wait_until_ready:
                    return await self._wait_for_index_ready(coll, max_wait_seconds)
                
                return True
            except Exception as e:
                error_str = str(e).lower()
                if "command not found" in error_str or "not supported" in error_str:
                    print(f"❌ Cannot create index via driver. Your MongoDB cluster is likely M0 (free tier).")
                    print(f"   M0 clusters require creating the vector search index via MongoDB Atlas UI.")
                    print(f"   Steps:")
                    print(f"   1. Go to MongoDB Atlas → Data Explorer")
                    print(f"   2. Select your database and 'conversations' collection")
                    print(f"   3. Click 'Search Indexes' tab → 'Create Search Index'")
                    print(f"   4. Use JSON editor with:")
                    print(f'      {{"name": "{self.index_name}", "type": "vectorSearch",')
                    print(f'       "definition": {{"fields": [{{"type": "vector", "path": "embedding",')
                    print(f'       "numDimensions": {dims}, "similarity": "cosine"}}]}}}}')
                    return False
                elif "does not exist" in error_str or "namespacenotfound" in error_str:
                    # Collection doesn't exist - create it first
                    print(f"⚠️  Collection '{self.collection_name}' doesn't exist. Creating it...")
                    try:
                        # Force collection creation by inserting and deleting a document
                        coll.insert_one({"_id": "force_collection_creation", "temp": True})
                        coll.delete_one({"_id": "force_collection_creation"})
                        # Retry index creation
                        coll.create_search_index(model=vector_index)
                        print(f"✅ Collection created and vector search index creation started (async)")
                        if wait_until_ready:
                            return await self._wait_for_index_ready(coll, max_wait_seconds)
                        return True
                    except Exception as retry_error:
                        print(f"❌ Failed to create collection and index: {retry_error}")
                        return False
                raise
                
        except Exception as e:
            print(f"❌ Failed to ensure vector search index: {e}")
            return False
    
    async def _wait_for_index_ready(self, coll, max_wait_seconds: int) -> bool:
        """Wait for index to be ready"""
        import time
        wait_interval = 2
        elapsed = 0
        
        while elapsed < max_wait_seconds:
            try:
                indexes = list(coll.list_search_indexes(self.index_name))
                if indexes:
                    status = indexes[0].get("status", "").upper()
                    if status == "READY":
                        print(f"✅ Vector search index is READY")
                        return True
                    elif status == "FAILED":
                        print(f"❌ Vector search index creation FAILED")
                        return False
            except Exception:
                pass
            
            time.sleep(wait_interval)
            elapsed += wait_interval
            if elapsed % 10 == 0:
                print(f"⏳ Still waiting for index... ({elapsed}s elapsed)")
        
        print(f"⚠️ Index not ready after {max_wait_seconds}s (still building in background)")
        return False
    
    async def create_vector_index(self, wait_until_ready: bool = True, max_wait_seconds: int = 60) -> bool:
        """
        Create the Vector Search index on MongoDB (legacy method - use ensure_vector_index instead).
        This is kept for backward compatibility but delegates to ensure_vector_index.
        
        Args:
            wait_until_ready: Whether to wait until index is ready
            max_wait_seconds: Maximum time to wait for index to be ready
        
        Returns:
            True if index was created successfully
        """
        return await self.ensure_vector_index(wait_until_ready=wait_until_ready, max_wait_seconds=max_wait_seconds)
    
    async def get_conversation_by_session_id(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve a conversation by session_id"""
        try:
            coll = self.mongo_service.get_collection(self.collection_name)
            doc = coll.find_one({"session_id": session_id})
            return doc
        except Exception as e:
            raise RuntimeError(f"Failed to retrieve conversation: {e}") from e
    
    async def list_recent_conversations(self, limit: int = 10) -> List[Dict[str, Any]]:
        """List recent conversations sorted by saved_at"""
        try:
            coll = self.mongo_service.get_collection(self.collection_name)
            docs = list(
                coll.find()
                .sort("saved_at", -1)
                .limit(limit)
            )
            return docs
        except Exception as e:
            raise RuntimeError(f"Failed to list conversations: {e}") from e
