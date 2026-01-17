"""
LinkedIn Post Agent

Specialized agent for handling LinkedIn posting tasks.
"""

import os
import asyncio
import uuid
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from livekit.agents import Agent, llm, function_tool, RunContext
from services.shared_state import SharedStateService
from services.redis_service import RedisService
from services.image_service import ImageGenerationService
from config import Config
from utils.logger import get_agent_logger, log_tool_call, log_shared_state_operation

logger = get_agent_logger("linkedin")


class LinkedInAgent(Agent):
    """LinkedIn posting agent"""
    
    def __init__(self, *args, shared_state=None, config=None, redis_service=None, image_service=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._shared_state = shared_state
        self._config = config
        self._redis_service = redis_service
        self._image_service = image_service
        self._agent_name = "linkedin"
        # Note: Deduplication state is now stored in shared state, not instance variables
    
    async def on_agent_speech_committed(self, message: llm.ChatMessage):
        """Log agent speech to shared state"""
        logger.info(f"💼 Agent: {message.text_content}")
        if self._shared_state:
            await self._shared_state.add_conversation(
                self._agent_name,
                "assistant",
                message.text_content
            )
    
    async def on_user_speech_committed(self, message: llm.ChatMessage):
        """Log user speech to shared state"""
        logger.info(f"🗣️  User: {message.text_content}")
        if self._shared_state:
            await self._shared_state.add_conversation(
                self._agent_name,
                "user",
                message.text_content
            )
    
    @function_tool
    async def post_to_linkedin(
        self, 
        context: RunContext,
        post_content: str,
        image_description: Optional[str] = None
    ):
        """
        Post content to LinkedIn. Use this when the user explicitly confirms they want to post.
        IMPORTANT: Only call this function ONCE per post.
        
        Args:
            post_content: The LinkedIn post text content
            image_description: Optional description for generating an image. When the user asks to "generate an image" or "generate image description", both mean the same thing - provide a description here and an image will be automatically generated from it.
        """
        call_id = uuid.uuid4().hex[:8]
        current_time = asyncio.get_event_loop().time()
        
        log_tool_call("post_to_linkedin", self._agent_name, {
            "post_length": len(post_content),
            "has_image": image_description is not None,
            "call_id": call_id
        })
        logger.info(f"📝 Post content ({len(post_content)} chars): {post_content[:150]}...")
        if image_description:
            logger.info(f"🖼️  Image description: {image_description[:100]}...")
        
        # Get deduplication state from shared state (persists across agent instances)
        if not self._shared_state:
            logger.error(f"❌ [{call_id}] No shared state available for deduplication")
            return None, "Shared state not available"
        
        # Get last post time from shared state
        last_post_data = await self._shared_state.get_state(f"{self._agent_name}:last_post_data", {})
        last_post_time = last_post_data.get("timestamp", 0)
        recent_posts = last_post_data.get("recent_posts", [])
        
        # Cooldown check (10 seconds)
        if current_time - last_post_time < 10:
            time_since_last = current_time - last_post_time
            logger.warning(f"⚠️ [{call_id}] Too soon after last post ({time_since_last:.1f}s ago). Skipping duplicate.")
            return None, "I've already queued your LinkedIn post. It will be posted shortly - no need to post again!"
        
        # Deduplication check
        post_preview = post_content[:100].lower().strip()
        for recent_post_entry in recent_posts:
            recent_post_preview = recent_post_entry.get("preview", "")
            recent_post_timestamp = recent_post_entry.get("timestamp", 0)
            if recent_post_preview == post_preview:
                time_since = current_time - recent_post_timestamp
                logger.warning(f"⚠️ [{call_id}] Duplicate post detected (posted {time_since:.1f}s ago). Skipping.")
                return None, "I've already queued this LinkedIn post. It will be posted shortly - no need to post it again!"
        
        # Generate image if description provided
        image_url = None
        if image_description and self._image_service:
            logger.info(f"🖼️ [{call_id}] Generating image: {image_description[:100]}...")
            image_url = await self._image_service.generate(image_description)
            if image_url:
                logger.info(f"✅ [{call_id}] Image generated: {image_url[:80]}...")
            else:
                logger.warning(f"⚠️ [{call_id}] Image generation failed")
        
        # Queue the post
        task = {
            "type": "linkedin_post",
            "post_text": post_content,
            "image_url": image_url,
            "user_data": self._config.user_data,
            "timestamp": current_time
        }
        
        await self._redis_service.push_task(task)
        logger.info(f"✅ [{call_id}] Queued LinkedIn post" + (" with image" if image_url else ""))
        
        # Update deduplication state in shared state (persists across instances)
        # Add this post to recent posts list
        recent_posts.append({
            "preview": post_preview,
            "timestamp": current_time,
            "call_id": call_id
        })
        
        # Keep only last 3 posts
        if len(recent_posts) > 3:
            recent_posts.pop(0)
        
        # Store updated state in shared state
        await self._shared_state.set_state(
            f"{self._agent_name}:last_post_data",
            {
                "timestamp": current_time,
                "recent_posts": recent_posts,
                "last_post_preview": post_preview
            }
        )
        log_shared_state_operation("set", f"{self._agent_name}:last_post_data", self._agent_name)
        
        # Also store simple last_post for backward compatibility
        await self._shared_state.set_state(
            f"{self._agent_name}:last_post",
            {"timestamp": current_time, "preview": post_preview}
        )
        log_shared_state_operation("set", f"{self._agent_name}:last_post", self._agent_name)
        
        return None, f"✅ Done! I've queued your LinkedIn post{' with image' if image_url else ''}. It will be posted shortly."
    
    @function_tool
    async def get_slack_channel_data(
        self,
        context: RunContext,
        channel_name: Optional[str] = None
    ) -> str:
        """
        Get Slack channel messages from shared state.
        Useful for creating LinkedIn posts based on Slack discussions.
        
        Args:
            channel_name: Optional channel name. If not provided, returns the last read channel.
        """
        log_tool_call("get_slack_channel_data", self._agent_name, {"channel": channel_name})
        logger.info(f"📊 Retrieving Slack channel data: {channel_name or 'last_read'}")
        
        if not self._shared_state:
            logger.error("No shared state available")
            return "No shared state available"
        
        try:
            if channel_name:
                # Get specific channel
                channel_data = await self._shared_state.get_state(f"slack:channel:{channel_name}")
                if not channel_data:
                    return f"No data found for channel #{channel_name}"
            else:
                # Get last read channel from context
                context_data = await self._shared_state.get_context("slack_channel_data")
                if not context_data:
                    return "No Slack channel data available. Please read a Slack channel first."
                channel_data = {
                    "channel": context_data.get("last_read_channel"),
                    "messages": context_data.get("messages", []),
                    "channel_info": context_data.get("channel_info", {})
                }
            
            if not channel_data or "messages" not in channel_data:
                return "No messages found in channel data"
            
            messages = channel_data["messages"]
            channel = channel_data.get("channel", channel_name or "unknown")
            
            result = f"Slack Channel: #{channel}\n\n"
            result += "Messages:\n"
            for msg in messages:
                user = msg.get("user", "Unknown")
                text = msg.get("text", "")
                result += f"• {user}: {text}\n"
            
            logger.info(f"✅ Retrieved {len(messages)} messages from Slack channel #{channel}")
            log_shared_state_operation("get", f"slack:channel:{channel_name or 'last_read'}", self._agent_name)
            return result
        except Exception as e:
            logger.error(f"❌ Error retrieving Slack data: {str(e)}", exc_info=True)
            return f"Error retrieving Slack data: {str(e)}"

