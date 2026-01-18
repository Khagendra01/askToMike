"""
Multi-Agent System Entrypoint

Routes user requests to appropriate agents based on user intent.
"""

import os
import asyncio
import logging
from typing import Optional

from livekit.agents import AgentSession, JobContext, inference, llm, Agent, function_tool, RunContext
from livekit.plugins import elevenlabs
from livekit.agents import stt
from livekit.agents import tts as livekit_tts

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from config import Config
from services.shared_state import SharedStateService
from services.redis_service import RedisService
from services.image_service import ImageGenerationService
from services.web_search_service import WebSearchService
from services.tts_service import SystemTTS
from agents.agent_router import AgentRouter
from utils.logger import (
    get_logger, get_agent_logger, get_router_logger, 
    log_agent_switch, log_tool_call,
    setup_logging
)

# Setup logging for worker process (idempotent - won't duplicate if already set up)
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
log_level_map = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
    "CRITICAL": logging.CRITICAL,
}
setup_logging(level=log_level_map.get(log_level, logging.INFO), use_colors=True)

logger = get_logger(__name__)


async def entrypoint(ctx: JobContext):
    """Entrypoint function for LiveKit agent - called when a job is assigned"""
    logger.info(f"👉 Entrypoint called for job: {ctx.job.id}")
    try:
        await ctx.connect()
        logger.info(f"✅ Connected to room: {ctx.room.name}")
        
        # Log existing participants
        for participant in ctx.room.remote_participants.values():
            logger.info(f"👤 Existing participant: {participant.identity}")
            for track_pub in participant.track_publications.values():
                logger.info(f"   📡 Track: {track_pub.kind} - {track_pub.source}")
        
        # Add event handlers for debugging
        @ctx.room.on("track_subscribed")
        def on_track_subscribed(track, publication, participant):
            logger.info(f"📡 Track subscribed: {track.kind} from {participant.identity}")
        
        @ctx.room.on("participant_connected")
        def on_participant_connected(participant):
            logger.info(f"👤 Participant connected: {participant.identity}")
        
    except Exception as e:
        logger.error(f"❌ Failed to connect to room: {e}", exc_info=True)
        return
    
    # Wait for room state to stabilize
    await asyncio.sleep(0.1)
    
    # Load configuration
    config = Config.from_env()
    
    # Initialize services
    shared_state = SharedStateService(config)
    redis_service = RedisService(config)
    image_service = ImageGenerationService(config)
    web_search_service = WebSearchService(config)
    
    # Initialize router
    router = AgentRouter(
        config=config,
        shared_state=shared_state,
        redis_service=redis_service,
        image_service=image_service,
        web_search_service=web_search_service
    )
    
    # Initialize STT
    stt_model = inference.STT(
        model="deepgram/nova-3",
        language="en",
    )
    
    # Initialize LLM
    llm_model = inference.LLM(
        model="google/gemini-2.0-flash",
    )
    
    # Initialize TTS
    tts_model = None

    def _init_system_tts():
        try:
            logger.info("🔊 Initializing System TTS...")
            system_tts = SystemTTS()
            logger.info("✅ System TTS initialized successfully")
            return system_tts
        except Exception as e:
            logger.warning(f"❌ Failed to initialize System TTS: {e}", exc_info=True)
            return None
    
    if config.tts_provider == "free":
        tts_model = _init_system_tts()
        if not tts_model:
            raise RuntimeError("System TTS initialization failed")
    else:
        # ElevenLabs
        if not config.elevenlabs_api_key:
            raise ValueError("ELEVENLABS_API_KEY environment variable is required for TTS")
        
        api_key = config.elevenlabs_api_key.strip()
        if not api_key or len(api_key) < 10:
            raise ValueError("ELEVENLABS_API_KEY appears to be invalid (too short)")
        
        if "ELEVEN_API_KEY" not in os.environ:
            os.environ["ELEVEN_API_KEY"] = api_key
        
        try:
            eleven_tts = elevenlabs.TTS(
                voice_id="EXAVITQu4vr4xnSDxMaL",
                model="eleven_turbo_v2_5",
                api_key=api_key,
                auto_mode=True,
            )
            logger.info("✅ ElevenLabs TTS initialized successfully")
        except Exception as e:
            logger.warning(f"❌ Failed to initialize ElevenLabs TTS: {e}")
            eleven_tts = elevenlabs.TTS(
                voice_id="EXAVITQu4vr4xnSDxMaL",
                model="eleven_turbo_v2_5",
            )

        system_tts = _init_system_tts()
        if system_tts:
            tts_model = livekit_tts.FallbackAdapter([eleven_tts, system_tts])
        else:
            tts_model = eleven_tts
        
        # Add TTS error handler
        _tts_error_count = {"count": 0}
        
        def on_tts_error(error_event):
            error = error_event.error
            _tts_error_count["count"] += 1
            
            if _tts_error_count["count"] == 1 or (hasattr(error, 'retryable') and not error.retryable):
                logger.error(f"❌ TTS Error: {error}")
                if _tts_error_count["count"] == 1:
                    logger.debug("   Possible causes:")
                    logger.debug("   - Invalid or expired ElevenLabs API key")
                    logger.debug("   - Quota exceeded")
                    logger.debug("   - Network connectivity issues")
        
        tts_model.on("error", on_tts_error)
    
    # Create a unified agent that can handle all tasks and routes internally
    class UnifiedAgent(Agent):
        """Unified agent that routes internally to specialized functionality"""
        
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._router = router
            self._shared_state = shared_state
            self._web_search_service = web_search_service
            self._current_mode = 'basic'  # Track current mode
        
        async def on_user_speech_committed(self, message: llm.ChatMessage):
            """Route user message and update mode if needed"""
            user_text = message.text_content
            
            # Determine which agent type should handle this
            agent_type = await self._router.determine_agent(user_text)
            
            if self._current_mode != agent_type:
                log_agent_switch(self._current_mode, agent_type, f"User intent: {user_text[:50]}...")
                self._current_mode = agent_type
                # Update instructions dynamically
                new_prompt = self._router.get_agent_system_prompt(agent_type)
                if hasattr(self, '_chat_ctx'):
                    # Update system message
                    self._chat_ctx.system = new_prompt
            
            # Log to shared state
            if self._shared_state:
                await self._shared_state.add_conversation(
                    self._current_mode,
                    "user",
                    user_text
                )
            
            agent_logger = get_agent_logger(self._current_mode)
            agent_logger.info(f"🗣️  User: {user_text}")
        
        async def on_agent_speech_committed(self, message: llm.ChatMessage):
            """Log agent response"""
            agent_logger = get_agent_logger(self._current_mode)
            agent_logger.info(f"🤖 Agent: {message.text_content}")
            if self._shared_state:
                await self._shared_state.add_conversation(
                    self._current_mode,
                    "assistant",
                    message.text_content
                )
        
        # Add all function tools from specialized agents
        @function_tool
        async def post_to_linkedin(
            self,
            context: RunContext,
            post_content: str,
            image_description: Optional[str] = None
        ):
            """Post content to LinkedIn (delegates to LinkedIn agent logic)"""
            log_tool_call("post_to_linkedin", self._current_mode, {
                "post_length": len(post_content),
                "has_image": image_description is not None
            })
            if not self._router:
                return None, "Router not available"
            linkedin_agent = self._router.create_agent('linkedin', self._router.get_agent_system_prompt('linkedin'))
            if hasattr(linkedin_agent, '_post_to_linkedin_impl'):
                return await linkedin_agent._post_to_linkedin_impl(post_content, image_description)
            return None, "LinkedIn posting not available"
        
        @function_tool
        async def list_slack_channels(self, context: RunContext) -> str:
            """List Slack channels (delegates to Slack agent)"""
            if not self._router:
                return "Router not available"
            slack_agent = self._router.create_agent('slack', self._router.get_agent_system_prompt('slack'))
            return await slack_agent._list_slack_channels_impl()
        
        @function_tool
        async def read_slack_channel(self, context: RunContext, channel_name: str) -> str:
            """Read Slack channel messages"""
            if not self._router:
                return "Router not available"
            slack_agent = self._router.create_agent('slack', self._router.get_agent_system_prompt('slack'))
            return await slack_agent._read_slack_channel_impl(channel_name)
        
        @function_tool
        async def send_slack_message(self, context: RunContext, channel_name: str, message: str) -> str:
            """Send message to Slack channel"""
            if not self._router:
                return "Router not available"
            slack_agent = self._router.create_agent('slack', self._router.get_agent_system_prompt('slack'))
            return await slack_agent._send_slack_message_impl(channel_name, message)
        
        
        @function_tool
        async def search_web(
            self,
            context: RunContext,
            query: str,
            max_results: int = 5
        ) -> str:
            """
            Search the web for information. Use this when the user asks questions that require current information, facts, news, or data from the internet.
            
            Args:
                query: The search query - be specific and clear about what you're looking for
                max_results: Maximum number of results to return (default: 5)
            
            Returns:
                A formatted string with search results including titles, URLs, and snippets
            """
            log_tool_call("search_web", self._current_mode, {
                "query": query,
                "max_results": max_results
            })
            
            if not self._web_search_service:
                return "Web search service is not available."
            
            try:
                search_results = await self._web_search_service.search(query, max_results=max_results)
                
                if not search_results or search_results.get("count", 0) == 0:
                    return f"No results found for: {query}"
                
                # Format results
                result_text = f"Web search results for '{query}' ({search_results.get('provider', 'unknown')} provider):\n\n"
                
                # Add answer if available (from Tavily)
                if search_results.get("answer"):
                    result_text += f"Answer: {search_results['answer']}\n\n"
                
                # Add individual results
                results = search_results.get("results", [])
                for i, result in enumerate(results, 1):
                    title = result.get("title", "No title")
                    url = result.get("url", "")
                    snippet = result.get("snippet", "")
                    
                    result_text += f"{i}. {title}\n"
                    if url:
                        result_text += f"   URL: {url}\n"
                    if snippet:
                        result_text += f"   {snippet}\n"
                    result_text += "\n"
                
                return result_text
                
            except Exception as e:
                logger.error(f"❌ Web search error: {e}", exc_info=True)
                return f"Error performing web search: {str(e)}"
    
    # Create unified agent with basic prompt
    default_prompt = router.get_agent_system_prompt('basic')
    unified_agent = UnifiedAgent(
        instructions=default_prompt
    )
    # Set router and shared_state after creation
    unified_agent._router = router
    unified_agent._shared_state = shared_state
    unified_agent._web_search_service = web_search_service
    
    # Start agent session
    session = AgentSession(
        stt=stt_model,
        llm=llm_model,
        tts=tts_model,
    )
    
    await session.start(
        room=ctx.room,
        agent=unified_agent
    )
    
    # Greet the user
    async def greet_user():
        """Greet user with retry logic"""
        max_retries = 3
        for attempt in range(max_retries):
            try:
                await asyncio.sleep(0.5)
                await session.generate_reply(
                    instructions="Greet the user warmly as their personal assistant. Be friendly and offer to help with anything they need - general questions, LinkedIn posts, or Slack messages."
                )
                logger.info("✅ Greeting sent successfully")
                return
            except asyncio.CancelledError:
                return
            except Exception as e:
                if attempt < max_retries - 1:
                    wait_time = (attempt + 1) * 0.5
                    logger.warning(f"⚠️ Greeting attempt {attempt + 1} failed, retrying in {wait_time}s...")
                    await asyncio.sleep(wait_time)
                else:
                    logger.warning(f"⚠️ Warning: Could not generate greeting after {max_retries} attempts")
    
    asyncio.create_task(greet_user())
    
    logger.info("✅ Multi-agent session started")
    logger.info("   Available agents: basic, linkedin, slack")
