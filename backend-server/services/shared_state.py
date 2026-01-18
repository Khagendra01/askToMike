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
            "timestamp": datetime.now().isoformat(),
            "agent_name": agent_name  # Store agent_name in the entry for later retrieval
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
    
    async def get_full_conversation(self, session_key: str) -> List[Dict[str, Any]]:
        """
        Get full conversation for a session.
        Aggregates all messages across all agents for a session.
        
        Args:
            session_key: Session identifier (e.g., room name or job ID)
        
        Returns:
            List of conversation messages sorted by timestamp
        """
        client = await self.connect()
        
        # Get all conversation keys that match session pattern
        # We'll use a pattern like "conversation:{session_key}:*" or get all conversations
        pattern = f"{self._conversation_prefix}*"
        all_keys = await client.keys(pattern)
        
        all_messages = []
        for key in all_keys:
            entries = await client.lrange(key, 0, -1)  # Get all entries
            for entry in entries:
                try:
                    msg = json.loads(entry)
                    all_messages.append(msg)
                except json.JSONDecodeError:
                    continue
        
        # Sort by timestamp
        all_messages.sort(key=lambda x: x.get("timestamp", ""))
        return all_messages
    
    async def get_conversation_by_session(self, session_id: str) -> List[Dict[str, Any]]:
        """
        Get all conversation messages for a specific session.
        This retrieves messages stored with session_id in the conversation key.
        """
        client = await self.connect()
        
        # For now, we'll use a session-specific key pattern
        # In practice, we might store with session_id prefix
        conversation_key = f"{self._conversation_prefix}session:{session_id}"
        entries = await client.lrange(conversation_key, 0, -1)
        
        messages = []
        for entry in entries:
            try:
                messages.append(json.loads(entry))
            except json.JSONDecodeError:
                continue
        
        # Also check default conversation keys (for backward compatibility)
        # Collect from all agent conversation keys
        agent_pattern = f"{self._conversation_prefix}*"
        agent_keys = [k for k in await client.keys(agent_pattern) if not k.startswith(f"{self._conversation_prefix}session:")]
        
        for key in agent_keys:
            entries = await client.lrange(key, 0, -1)
            for entry in entries:
                try:
                    msg = json.loads(entry)
                    messages.append(msg)
                except json.JSONDecodeError:
                    continue
        
        # Sort by timestamp
        messages.sort(key=lambda x: x.get("timestamp", ""))
        return messages
    
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
    
    # ============================================================
    # LinkedIn Post Cooldown & Deduplication
    # ============================================================
    
    async def check_linkedin_cooldown(self, cooldown_seconds: int = 30) -> tuple[bool, float]:
        """
        Check if LinkedIn posting is in cooldown period.
        
        Args:
            cooldown_seconds: Cooldown duration in seconds (default: 30)
        
        Returns:
            Tuple of (is_allowed, remaining_seconds)
            - is_allowed: True if posting is allowed, False if in cooldown
            - remaining_seconds: Seconds remaining in cooldown (0 if allowed)
        """
        client = await self.connect()
        cooldown_key = "linkedin_post_cooldown"
        
        last_post_time = await client.get(cooldown_key)
        if last_post_time:
            import time
            elapsed = time.time() - float(last_post_time)
            if elapsed < cooldown_seconds:
                remaining = cooldown_seconds - elapsed
                return False, remaining
        
        return True, 0.0
    
    async def set_linkedin_cooldown(self) -> None:
        """Mark that a LinkedIn post was just made, starting the cooldown."""
        import time
        client = await self.connect()
        cooldown_key = "linkedin_post_cooldown"
        await client.set(cooldown_key, str(time.time()))
        # Auto-expire after 60 seconds (cleanup)
        await client.expire(cooldown_key, 60)
    
    async def check_linkedin_duplicate(self, post_content: str, window_seconds: int = 60) -> bool:
        """
        Check if this post content was recently submitted (deduplication).
        
        Args:
            post_content: The post text to check
            window_seconds: Time window to check for duplicates (default: 60s)
        
        Returns:
            True if this is a duplicate (should be rejected), False if it's new
        """
        import hashlib
        client = await self.connect()
        
        # Create a hash of the post content (normalized)
        content_hash = hashlib.md5(post_content.strip().lower().encode()).hexdigest()
        dedup_key = f"linkedin_post_dedup:{content_hash}"
        
        # Check if this hash exists
        exists = await client.exists(dedup_key)
        if exists:
            return True  # Duplicate
        
        # Mark this content as recently posted
        await client.setex(dedup_key, window_seconds, "1")
        return False  # Not a duplicate
    
    async def close(self) -> None:
        """Close Redis connection"""
        if self._client:
            await self._client.aclose()
            self._client = None

