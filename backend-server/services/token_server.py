"""
Token Server

HTTP server for generating LiveKit access tokens.
Handles manual agent dispatch since LiveKit Cloud auto-dispatch requires dashboard configuration.
"""

import asyncio
from typing import Optional

from aiohttp import web
from livekit import api

import sys
from pathlib import Path
# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import Config
from middleware import cors_middleware


class TokenServer:
    """Manages HTTP server for token generation"""
    
    def __init__(self, config: Config):
        self.config = config
        self._runner: Optional[web.AppRunner] = None
        self._site: Optional[web.TCPSite] = None
        self._livekit_api: Optional[api.LiveKitAPI] = None
        self._dispatched_rooms: set = set()  # Track rooms we've already dispatched to
    
    async def start(self) -> None:
        """Start the token server"""
        # Initialize LiveKit API client for room creation and agent dispatch
        self._livekit_api = api.LiveKitAPI(
            url=self.config.livekit_url.replace("wss://", "https://"),
            api_key=self.config.livekit_api_key,
            api_secret=self.config.livekit_api_secret,
        )
        
        app = web.Application(middlewares=[cors_middleware])
        app.router.add_get("/api/token", self._token_handler)
        
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        self._site = web.TCPSite(self._runner, "localhost", 8080)
        await self._site.start()
        print("✅ Token server running on http://localhost:8080/api/token")
    
    async def _token_handler(self, request: web.Request) -> web.Response:
        """Generate a LiveKit access token for the client and dispatch agent"""
        try:
            room = request.query.get("room", "my-room")
            identity = request.query.get("identity", "user")
            
            # Generate token for the user
            token = (
                api.AccessToken(self.config.livekit_api_key, self.config.livekit_api_secret)
                .with_identity(identity)
                .with_grants(
                    api.VideoGrants(
                        room_join=True,
                        room=room,
                        can_publish=True,
                        can_subscribe=True,
                    )
                )
                .to_jwt()
            )
            
            # Create room and dispatch agent (only once per room)
            if room not in self._dispatched_rooms:
                self._dispatched_rooms.add(room)
                asyncio.create_task(self._create_room_and_dispatch(room))
            
            return web.json_response({"token": token})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
    
    async def _create_room_and_dispatch(self, room_name: str) -> None:
        """Create room and dispatch agent"""
        try:
            if not self._livekit_api:
                return
            
            # Create room first
            try:
                await self._livekit_api.room.create_room(
                    api.CreateRoomRequest(
                        name=room_name,
                        empty_timeout=300,
                        max_participants=10,
                    )
                )
            except Exception:
                pass  # Room may already exist
            
            # Small delay then dispatch agent
            await asyncio.sleep(0.3)
            
            await self._livekit_api.agent_dispatch.create_dispatch(
                api.CreateAgentDispatchRequest(
                    room=room_name,
                    agent_name="",
                )
            )
        except Exception as e:
            # Remove from set so retry is possible
            self._dispatched_rooms.discard(room_name)
    
    async def stop(self) -> None:
        """Stop the token server"""
        if self._site:
            await self._site.stop()
        if self._runner:
            await self._runner.cleanup()
        if self._livekit_api:
            await self._livekit_api.aclose()

