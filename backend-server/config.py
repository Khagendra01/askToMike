"""
Configuration Management

Centralized configuration loading from environment variables.
"""

import os
from dataclasses import dataclass
from typing import Optional, Dict, Any
from dotenv import load_dotenv

load_dotenv()


@dataclass
class Config:
    """Centralized configuration management"""
    # LiveKit
    livekit_api_key: str
    livekit_api_secret: str
    livekit_url: str
    
    # Redis
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0
    redis_username: Optional[str] = None
    redis_password: Optional[str] = None
    redis_queue_name: str = "linkedin_tasks"
    
    # User Data
    user_name: str = "User"
    linkedin_context_id: str = ""
    
    # ElevenLabs
    elevenlabs_api_key: Optional[str] = None
    
    # TTS
    tts_provider: str = "elevenlabs"
    
    # Image Generation
    google_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    
    # MongoDB
    mongodb_uri: Optional[str] = None
    mongo_db: str = "nexhack"
    
    @classmethod
    def from_env(cls) -> "Config":
        """Load configuration from environment variables"""
        api_key = os.getenv("LIVEKIT_API_KEY")
        api_secret = os.getenv("LIVEKIT_API_SECRET")
        livekit_url = os.getenv("LIVEKIT_URL", "wss://del-hecqeidt.livekit.cloud")
        
        if not api_key or not api_secret:
            raise ValueError("LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set")
        
        return cls(
            livekit_api_key=api_key,
            livekit_api_secret=api_secret,
            livekit_url=livekit_url,
            redis_host=os.getenv("REDIS_HOST", "localhost"),
            redis_port=int(os.getenv("REDIS_PORT", "6379")),
            redis_db=int(os.getenv("REDIS_DB", "0")),
            redis_username=os.getenv("REDIS_USERNAME"),
            redis_password=os.getenv("REDIS_PASSWORD"),
            user_name=os.getenv("USER_NAME", "User"),
            linkedin_context_id=os.getenv("LINKEDIN_CONTEXT_ID", ""),
            elevenlabs_api_key=os.getenv("ELEVENLABS_API_KEY"),
            tts_provider=os.getenv("TTS_PROVIDER", "elevenlabs"),
            google_api_key=os.getenv("GOOGLE_GENERATIVE_AI_API_KEY") or os.getenv("GEMINI_API_KEY"),
            openai_api_key=os.getenv("OPENAI_API_KEY"),
            mongodb_uri=os.getenv("MONGODB_URI"),
            mongo_db=os.getenv("MONGO_DB", "nexhack"),
        )
    
    @property
    def user_data(self) -> Dict[str, Any]:
        """Get user data dictionary"""
        return {
            "name": self.user_name,
            "linkedin_context_id": self.linkedin_context_id,
        }





