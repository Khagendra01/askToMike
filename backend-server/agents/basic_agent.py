"""
Basic Communication Agent

Handles general conversation and basic tasks. This is the default agent
for general communication when no specific agent is needed.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from livekit.agents import Agent, llm, function_tool, RunContext
from utils.logger import get_agent_logger, log_tool_call

logger = get_agent_logger("basic")


class BasicAgent(Agent):
    """Basic communication agent for general conversation"""
    
    def __init__(self, *args, shared_state=None, config=None, web_search_service=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._shared_state = shared_state
        self._config = config
        self._web_search_service = web_search_service
        self._agent_name = "basic"
    
    async def on_agent_speech_committed(self, message: llm.ChatMessage):
        """Log agent speech"""
        logger.info(f"🤖 Agent: {message.text_content}")
    
    async def on_user_speech_committed(self, message: llm.ChatMessage):
        """Log user speech"""
        logger.info(f"🗣️  User: {message.text_content}")
    
    
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
        log_tool_call("search_web", self._agent_name, {
            "query": query,
            "max_results": max_results
        })
        logger.info(f"🔍 Web search: {query}")
        
        if not self._web_search_service:
            return "Web search service is not available. Please configure TAVILY_API_KEY for better results, or the service will use DuckDuckGo."
        
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
            
            logger.info(f"✅ Found {len(results)} results")
            return result_text
            
        except Exception as e:
            logger.error(f"❌ Web search error: {e}", exc_info=True)
            return f"Error performing web search: {str(e)}"

