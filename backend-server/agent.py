"""
Multi-Agent System Entrypoint

Routes user requests to appropriate agents based on user intent.
"""

import os
import asyncio
import logging
import json
from typing import Optional
from datetime import datetime

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
from services.conversation_storage_service import ConversationStorageService
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
    conversation_storage = ConversationStorageService(config)
    
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
            self._conversation_storage = conversation_storage
            self._current_mode = 'basic'  # Track current mode
            self._session_id = None  # Will be set when session starts
        
        async def on_user_speech_committed(self, message: llm.ChatMessage):
            """Route user message and update mode if needed"""
            user_text = message.text_content
            logger.info(f"📝 on_user_speech_committed called with: {user_text[:50]}...")
            
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
                try:
                    await self._shared_state.add_conversation(
                        self._current_mode,
                        "user",
                        user_text
                    )
                    logger.info(f"✅ Saved user message to Redis (agent: {self._current_mode})")
                except Exception as e:
                    logger.error(f"❌ Failed to save user message to Redis: {e}", exc_info=True)
            else:
                logger.warning("⚠️ Shared state not available for saving conversation")
            
            agent_logger = get_agent_logger(self._current_mode)
            agent_logger.info(f"🗣️  User: {user_text}")
        
        async def on_agent_speech_committed(self, message: llm.ChatMessage):
            """Log agent response"""
            agent_text = message.text_content
            logger.info(f"📝 on_agent_speech_committed called with: {agent_text[:50]}...")
            
            agent_logger = get_agent_logger(self._current_mode)
            agent_logger.info(f"🤖 Agent: {agent_text}")
            
            if self._shared_state:
                try:
                    await self._shared_state.add_conversation(
                        self._current_mode,
                        "assistant",
                        agent_text
                    )
                    logger.info(f"✅ Saved agent message to Redis (agent: {self._current_mode})")
                except Exception as e:
                    logger.error(f"❌ Failed to save agent message to Redis: {e}", exc_info=True)
            else:
                logger.warning("⚠️ Shared state not available for saving conversation")
        
        # Add all function tools from specialized agents
        @function_tool
        async def post_to_linkedin(
            self,
            context: RunContext,
            post_content: str,
            image_description: Optional[str] = None
        ):
            """
            Post content to LinkedIn (delegates to LinkedIn agent logic).
            Note: There is a 30-second cooldown between posts to prevent duplicates.
            """
            log_tool_call("post_to_linkedin", self._current_mode, {
                "post_length": len(post_content),
                "has_image": image_description is not None
            })
            if not self._router:
                return None, "Router not available"
            linkedin_agent = self._router.create_agent('linkedin', self._router.get_agent_system_prompt('linkedin'))
            # Ensure shared_state is passed for cooldown/deduplication checks
            if hasattr(linkedin_agent, '_shared_state') and linkedin_agent._shared_state is None:
                linkedin_agent._shared_state = self._shared_state
            if hasattr(linkedin_agent, '_post_to_linkedin_impl'):
                return await linkedin_agent._post_to_linkedin_impl(post_content, image_description)
            return None, "LinkedIn posting not available"
        
        @function_tool
        async def post_to_x(
            self,
            context: RunContext,
            post_content: str,
            image_description: Optional[str] = None
        ):
            """Post content to X/Twitter (delegates to X agent logic)"""
            log_tool_call("post_to_x", self._current_mode, {
                "post_length": len(post_content),
                "has_image": image_description is not None
            })
            if not self._router:
                return None, "Router not available"
            x_agent = self._router.create_agent('x', self._router.get_agent_system_prompt('x'))
            if hasattr(x_agent, '_post_to_x_impl'):
                return await x_agent._post_to_x_impl(post_content, image_description)
            return None, "X/Twitter posting not available"
        
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
        
        @function_tool
        async def list_calendar_events(
            self,
            context: RunContext,
            max_results: int = 10
        ) -> str:
            """
            List upcoming calendar events. Use when the user asks about their schedule, meetings, or upcoming events.
            
            Args:
                max_results: Maximum number of events to return (default: 10)
            
            Returns:
                A formatted string with upcoming calendar events
            """
            log_tool_call("list_calendar_events", self._current_mode, {"max_results": max_results})
            
            try:
                from services.calendar_service import CalendarService
                from datetime import datetime
                
                cal = CalendarService()
                events = await cal.list_events(max_results)
                
                if not events:
                    return "No upcoming events found in your calendar."
                
                result = "Your upcoming calendar events:\n\n"
                for i, event in enumerate(events, 1):
                    summary = event.get('summary', 'No title')
                    start = event['start'].get('dateTime', event['start'].get('date'))
                    
                    # Format the date/time nicely
                    try:
                        dt = datetime.fromisoformat(start.replace('Z', '+00:00'))
                        start_str = dt.strftime('%Y-%m-%d %I:%M %p')
                    except:
                        start_str = start
                    
                    result += f"{i}. {summary}\n"
                    result += f"   When: {start_str}\n"
                    
                    if event.get('description'):
                        desc = event['description'][:100]  # Truncate long descriptions
                        result += f"   {desc}\n"
                    result += "\n"
                
                return result
            except FileNotFoundError as e:
                return "Calendar service is not configured. Please check credentials file."
            except Exception as e:
                logger.error(f"❌ Calendar error: {e}", exc_info=True)
                return f"Error accessing calendar: {str(e)}"
        
        @function_tool
        async def retrieve_previous_conversation(
            self,
            context: RunContext,
            query: str,
            limit: int = 3
        ) -> str:
            """
            Search and retrieve information from previous conversations. Use this when the user asks about something that happened in a past conversation, references something discussed before, or wants to recall details from earlier sessions.
            
            Args:
                query: Search query describing what to look for in previous conversations
                limit: Maximum number of previous conversation results to return (default: 3)
            
            Returns:
                A formatted string with relevant previous conversation excerpts
            """
            log_tool_call("retrieve_previous_conversation", self._current_mode, {
                "query": query,
                "limit": limit
            })
            
            if not self._conversation_storage:
                return "Conversation storage service is not available."
            
            try:
                results = await self._conversation_storage.search_conversations(
                    query=query,
                    limit=limit
                )
                
                if not results:
                    return f"No previous conversations found matching: '{query}'"
                
                result_text = f"Found {len(results)} previous conversation(s) matching '{query}':\n\n"
                
                for i, conv in enumerate(results, 1):
                    session_id = conv.get("session_id", "unknown")
                    saved_at = conv.get("saved_at", "")
                    messages = conv.get("messages", [])
                    score = conv.get("score", 0.0)
                    message_count = conv.get("message_count", len(messages))
                    
                    result_text += f"{i}. Previous conversation (Session: {session_id[:20]}..., "
                    if saved_at:
                        try:
                            dt = datetime.fromisoformat(saved_at.replace('Z', '+00:00'))
                            result_text += f"Date: {dt.strftime('%Y-%m-%d %I:%M %p')}, "
                        except:
                            pass
                    result_text += f"Messages: {message_count}, Relevance: {score:.3f})\n"
                    
                    # Show a few key messages from the conversation
                    if messages:
                        # Show user and assistant messages (limit to 3-4)
                        shown_messages = [m for m in messages if m.get("role") in ["user", "assistant"]][:4]
                        for msg in shown_messages:
                            role = msg.get("role", "unknown")
                            message_text = msg.get("message", "")[:200]  # Truncate long messages
                            result_text += f"   {role}: {message_text}"
                            if len(msg.get("message", "")) > 200:
                                result_text += "..."
                            result_text += "\n"
                    
                    result_text += "\n"
                
                return result_text
                
            except Exception as e:
                logger.error(f"❌ Conversation retrieval error: {e}", exc_info=True)
                return f"Error retrieving previous conversations: {str(e)}"
        
        @function_tool
        async def create_calendar_event(
            self,
            context: RunContext,
            title: str,
            start_time: str,
            duration_minutes: int = 60,
            description: str = ""
        ) -> str:
            """
            Create a new calendar event. Use when the user wants to schedule a meeting, appointment, or event.
            
            Args:
                title: Event title/summary
                start_time: Start time in ISO format (e.g., "2026-01-20T14:00:00" or "2026-01-20T14:00:00-08:00")
                duration_minutes: Duration in minutes (default: 60)
                description: Optional event description
            
            Returns:
                Confirmation message with event details
            """
            log_tool_call("create_calendar_event", self._current_mode, {
                "title": title,
                "start_time": start_time,
                "duration_minutes": duration_minutes
            })
            
            try:
                from services.calendar_service import CalendarService
                from datetime import datetime, timedelta
                
                cal = CalendarService()
                
                # Parse the start time
                try:
                    # Handle timezone info
                    if 'Z' in start_time:
                        start = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                    else:
                        start = datetime.fromisoformat(start_time)
                except ValueError:
                    return f"Invalid date format: {start_time}. Please use ISO format like '2026-01-20T14:00:00'"
                
                end = start + timedelta(minutes=duration_minutes)
                
                event = await cal.create_event(title, start, end, description)
                event_link = event.get('htmlLink', '')
                
                return f"✅ Created calendar event: '{title}' on {start.strftime('%Y-%m-%d at %I:%M %p')}. {f'Link: {event_link}' if event_link else ''}"
            except FileNotFoundError as e:
                return "Calendar service is not configured. Please check credentials file."
            except Exception as e:
                logger.error(f"❌ Calendar error: {e}", exc_info=True)
                return f"Error creating calendar event: {str(e)}"
    
    # Create unified agent with basic prompt
    default_prompt = router.get_agent_system_prompt('basic')
    unified_agent = UnifiedAgent(
        instructions=default_prompt
    )
    # Set router and shared_state after creation
    unified_agent._router = router
    unified_agent._shared_state = shared_state
    unified_agent._web_search_service = web_search_service
    unified_agent._conversation_storage = conversation_storage
    unified_agent._session_id = ctx.job.id  # Use job ID as session ID
    
    # Start agent session
    session = AgentSession(
        stt=stt_model,
        llm=llm_model,
        tts=tts_model,
    )
    
    # Store session metadata for conversation storage
    session_id = ctx.job.id
    room_name = ctx.room.name
    
    # Track if conversation has been saved to avoid duplicate saves
    _conversation_saved = {"saved": False}
    
    # Function to save conversation when session ends
    async def save_conversation_on_exit():
        """Save conversation to MongoDB when session ends"""
        if _conversation_saved["saved"]:
            logger.info("💾 Conversation already saved, skipping duplicate save")
            return  # Already saved
        
        try:
            logger.info("=" * 60)
            logger.info("💾 SESSION END DETECTED - Saving conversation to MongoDB...")
            logger.info("=" * 60)
            
            # Get all messages from shared state for this session
            # We collect from all agent conversation keys since they're stored per-agent
            all_messages = []
            
            # Get messages from all agent conversation lists
            client = await shared_state.connect()
            pattern = f"{shared_state._conversation_prefix}*"
            conversation_keys = await client.keys(pattern)
            
            logger.info(f"📋 Found {len(conversation_keys)} conversation key(s) in Redis")
            
            for key in conversation_keys:
                entries = await client.lrange(key, 0, -1)
                logger.info(f"   - {key}: {len(entries)} message(s)")
                for entry in entries:
                    try:
                        msg = json.loads(entry)
                        all_messages.append(msg)
                    except json.JSONDecodeError:
                        continue
            
            # Sort by timestamp
            all_messages.sort(key=lambda x: x.get("timestamp", ""))
            
            if all_messages:
                _conversation_saved["saved"] = True
                
                # Count messages by role
                user_count = sum(1 for m in all_messages if m.get("role") == "user")
                assistant_count = sum(1 for m in all_messages if m.get("role") == "assistant")
                
                # Extract agent types from messages
                agent_types = list(set(m.get("agent_name", "basic") for m in all_messages if "agent_name" in m))
                if not agent_types:
                    agent_types = ["basic"]
                
                logger.info(f"📊 Conversation Summary:")
                logger.info(f"   Session ID: {session_id}")
                logger.info(f"   Room: {room_name}")
                logger.info(f"   Total Messages: {len(all_messages)}")
                logger.info(f"   - User messages: {user_count}")
                logger.info(f"   - Assistant messages: {assistant_count}")
                logger.info(f"   Agent types used: {', '.join(agent_types)}")
                logger.info(f"")
                logger.info(f"🔄 Generating embeddings and saving to MongoDB...")
                
                doc_id = await conversation_storage.save_conversation(
                    session_id=session_id,
                    room_name=room_name,
                    messages=all_messages,
                    metadata={
                        "job_id": ctx.job.id,
                        "room_name": room_name,
                        "agent_types": agent_types
                    }
                )
                
                logger.info("=" * 60)
                logger.info(f"✅ CONVERSATION SAVED SUCCESSFULLY!")
                logger.info(f"   MongoDB Document ID: {doc_id}")
                logger.info(f"   Collection: conversations")
                logger.info(f"   Ready for vector search retrieval")
                logger.info("=" * 60)
            else:
                logger.info("=" * 60)
                logger.info(f"⚠️  No messages to save for session: {session_id}")
                logger.info("   (Session ended without any conversation)")
                logger.info("=" * 60)
        except Exception as e:
            logger.error("=" * 60)
            logger.error(f"❌ FAILED TO SAVE CONVERSATION")
            logger.error(f"   Error: {e}")
            logger.error("=" * 60)
            logger.error(f"❌ Failed to save conversation: {e}", exc_info=True)
    
    # Hook into room disconnect events to save conversation
    # Note: LiveKit's .on() requires synchronous callbacks, so we use asyncio.create_task
    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant):
        logger.info(f"👤 Participant disconnected: {participant.identity}")
        # Save conversation when user disconnects (run async function in background)
        asyncio.create_task(save_conversation_on_exit())
    
    @ctx.room.on("disconnected")
    def on_room_disconnected():
        logger.info("🔌 Room disconnected")
        # Also save on room disconnect (backup handler)
        asyncio.create_task(save_conversation_on_exit())
    
    # Greet the user immediately after session starts
    async def greet_user():
        """Greet user with retry logic"""
        max_retries = 3
        for attempt in range(max_retries):
            try:
                # Small delay to ensure session is fully ready
                await asyncio.sleep(0.1)
                await session.generate_reply(
                    instructions="Greet the user warmly as their personal assistant. Be friendly and offer to help with anything they need - general questions, LinkedIn posts, or Slack messages."
                )
                logger.info("✅ Greeting sent successfully")
                return
            except asyncio.CancelledError:
                return
            except Exception as e:
                if attempt < max_retries - 1:
                    wait_time = (attempt + 1) * 0.3  # Reduced retry delay
                    logger.warning(f"⚠️ Greeting attempt {attempt + 1} failed, retrying in {wait_time}s...")
                    await asyncio.sleep(wait_time)
                else:
                    logger.warning(f"⚠️ Warning: Could not generate greeting after {max_retries} attempts")
    
    logger.info("✅ Multi-agent session starting")
    logger.info("   Available agents: basic, linkedin, slack, x")
    logger.info(f"   Session ID: {session_id}, Room: {room_name}")
    
    # Hook into session to capture messages from chat context
    # This captures ALL messages (speech + text) that go through the session
    _saved_message_ids = set()  # Track saved messages by their id()
    
    async def monitor_session_messages():
        """Monitor session for all messages and save them"""
        try:
            await asyncio.sleep(3)  # Wait for session to fully start
            logger.info("📡 Starting message monitor...")
            
            # Log what attributes are available for debugging
            logger.info(f"   Session attributes: {[a for a in dir(session) if not a.startswith('_')][:20]}")
            
            while True:
                try:
                    await asyncio.sleep(1)  # Check every second
                    
                    # Try multiple ways to access the chat context
                    chat_ctx = None
                    items = None
                    
                    # Method 1: session.chat_ctx
                    if hasattr(session, 'chat_ctx') and session.chat_ctx:
                        chat_ctx = session.chat_ctx
                    # Method 2: session._chat_ctx  
                    elif hasattr(session, '_chat_ctx') and session._chat_ctx:
                        chat_ctx = session._chat_ctx
                    # Method 3: agent's chat context
                    elif hasattr(unified_agent, '_chat_ctx') and unified_agent._chat_ctx:
                        chat_ctx = unified_agent._chat_ctx
                    
                    if chat_ctx:
                        # Try to get items/messages from chat context
                        if hasattr(chat_ctx, 'items'):
                            items = chat_ctx.items
                        elif hasattr(chat_ctx, 'messages'):
                            items = chat_ctx.messages
                    
                    if items:
                        for item in items:
                            item_id = id(item)
                            if item_id in _saved_message_ids:
                                continue
                            
                            # Extract role
                            role = getattr(item, 'role', None)
                            if role:
                                # Handle enum
                                if hasattr(role, 'value'):
                                    role = role.value
                                role = str(role).lower()
                            
                            # Extract content
                            content = None
                            if hasattr(item, 'text_content') and item.text_content:
                                content = item.text_content
                            elif hasattr(item, 'content'):
                                c = item.content
                                if isinstance(c, str):
                                    content = c
                                elif isinstance(c, list):
                                    # Extract text from content parts
                                    parts = []
                                    for part in c:
                                        if hasattr(part, 'text'):
                                            parts.append(str(part.text))
                                        elif isinstance(part, str):
                                            parts.append(part)
                                    content = ' '.join(parts)
                            
                            if role in ['user', 'assistant'] and content and str(content).strip():
                                content = str(content).strip()
                                _saved_message_ids.add(item_id)
                                
                                agent_name = getattr(unified_agent, '_current_mode', 'basic')
                                try:
                                    await shared_state.add_conversation(agent_name, role, content)
                                    logger.info(f"💾 Captured {role}: {content[:60]}...")
                                except Exception as e:
                                    logger.error(f"❌ Failed to save message: {e}")
                                    
                except Exception as e:
                    # Only log if it's not a common "no messages yet" error
                    if "NoneType" not in str(e):
                        logger.debug(f"Monitor check error: {e}")
                    await asyncio.sleep(2)
        except asyncio.CancelledError:
            logger.info("📡 Message monitor cancelled")
        except Exception as e:
            logger.error(f"Error in monitor_session_messages task: {e}")
    
    # Start message monitoring
    asyncio.create_task(monitor_session_messages())
    
    # Start session (this may take a moment to initialize)
    await session.start(
        room=ctx.room,
        agent=unified_agent
    )
    
    logger.info("✅ Multi-agent session started")
    
    # Greet the user immediately after session is ready
    asyncio.create_task(greet_user())
