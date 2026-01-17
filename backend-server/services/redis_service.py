"""
Redis Service

Manages Redis connection and queue operations.
"""

import json
from typing import Optional, Dict, Any

import redis.asyncio as redis

import sys
from pathlib import Path
# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import Config


class RedisService:
    """Manages Redis connection and queue operations"""
    
    def __init__(self, config: Config):
        self.config = config
        self._client: Optional[redis.Redis] = None
    
    async def connect(self) -> redis.Redis:
        """Get or create Redis client connection"""
        if self._client is None:
            kwargs = {
                "host": self.config.redis_host,
                "port": self.config.redis_port,
                "db": self.config.redis_db,
                "decode_responses": False,
            }
            if self.config.redis_username:
                kwargs["username"] = self.config.redis_username
            if self.config.redis_password:
                kwargs["password"] = self.config.redis_password
            
            self._client = redis.Redis(**kwargs)
        return self._client
    
    async def push_task(self, task_data: Dict[str, Any]) -> None:
        """Push a task to the Redis queue"""
        client = await self.connect()
        task_json = json.dumps(task_data)
        await client.lpush(self.config.redis_queue_name, task_json.encode('utf-8'))
        print(f"✅ Pushed task to Redis queue: {task_data.get('type', 'unknown')}")
    
    async def close(self) -> None:
        """Close Redis connection"""
        if self._client:
            await self._client.aclose()
            self._client = None

