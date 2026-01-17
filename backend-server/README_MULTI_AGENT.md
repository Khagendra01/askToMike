# Multi-Agent System Architecture

This document describes the multi-agent system implementation for the LiveKit agent server.

## Architecture Overview

The system consists of:

1. **Basic Communication Agent** - Handles general conversation and basic tasks
2. **LinkedIn Post Agent** - Specialized agent for LinkedIn posting tasks
3. **Slack Agent** - Mocked Slack agent for team communication
4. **Agent Router** - Routes user requests to appropriate agents based on intent
5. **Shared State Service** - Enables cross-agent data sharing via Redis

## Components

### Basic Agent (`agents/basic_agent.py`)
- **Purpose**: General conversation and basic tasks
- **Capabilities**:
  - General Q&A
  - Basic assistance
  - Conversation context retrieval
  - User preferences access

### LinkedIn Agent (`agents/linkedin_agent.py`)
- **Purpose**: LinkedIn posting functionality
- **Capabilities**:
  - Post content to LinkedIn
  - Generate images for posts
  - Queue posts via Redis
  - Deduplication and cooldown management

### Slack Agent (`agents/slack_agent.py`)
- **Purpose**: Slack communication (mocked)
- **Capabilities**:
  - List Slack channels
  - Read channel messages
  - Send messages to channels
  - Mock data for demonstration

### Agent Router (`agents/agent_router.py`)
- **Purpose**: Routes user requests to appropriate agents
- **Mechanism**: Uses LLM to determine intent and select the right agent
- **Routing Logic**:
  - Analyzes user message
  - Determines intent (basic/linkedin/slack)
  - Creates appropriate agent instance
  - Returns system prompt for the agent

### Shared State Service (`services/shared_state.py`)
- **Purpose**: Redis-based shared state management
- **Features**:
  - State storage and retrieval
  - Conversation history
  - Context sharing
  - Agent state tracking

## How It Works

1. **Startup**:
   - Shared state service initializes Redis connection
   - All agents can access shared state directly

2. **User Interaction**:
   - User sends a message
   - Agent router analyzes the message using LLM
   - Router determines which agent should handle the request
   - Unified agent switches mode and delegates to appropriate functionality
   - Agent processes the request and responds

3. **State Sharing**:
   - All agents log conversations to shared state
   - Agents can retrieve context from shared state
   - Cross-agent data sharing enabled via Redis

## Usage

The system automatically routes requests:

- **General questions** → Basic Agent
- **LinkedIn mentions** → LinkedIn Agent
- **Slack mentions** → Slack Agent

The observer agent runs continuously in the background, ensuring data is always available across agents.

## File Structure

```
backend-server/
├── agents/
│   ├── __init__.py
│   ├── observer_agent.py      # Always-on observer
│   ├── basic_agent.py          # Basic communication
│   ├── linkedin_agent.py       # LinkedIn posting
│   ├── slack_agent.py          # Slack (mocked)
│   └── agent_router.py          # Routing logic
├── services/
│   └── shared_state.py         # Shared state service
├── agent.py                     # Main entrypoint
└── app.py                       # Application lifecycle
```

## Configuration

The system uses the same configuration as before. No additional configuration needed - the observer agent starts automatically.

## Future Enhancements

- Add more specialized agents
- Implement agent-to-agent communication
- Add agent performance monitoring
- Implement agent learning from shared state
- Add agent orchestration patterns

