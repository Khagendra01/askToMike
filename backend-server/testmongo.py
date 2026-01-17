"""
Test MongoDB Connection

Simple test script to verify MongoDB connection using the MongoService.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from config import Config
from services.mongo_service import MongoService

def test_connection():
    """Test MongoDB connection"""
    try:
        config = Config.from_env()
        mongo_service = MongoService(config)
        
        # Connect to database
        db = mongo_service.connect()
        
        # Test with a simple collection operation
        collections = db.list_collection_names()
        print(f"📁 Collections in database '{config.mongo_db}': {collections}")
        
        # Get database stats
        stats = db.command("dbStats")
        print(f"📊 Database size: {stats.get('dataSize', 0)} bytes")
        
        print("✅ MongoDB connection test successful!")
        
    except Exception as e:
        print(f"❌ MongoDB connection test failed: {repr(e)}")
        import traceback
        traceback.print_exc()
    finally:
        if 'mongo_service' in locals():
            mongo_service.close()

if __name__ == "__main__":
    test_connection()
