"""
Main Application

Manages application lifecycle and coordinates all services.
"""

import asyncio
import signal
from typing import Optional

from livekit.agents import WorkerOptions, AgentServer

from config import Config
from services.token_server import TokenServer
from services.redis_service import RedisService
from services.shared_state import SharedStateService
from services.conversation_storage_service import ConversationStorageService
from agent import entrypoint


class Application:
    """Main application class managing lifecycle"""
    
    def __init__(self, config: Config):
        self.config = config
        self.token_server = TokenServer(config)
        self.redis_service = RedisService(config)
        self.shared_state = SharedStateService(config)
        self.conversation_storage = ConversationStorageService(config) if config.mongodb_uri else None
        self.server: Optional[AgentServer] = None
    
    async def start(self) -> None:
        """Start all services"""
        # Start token server
        await self.token_server.start()
        
        # Ensure vector search index exists (non-blocking check)
        if self.conversation_storage:
            try:
                await self.conversation_storage.ensure_vector_index(wait_until_ready=False)
            except Exception as e:
                print(f"⚠️ Warning: Could not ensure vector search index: {e}")
                print("   Vector search will not work until index is created.")
                print("   See conversation_storage_service.py documentation for manual setup.")
        
        # Verify credentials
        if not self.config.livekit_api_key or not self.config.livekit_api_secret:
            raise ValueError("LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set")
        
        print(f"🔗 AgentServer will connect to: {self.config.livekit_url}")
        print(f"🔑 Using API Key: {self.config.livekit_api_key[:10]}...")
        
        # Create AgentServer
        self.server = AgentServer.from_server_options(
            WorkerOptions(
                entrypoint_fnc=entrypoint,
                ws_url=self.config.livekit_url,
                api_key=self.config.livekit_api_key,
                api_secret=self.config.livekit_api_secret,
                num_idle_processes=1,  # Prewarm one process for better log visibility
            )
        )
        
        # Add event listeners
        @self.server.on("worker_started")
        def on_worker_started():
            print("✅ Worker started successfully")
        
        @self.server.on("worker_registered")
        def on_worker_registered():
            print("✅ Worker registered with LiveKit - ready to accept jobs!")
        
        print("Local LiveKit Agent backend started")
        print("Token server running on http://localhost:8080/api/token")
        print("Multi-agent system ready:")
        print("  - Basic communication agent")
        print("  - LinkedIn post agent")
        print("  - Slack agent (mocked)")
        print("Waiting for LiveKit jobs...")
        print("Press Ctrl+C to exit gracefully")
    
    async def run(self) -> None:
        """Run the server"""
        if not self.server:
            raise RuntimeError("Server not started. Call start() first.")
        await self.server.run()
    
    async def stop(self) -> None:
        """Stop all services"""
        print("\n🛑 Shutting down gracefully...")
        
        if self.token_server:
            await self.token_server.stop()
        
        if self.redis_service:
            await self.redis_service.close()
        
        if self.shared_state:
            await self.shared_state.close()
        
        print("✅ Cleanup complete")


async def main():
    """Main async function with proper signal handling"""
    # Suppress asyncio InvalidStateError during shutdown
    def suppress_asyncio_errors(loop, context):
        """Suppress asyncio InvalidStateError during shutdown"""
        exception = context.get('exception')
        if isinstance(exception, asyncio.InvalidStateError):
            # Suppress InvalidStateError during shutdown - these are harmless
            return
        # Let other exceptions be handled normally
        if loop.get_debug():
            loop.default_exception_handler(context)
    
    # Set custom exception handler
    loop = asyncio.get_running_loop()
    loop.set_exception_handler(suppress_asyncio_errors)
    
    # Load configuration
    try:
        config = Config.from_env()
    except ValueError as e:
        print(f"❌ Configuration error: {e}")
        return
    
    # Create application
    app = Application(config)
    
    # Setup signal handlers
    shutdown_event = asyncio.Event()
    
    def signal_handler(signum, frame):
        print(f"\n⚠️ Received signal {signum}, initiating shutdown...")
        shutdown_event.set()
    
    try:
        if hasattr(signal, 'SIGINT'):
            signal.signal(signal.SIGINT, signal_handler)
        if hasattr(signal, 'SIGTERM'):
            signal.signal(signal.SIGTERM, signal_handler)
    except (ValueError, OSError) as e:
        print(f"⚠️ Could not register signal handlers: {e}")
    
    try:
        # Start application
        await app.start()
        
        # Run server in background
        server_task = asyncio.create_task(app.run())
        shutdown_task = asyncio.create_task(shutdown_event.wait())
        
        # Wait for shutdown or completion
        done, pending = await asyncio.wait(
            [server_task, shutdown_task],
            return_when=asyncio.FIRST_COMPLETED
        )
        
        # Cancel pending tasks gracefully with timeout
        for task in pending:
            if not task.done():
                task.cancel()
        
        # Wait for cancellation with timeout, ignore errors
        if pending:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*pending, return_exceptions=True),
                    timeout=2.0
                )
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
            except Exception:
                # Ignore all errors during cleanup
                pass
        
    except KeyboardInterrupt:
        print("\n⚠️ KeyboardInterrupt received, shutting down...")
    except Exception as e:
        print(f"\n❌ Error in main: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await app.stop()

