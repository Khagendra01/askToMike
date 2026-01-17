"""
Agent Router

Routes user requests to the appropriate agent based on intent detection.
Uses LLM to determine which agent should handle the request.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from livekit.agents import inference, llm, Agent
from typing import Optional, Dict, Any
from agents.basic_agent import BasicAgent
from agents.linkedin_agent import LinkedInAgent
from agents.slack_agent import SlackAgent
from services.shared_state import SharedStateService
from services.redis_service import RedisService
from services.image_service import ImageGenerationService
from services.web_search_service import WebSearchService
from config import Config
from utils.logger import get_router_logger

router_logger = get_router_logger()


class AgentRouter:
    """Routes requests to appropriate agents based on intent"""
    
    def __init__(
        self,
        config: Config,
        shared_state: SharedStateService,
        redis_service: RedisService,
        image_service: ImageGenerationService,
        web_search_service: WebSearchService = None
    ):
        self.config = config
        self.shared_state = shared_state
        self.redis_service = redis_service
        self.image_service = image_service
        self.web_search_service = web_search_service
        self._router_llm = None
    
    def _get_router_llm(self):
        """Get or create router LLM"""
        if self._router_llm is None:
            self._router_llm = inference.LLM(
                model="google/gemini-2.0-flash",
            )
        return self._router_llm
    
    async def determine_agent(self, user_message: str) -> str:
        """
        Determine which agent should handle the user's message.
        Returns: 'basic', 'linkedin', or 'slack'
        """
        router_llm = self._get_router_llm()
        
        # Use LLM to determine intent
        router_prompt = f"""Analyze the user's message and determine which agent should handle it.

Available agents:
- basic: General conversation, questions, basic tasks
- linkedin: Posting to LinkedIn, LinkedIn-related tasks
- slack: Slack messages, channels, team communication

User message: "{user_message}"

Respond with ONLY one word: basic, linkedin, or slack"""

        try:
            response = await router_llm.chat([
                llm.ChatMessage(role="user", content=router_prompt)
            ])
            
            agent_choice = response.choices[0].message.content.strip().lower()
            
            # Validate choice
            if agent_choice in ['basic', 'linkedin', 'slack']:
                router_logger.info(f"🎯 Router selected: {agent_choice} for message: '{user_message[:50]}...'")
                return agent_choice
            else:
                router_logger.warning(f"⚠️ Invalid agent choice '{agent_choice}', defaulting to 'basic'")
                return 'basic'
        except Exception as e:
            router_logger.error(f"⚠️ Error in router: {e}, defaulting to 'basic'", exc_info=True)
            return 'basic'
    
    def create_agent(self, agent_type: str, instructions: str) -> Agent:
        """
        Create an agent instance based on type.
        
        Args:
            agent_type: 'basic', 'linkedin', or 'slack'
            instructions: System instructions for the agent
        """
        common_kwargs = {
            "instructions": instructions,
            "shared_state": self.shared_state,
            "config": self.config,
        }
        
        if agent_type == 'linkedin':
            return LinkedInAgent(
                **common_kwargs,
                redis_service=self.redis_service,
                image_service=self.image_service
            )
        elif agent_type == 'slack':
            return SlackAgent(**common_kwargs)
        else:  # basic
            return BasicAgent(
                **common_kwargs,
                web_search_service=self.web_search_service
            )
    
    def get_agent_system_prompt(self, agent_type: str) -> str:
        """Get system prompt for a specific agent type"""
        base_prompt = f"You are a helpful personal voice AI assistant for {self.config.user_name}."
        
        if agent_type == 'linkedin':
            return f"""{base_prompt}

Your role is to help with LinkedIn posting tasks:
- If the user wants to post to LinkedIn, have a conversation with them to finalize the post content
- Once the user confirms they're ready (e.g., "yes", "go ahead", "post it"), use the `post_to_linkedin` function
- If the user wants an image or asks to "generate an image" or "generate image description", these mean the same thing - provide the image description in the `image_description` parameter and the image will be automatically generated from that description
- You can access Slack channel data using `get_slack_channel_data` to create posts based on team discussions
- When user mentions creating a post based on Slack, first retrieve the Slack data, then help craft the LinkedIn post
- Be conversational and helpful

Important: Don't use any unpronounceable characters in your speech."""
        
        elif agent_type == 'slack':
            return f"""{base_prompt}

Your role is to help with Slack communication:
- You can list channels, read messages, and send messages to Slack
- Use the available Slack functions to interact with channels
- Be helpful and concise

Important: Don't use any unpronounceable characters in your speech."""
        
        else:  # basic
            return f"""{base_prompt}

Your primary role is to be a general assistant - help with questions, conversations, tasks, and anything the user needs. Be friendly, conversational, and natural.

You have access to web search capabilities - use the `search_web` function when the user asks questions that require current information, facts, news, research, or data from the internet. Examples:
- Current events or news
- Recent information about companies, people, or topics
- Facts, statistics, or data that might change over time
- Research questions that need up-to-date sources

If the user mentions LinkedIn or Slack, you can acknowledge it, but for specific actions, they should be routed to the appropriate agent.

Important: Don't use any unpronounceable characters in your speech."""

