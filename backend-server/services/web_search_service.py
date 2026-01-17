"""
Web Search Service

Handles web search using various providers (DuckDuckGo, Tavily, etc.).
"""

import os
import aiohttp
from typing import Optional, List, Dict, Any
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import Config


class WebSearchService:
    """Handles web search using various providers"""
    
    def __init__(self, config: Config):
        self.config = config
        self.tavily_api_key = os.getenv("TAVILY_API_KEY")
    
    async def search(
        self, 
        query: str, 
        max_results: int = 5,
        search_depth: str = "basic"
    ) -> Dict[str, Any]:
        """
        Search the web for information.
        
        Args:
            query: Search query
            max_results: Maximum number of results to return
            search_depth: Search depth ('basic' or 'advanced')
        
        Returns:
            Dictionary with search results containing:
            - results: List of search results with title, url, snippet
            - query: The search query used
            - provider: The provider used
        """
        # Try Tavily first if API key is available
        if self.tavily_api_key:
            result = await self._search_with_tavily(query, max_results, search_depth)
            if result:
                return result
        
        # Fallback to DuckDuckGo (no API key required)
        return await self._search_with_duckduckgo(query, max_results)
    
    async def _search_with_tavily(
        self, 
        query: str, 
        max_results: int,
        search_depth: str
    ) -> Optional[Dict[str, Any]]:
        """Search using Tavily API"""
        try:
            async with aiohttp.ClientSession() as session:
                url = "https://api.tavily.com/search"
                payload = {
                    "api_key": self.tavily_api_key,
                    "query": query,
                    "max_results": max_results,
                    "search_depth": search_depth,
                    "include_answer": True,
                    "include_images": False,
                    "include_raw_content": False
                }
                
                async with session.post(url, json=payload) as response:
                    if response.status == 200:
                        data = await response.json()
                        
                        results = []
                        for item in data.get("results", []):
                            results.append({
                                "title": item.get("title", ""),
                                "url": item.get("url", ""),
                                "snippet": item.get("content", "")[:500]  # Limit snippet length
                            })
                        
                        answer = data.get("answer", "")
                        
                        return {
                            "query": query,
                            "provider": "tavily",
                            "results": results,
                            "answer": answer,
                            "count": len(results)
                        }
                    else:
                        print(f"⚠️ Tavily API error: {response.status}")
                        return None
        except Exception as e:
            print(f"⚠️ Tavily search failed: {e}")
            return None
    
    async def _search_with_duckduckgo(
        self, 
        query: str, 
        max_results: int
    ) -> Dict[str, Any]:
        """Search using DuckDuckGo (no API key required)"""
        # Try using duckduckgo-search library if available (better results)
        try:
            import duckduckgo_search
            return await self._search_with_ddg_library(query, max_results)
        except ImportError:
            # Fallback to API-based search
            return await self._search_with_duckduckgo_api(query, max_results)
    
    async def _search_with_ddg_library(
        self,
        query: str,
        max_results: int
    ) -> Dict[str, Any]:
        """Search using duckduckgo-search Python library"""
        try:
            import asyncio
            from duckduckgo_search import DDGS
            
            # Run in thread to avoid blocking
            def search_sync():
                results = []
                with DDGS() as ddgs:
                    for result in ddgs.text(query, max_results=max_results):
                        results.append({
                            "title": result.get("title", ""),
                            "url": result.get("href", ""),
                            "snippet": result.get("body", "")[:500]
                        })
                return results
            
            results = await asyncio.to_thread(search_sync)
            
            return {
                "query": query,
                "provider": "duckduckgo",
                "results": results,
                "count": len(results)
            }
        except Exception as e:
            print(f"⚠️ DuckDuckGo library search failed: {e}")
            # Fallback to API
            return await self._search_with_duckduckgo_api(query, max_results)
    
    async def _search_with_duckduckgo_api(
        self,
        query: str,
        max_results: int
    ) -> Dict[str, Any]:
        """Search using DuckDuckGo API (fallback method)"""
        try:
            async with aiohttp.ClientSession() as session:
                # DuckDuckGo instant answer API
                url = "https://api.duckduckgo.com/"
                params = {
                    "q": query,
                    "format": "json",
                    "no_html": "1",
                    "skip_disambig": "1"
                }
                
                async with session.get(url, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        
                        results = []
                        
                        # Add instant answer if available
                        if data.get("AbstractText"):
                            results.append({
                                "title": data.get("Heading", "Instant Answer"),
                                "url": data.get("AbstractURL", ""),
                                "snippet": data.get("AbstractText", "")
                            })
                        
                        # Add related topics
                        for topic in data.get("RelatedTopics", [])[:max_results-1]:
                            if isinstance(topic, dict) and "Text" in topic:
                                title = topic.get("Text", "")
                                if " - " in title:
                                    title = title.split(" - ")[0]
                                else:
                                    title = title[:50]
                                
                                results.append({
                                    "title": title,
                                    "url": topic.get("FirstURL", ""),
                                    "snippet": topic.get("Text", "")[:500]
                                })
                        
                        return {
                            "query": query,
                            "provider": "duckduckgo",
                            "results": results[:max_results],
                            "count": len(results[:max_results])
                        }
                    else:
                        # Fallback: return empty results
                        return {
                            "query": query,
                            "provider": "duckduckgo",
                            "results": [],
                            "count": 0,
                            "error": f"HTTP {response.status}"
                        }
        except Exception as e:
            print(f"⚠️ DuckDuckGo API search failed: {e}")
            # Return empty results on error
            return {
                "query": query,
                "provider": "duckduckgo",
                "results": [],
                "count": 0,
                "error": str(e)
            }

