"""
MongoDB Service

Manages MongoDB connection and database operations.
"""

from typing import Optional, Dict, Any
from pymongo import MongoClient
from pymongo.database import Database
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
from pymongo.server_api import ServerApi
import certifi

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import Config


class MongoService:
    """Manages MongoDB connection and database operations"""
    
    def __init__(self, config: Config):
        self.config = config
        self._client: Optional[MongoClient] = None
        self._db: Optional[Database] = None
    
    def connect(self) -> Database:
        """Get or create MongoDB client connection and return database"""
        if self._client is None:
            if not self.config.mongodb_uri:
                raise ValueError("MONGODB_URI must be set in environment variables")
            
            # Use certifi for proper CA certificate handling (fixes SSL issues on macOS)
            # Try multiple connection methods to handle different MongoDB Atlas configurations
            connection_methods = [
                # Method 1: ServerApi with certifi (recommended for MongoDB Atlas)
                {
                    "server_api": ServerApi('1'),
                    "tlsCAFile": certifi.where(),
                    "serverSelectionTimeoutMS": 10000,
                },
                # Method 2: Just certifi without ServerApi
                {
                    "tlsCAFile": certifi.where(),
                    "serverSelectionTimeoutMS": 10000,
                },
                # Method 3: Basic connection (fallback)
                {
                    "serverSelectionTimeoutMS": 10000,
                },
            ]
            
            last_error = None
            for i, method_kwargs in enumerate(connection_methods, 1):
                try:
                    if i > 1:
                        print(f"⚠️  Trying connection method {i}...")
                    
                    self._client = MongoClient(
                        self.config.mongodb_uri,
                        **method_kwargs
                    )
                    
                    # Test connection
                    self._client.admin.command("ping")
                    print(f"✅ Connected to MongoDB: {self.config.mongo_db} (method {i})")
                    break
                    
                except (ConnectionFailure, ServerSelectionTimeoutError) as e:
                    last_error = e
                    if self._client:
                        try:
                            self._client.close()
                        except:
                            pass
                        self._client = None
                    continue
            
            if self._client is None:
                raise ConnectionFailure(
                    f"Failed to connect to MongoDB after trying {len(connection_methods)} methods. "
                    f"Last error: {last_error}"
                )
        
        if self._db is None:
            self._db = self._client[self.config.mongo_db]
        
        return self._db
    
    def get_database(self, db_name: Optional[str] = None) -> Database:
        """Get database instance. Uses configured database name if not specified."""
        if self._client is None:
            self.connect()
        
        if db_name:
            return self._client[db_name]
        return self._db or self.connect()
    
    def get_collection(self, collection_name: str, db_name: Optional[str] = None) -> Any:
        """Get a collection from the database"""
        db = self.get_database(db_name)
        return db[collection_name]
    
    def close(self) -> None:
        """Close MongoDB connection"""
        if self._client:
            self._client.close()
            self._client = None
            self._db = None
