"""
Observer Agent

Always-on agent that monitors and maintains shared state across all agents.
This agent doesn't interact with users directly but ensures data consistency.
"""

import asyncio
import json
from typing import Dict, Any, Optional
from datetime import datetime

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from services.shared_state import SharedStateService
from config import Config
from utils.logger import get_observer_logger

logger = get_observer_logger()


class ObserverAgent:
    """Observer agent that maintains shared state and monitors agent interactions"""
    
    def __init__(self, config: Config, shared_state: SharedStateService):
        self.config = config
        self.shared_state = shared_state
        self._running = False
        self._monitor_task: Optional[asyncio.Task] = None
    
    async def start(self) -> None:
        """Start the observer agent"""
        self._running = True
        self._monitor_task = asyncio.create_task(self._monitor_loop())
        logger.info("👁️ Observer agent started - monitoring shared state")
    
    async def stop(self) -> None:
        """Stop the observer agent"""
        self._running = False
        if self._monitor_task:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
        logger.info("👁️ Observer agent stopped")
    
    async def _monitor_loop(self) -> None:
        """Main monitoring loop"""
        while self._running:
            try:
                # Monitor shared state
                await self._update_agent_status()
                
                # Clean up old data periodically
                await self._cleanup_old_data()
                
                # Wait before next check
                await asyncio.sleep(5)  # Check every 5 seconds
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"⚠️ Observer agent error: {e}", exc_info=True)
                await asyncio.sleep(5)
    
    async def _update_agent_status(self) -> None:
        """Update status of all agents"""
        try:
            states = await self.shared_state.get_all_agent_states()
            if states:
                # Update last seen timestamp
                await self.shared_state.set_state(
                    "observer:last_update",
                    {"timestamp": datetime.now().isoformat(), "agent_count": len(states)}
                )
                logger.debug(f"Updated observer status: {len(states)} active agents")
        except Exception as e:
            logger.error(f"⚠️ Error updating agent status: {e}", exc_info=True)
    
    async def _cleanup_old_data(self) -> None:
        """Clean up old conversation data"""
        # This could be implemented to remove very old conversations
        # For now, we rely on Redis TTL and list trimming
        pass
    
    async def log_agent_interaction(self, agent_name: str, interaction_type: str, data: Dict[str, Any]) -> None:
        """Log an agent interaction"""
        await self.shared_state.add_conversation(
            agent_name="observer",
            role="system",
            message=f"Agent {agent_name} performed {interaction_type}: {json.dumps(data)}"
        )
    
    async def get_system_summary(self) -> Dict[str, Any]:
        """Get a summary of system state"""
        states = await self.shared_state.get_all_agent_states()
        return {
            "timestamp": datetime.now().isoformat(),
            "active_agents": list(states.keys()),
            "agent_count": len(states),
            "observer_status": "active" if self._running else "inactive"
        }

