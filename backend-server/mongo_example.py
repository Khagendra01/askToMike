"""
MongoDB Service Usage Example

This shows how to use the MongoService in your application.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from config import Config
from services.mongo_service import MongoService

async def example_usage():
    """Example of how to use MongoDB service"""
    # Load configuration from environment
    config = Config.from_env()
    
    # Create MongoDB service
    mongo_service = MongoService(config)
    
    try:
        # Connect to database
        db = mongo_service.connect()
        
        # Get a collection
        users_collection = mongo_service.get_collection("users")
        
        # Example: Insert a document
        result = users_collection.insert_one({
            "name": "John Doe",
            "email": "john@example.com",
            "created_at": "2024-01-01"
        })
        print(f"✅ Inserted document with ID: {result.inserted_id}")
        
        # Example: Find documents
        users = users_collection.find({"name": "John Doe"})
        for user in users:
            print(f"📄 Found user: {user}")
        
        # Example: Update a document
        users_collection.update_one(
            {"email": "john@example.com"},
            {"$set": {"name": "John Smith"}}
        )
        print("✅ Updated document")
        
        # Example: Get collection from specific database
        other_db = mongo_service.get_database("other_database")
        other_collection = other_db["other_collection"]
        
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        # Always close the connection when done
        mongo_service.close()

if __name__ == "__main__":
    import asyncio
    asyncio.run(example_usage())
