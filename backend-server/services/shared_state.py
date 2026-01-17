"""
Shared State Service

Manages shared state across all agents using Redis for persistence.
Enables cross-agent data sharing and conversation history.
"""

import json
from typing import Optional, Dict, Any, List
from datetime import datetime

import redis.asyncio as redis

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import Config


class SharedStateService:
    """Manages shared state accessible to all agents"""
    
    def __init__(self, config: Config):
        self.config = config
        self._client: Optional[redis.Redis] = None
        self._state_prefix = "agent_state:"
        self._conversation_prefix = "conversation:"
        self._context_prefix = "context:"
    
    async def connect(self) -> redis.Redis:
        """Get or create Redis client connection"""
        if self._client is None:
            kwargs = {
                "host": self.config.redis_host,
                "port": self.config.redis_port,
                "db": self.config.redis_db,
                "decode_responses": True,  # Use True for shared state
            }
            if self.config.redis_username:
                kwargs["username"] = self.config.redis_username
            if self.config.redis_password:
                kwargs["password"] = self.config.redis_password
            
            self._client = redis.Redis(**kwargs)
        return self._client
    
    async def set_state(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        """Set a state value"""
        client = await self.connect()
        full_key = f"{self._state_prefix}{key}"
        value_json = json.dumps(value)
        if ttl:
            await client.setex(full_key, ttl, value_json)
        else:
            await client.set(full_key, value_json)
    
    async def get_state(self, key: str, default: Any = None) -> Any:
        """Get a state value"""
        client = await self.connect()
        full_key = f"{self._state_prefix}{key}"
        value_json = await client.get(full_key)
        if value_json:
            return json.loads(value_json)
        return default
    
    async def delete_state(self, key: str) -> None:
        """Delete a state value"""
        client = await self.connect()
        full_key = f"{self._state_prefix}{key}"
        await client.delete(full_key)
    
    async def add_conversation(self, agent_name: str, role: str, message: str) -> None:
        """Add a conversation entry to shared history"""
        client = await self.connect()
        conversation_key = f"{self._conversation_prefix}{agent_name}"
        entry = {
            "role": role,
            "message": message,
            "timestamp": datetime.now().isoformat()
        }
        await client.lpush(conversation_key, json.dumps(entry))
        # Keep only last 100 conversations per agent
        await client.ltrim(conversation_key, 0, 99)
    
    async def get_conversation_history(self, agent_name: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Get conversation history for an agent"""
        client = await self.connect()
        conversation_key = f"{self._conversation_prefix}{agent_name}"
        entries = await client.lrange(conversation_key, 0, limit - 1)
        return [json.loads(entry) for entry in entries]
    
    async def set_context(self, context_key: str, context_data: Dict[str, Any]) -> None:
        """Set context data for agents"""
        client = await self.connect()
        full_key = f"{self._context_prefix}{context_key}"
        await client.set(full_key, json.dumps(context_data))
    
    async def get_context(self, context_key: str) -> Optional[Dict[str, Any]]:
        """Get context data"""
        client = await self.connect()
        full_key = f"{self._context_prefix}{context_key}"
        value_json = await client.get(full_key)
        if value_json:
            return json.loads(value_json)
        return None
    
    async def get_all_agent_states(self) -> Dict[str, Any]:
        """Get all agent states"""
        client = await self.connect()
        pattern = f"{self._state_prefix}*"
        keys = await client.keys(pattern)
        states = {}
        for key in keys:
            key_name = key.replace(self._state_prefix, "")
            value_json = await client.get(key)
            if value_json:
                states[key_name] = json.loads(value_json)
        return states
    
    async def close(self) -> None:
        """Close Redis connection"""
        if self._client:
            await self._client.aclose()
            self._client = None

