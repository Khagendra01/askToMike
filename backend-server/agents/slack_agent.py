"""
Slack Agent (Mocked)

Mocked Slack agent for sending messages, reading channels, etc.
This is a demonstration agent with mock functionality.
"""

import asyncio
from typing import Optional, List, Dict, Any

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from livekit.agents import Agent, llm, function_tool, RunContext
from config import Config
from utils.logger import get_agent_logger, log_tool_call

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
        """Log agent speech"""
        logger.info(f"💬 Agent: {message.text_content}")
    
    async def on_user_speech_committed(self, message: llm.ChatMessage):
        """Log user speech"""
        logger.info(f"🗣️  User: {message.text_content}")
    
    async def _list_slack_channels_impl(self) -> str:
        """Implementation for listing Slack channels"""
        log_tool_call("list_slack_channels", self._agent_name)
        logger.info("📋 Listing Slack channels (mocked)")
        result = "Slack Channels:\n"
        for channel in self._mock_channels:
            unread = channel["unread"]
            unread_str = f" ({unread} unread)" if unread > 0 else ""
            result += f"- #{channel['name']}{unread_str}\n"
        
        return result
    
    @function_tool
    async def list_slack_channels(self, context: RunContext) -> str:
        """
        List all Slack channels with unread message counts.
        Returns a formatted list of channels.
        """
        return await self._list_slack_channels_impl()
    
    async def _read_slack_channel_impl(self, channel_name: str) -> str:
        """Implementation for reading Slack channel messages"""
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
        return await self._read_slack_channel_impl(channel_name)
    
    async def _send_slack_message_impl(self, channel_name: str, message: str) -> str:
        """Implementation for sending Slack messages"""
        log_tool_call("send_slack_message", self._agent_name, {"channel": channel_name})
        logger.info(f"📤 Sending to #{channel_name}: {message[:100]}...")
        
        # Find channel
        channel = next((c for c in self._mock_channels if c["name"] == channel_name), None)
        if not channel:
            return f"Channel #{channel_name} not found"
        
        # Mock sending (in real implementation, this would call Slack API)
        await asyncio.sleep(0.1)  # Simulate network delay
        
        # Add to mock messages
        if channel["id"] not in self._mock_messages:
            self._mock_messages[channel["id"]] = []
        
        self._mock_messages[channel["id"]].append({
            "user": self._config.user_name if self._config else "User",
            "text": message,
            "timestamp": asyncio.get_event_loop().time()
        })
        
        logger.info(f"✅ Message sent to #{channel_name}")
        return f"Message sent to #{channel_name}: {message}"
    
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
        return await self._send_slack_message_impl(channel_name, message)

