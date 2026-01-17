"""
Slack Agent (Mocked)

Mocked Slack agent for sending messages, reading channels, etc.
This is a demonstration agent with mock functionality.
"""

import asyncio
import uuid
from typing import Optional, List, Dict, Any

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from livekit.agents import Agent, llm, function_tool, RunContext
from services.shared_state import SharedStateService
from config import Config
from utils.logger import get_agent_logger, log_tool_call, log_shared_state_operation

logger = get_agent_logger("slack")


class SlackAgent(Agent):
    """Slack agent with mocked functionality"""
    
    def __init__(self, *args, shared_state=None, config=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._shared_state = shared_state
        self._config = config
        self._agent_name = "slack"
        # Mock data
        self._mock_channels = [
            {"id": "C001", "name": "general", "unread": 3},
            {"id": "C002", "name": "random", "unread": 0},
            {"id": "C003", "name": "engineering", "unread": 5},
            {"id": "C004", "name": "announcements", "unread": 1},
            {"id": "C005", "name": "production", "unread": 2},  # Add production channel
        ]
        self._mock_messages = {
            "C001": [
                {"user": "Alice", "text": "Good morning team!", "timestamp": "2024-01-03T10:00:00Z"},
                {"user": "Bob", "text": "Working on the new feature", "timestamp": "2024-01-03T10:15:00Z"},
            ],
            "C003": [
                {"user": "Charlie", "text": "Code review needed", "timestamp": "2024-01-03T09:30:00Z"},
            ],
            "C005": [  # Production channel messages
                {"user": "DevOps", "text": "Deployed v2.1.0 to production successfully", "timestamp": "2024-01-03T09:00:00Z"},
                {"user": "QA", "text": "All tests passed in staging", "timestamp": "2024-01-03T08:45:00Z"},
                {"user": "Product", "text": "New feature: Multi-agent system is live!", "timestamp": "2024-01-03T08:30:00Z"},
            ]
        }
    
    async def on_agent_speech_committed(self, message: llm.ChatMessage):
        """Log agent speech to shared state"""
        logger.info(f"💬 Agent: {message.text_content}")
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
    async def list_slack_channels(self, context: RunContext) -> str:
        """
        List all Slack channels with unread message counts.
        Returns a formatted list of channels.
        """
        log_tool_call("list_slack_channels", self._agent_name)
        logger.info("📋 Listing Slack channels (mocked)")
        result = "Slack Channels:\n"
        for channel in self._mock_channels:
            unread = channel["unread"]
            unread_str = f" ({unread} unread)" if unread > 0 else ""
            result += f"- #{channel['name']}{unread_str}\n"
        
        # Update shared state
        if self._shared_state:
            await self._shared_state.set_state(
                f"{self._agent_name}:channels",
                self._mock_channels
            )
            log_shared_state_operation("set", f"{self._agent_name}:channels", self._agent_name)
        
        return result
    
    @function_tool
    async def read_slack_channel(
        self, 
        context: RunContext,
        channel_name: str
    ) -> str:
        """
        Read messages from a Slack channel.
        
        Args:
            channel_name: Name of the channel to read (e.g., "general", "engineering")
        """
        log_tool_call("read_slack_channel", self._agent_name, {"channel": channel_name})
        logger.info(f"📖 Reading Slack channel: {channel_name} (mocked)")
        
        # Find channel
        channel = next((c for c in self._mock_channels if c["name"] == channel_name), None)
        if not channel:
            return f"Channel #{channel_name} not found"
        
        # Get messages
        messages = self._mock_messages.get(channel["id"], [])
        if not messages:
            return f"No messages in #{channel_name}"
        
        result = f"Messages in #{channel_name}:\n"
        for msg in messages:
            result += f"[{msg['user']}]: {msg['text']}\n"
        
        # Update shared state with full message data for cross-agent access
        if self._shared_state:
            # Store metadata
            await self._shared_state.set_state(
                f"{self._agent_name}:last_read_channel",
                {"channel": channel_name, "message_count": len(messages)}
            )
            # Store full messages for cross-agent access (keyed by channel name)
            await self._shared_state.set_state(
                f"{self._agent_name}:channel:{channel_name}",
                {
                    "channel": channel_name,
                    "channel_id": channel["id"],
                    "messages": messages,
                    "read_at": asyncio.get_event_loop().time()
                }
            )
            log_shared_state_operation("set", f"{self._agent_name}:channel:{channel_name}", self._agent_name)
            
            # Also store in a general context key for easy retrieval
            await self._shared_state.set_context(
                "slack_channel_data",
                {
                    "last_read_channel": channel_name,
                    "messages": messages,
                    "channel_info": channel
                }
            )
            logger.info(f"💾 Stored {len(messages)} messages from #{channel_name} in shared state for cross-agent access")
        
        return result
    
    @function_tool
    async def send_slack_message(
        self,
        context: RunContext,
        channel_name: str,
        message: str
    ) -> str:
        """
        Send a message to a Slack channel.
        
        Args:
            channel_name: Name of the channel to send to
            message: The message text to send
        """
        call_id = uuid.uuid4().hex[:8]
        print(f"\n{'='*60}")
        print(f"🔧 TOOL CALL #{call_id} - send_slack_message")
        print(f"📤 Sending to #{channel_name}: {message[:100]}...")
        print(f"{'='*60}\n")
        
        # Find channel
        channel = next((c for c in self._mock_channels if c["name"] == channel_name), None)
        if not channel:
            return f"❌ Channel #{channel_name} not found"
        
        # Mock sending (in real implementation, this would call Slack API)
        await asyncio.sleep(0.1)  # Simulate network delay
        
        # Add to mock messages
        if channel["id"] not in self._mock_messages:
            self._mock_messages[channel["id"]] = []
        
        self._mock_messages[channel["id"]].append({
            "user": self._config.user_name,
            "text": message,
            "timestamp": asyncio.get_event_loop().time()
        })
        
        # Update shared state
        if self._shared_state:
            await self._shared_state.set_state(
                f"{self._agent_name}:last_sent_message",
                {"channel": channel_name, "message": message, "timestamp": asyncio.get_event_loop().time()}
            )
        
        print(f"✅ [{call_id}] Message sent to #{channel_name}")
        return f"✅ Message sent to #{channel_name}: {message}"

