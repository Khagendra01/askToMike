"""
X/Twitter Post Agent

Specialized agent for handling X/Twitter posting tasks.
"""

import asyncio
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from livekit.agents import Agent, llm, function_tool, RunContext
from config import Config
from utils.logger import get_agent_logger, log_tool_call

logger = get_agent_logger("x")


class XAgent(Agent):
    """X/Twitter posting agent"""
    
    def __init__(self, *args, shared_state=None, config=None, redis_service=None, image_service=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._shared_state = shared_state
        self._config = config
        self._redis_service = redis_service
        self._image_service = image_service
        self._agent_name = "x"
    
    async def on_agent_speech_committed(self, message: llm.ChatMessage):
        """Log agent speech"""
        logger.info(f"🐦 Agent: {message.text_content}")
    
    async def on_user_speech_committed(self, message: llm.ChatMessage):
        """Log user speech"""
        logger.info(f"🗣️  User: {message.text_content}")
    
    async def _post_to_x_impl(
        self, 
        post_content: str,
        image_description: Optional[str] = None
    ):
        """Internal implementation for posting to X/Twitter"""
        log_tool_call("post_to_x", self._agent_name, {
            "post_length": len(post_content),
            "has_image": image_description is not None
        })
        logger.info(f"📝 Post content ({len(post_content)} chars): {post_content[:150]}...")
        if image_description:
            logger.info(f"🖼️  Image description: {image_description[:100]}...")
        
        # Generate image if description provided
        image_url = None
        if image_description and self._image_service:
            logger.info(f"🖼️ Generating image: {image_description[:100]}...")
            try:
                image_url = await self._image_service.generate(image_description)
                if image_url:
                    logger.info(f"✅ Image generated: {image_url[:80]}...")
                else:
                    logger.warning(f"⚠️ Image generation failed")
            except Exception as e:
                logger.warning(f"⚠️ Image generation error: {e}")
        
        # Queue the post via Redis if available
        if self._redis_service:
            try:
                task = {
                    "type": "x_post",
                    "post_text": post_content,
                    "image_url": image_url,
                    "user_data": self._config.user_data if self._config else {},
                    "timestamp": asyncio.get_event_loop().time()
                }
                await self._redis_service.push_task(task)
                logger.info(f"✅ Queued X/Twitter post" + (" with image" if image_url else ""))
                return None, f"✅ Done! I've queued your X/Twitter post{' with image' if image_url else ''}. It will be posted shortly."
            except Exception as e:
                logger.warning(f"⚠️ Redis not available, post not queued: {e}")
        
        # If no Redis, just log the post (mock mode)
        logger.info(f"📋 X/Twitter post (mock - no Redis): {post_content[:100]}...")
        return None, f"✅ X/Twitter post prepared{' with image' if image_url else ''}: {post_content[:100]}..."

    @function_tool
    async def post_to_x(
        self, 
        context: RunContext,
        post_content: str,
        image_description: Optional[str] = None
    ):
        """
        Post content to X/Twitter. Use this when the user explicitly confirms they want to post.
        IMPORTANT: Only call this function ONCE per post.
        
        Args:
            post_content: The X/Twitter post text content (max 280 characters for standard posts)
            image_description: Optional description for generating an image. When the user asks to "generate an image" or "generate image description", both mean the same thing - provide a description here and an image will be automatically generated from it.
        """
        return await self._post_to_x_impl(post_content, image_description)
