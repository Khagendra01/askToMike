"""
Token Server

HTTP server for generating LiveKit access tokens.
"""

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
    
    async def start(self) -> None:
        """Start the token server"""
        app = web.Application(middlewares=[cors_middleware])
        app.router.add_get("/api/token", self._token_handler)
        
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        self._site = web.TCPSite(self._runner, "localhost", 8080)
        await self._site.start()
        print("✅ Token server running on http://localhost:8080/api/token")
    
    async def _token_handler(self, request: web.Request) -> web.Response:
        """Generate a LiveKit access token for the client"""
        try:
            room = request.query.get("room", "my-room")
            identity = request.query.get("identity", "user")
            
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
            
            return web.json_response({"token": token})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
    
    async def stop(self) -> None:
        """Stop the token server"""
        if self._site:
            await self._site.stop()
        if self._runner:
            await self._runner.cleanup()

