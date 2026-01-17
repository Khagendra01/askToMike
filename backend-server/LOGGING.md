# Logging Guide

This document describes the logging system for the multi-agent application.

## Overview

The application uses structured logging with different loggers for different components. Logs are color-coded and include timestamps, log levels, component names, and messages.

## Log Levels

- **DEBUG**: Detailed information for debugging
- **INFO**: General informational messages (default)
- **WARNING**: Warning messages for potential issues
- **ERROR**: Error messages for failures
- **CRITICAL**: Critical errors that may cause system failure

## Configuration

Set the log level using the `LOG_LEVEL` environment variable:

```bash
export LOG_LEVEL=DEBUG  # For detailed debugging
export LOG_LEVEL=INFO   # Default, general information
export LOG_LEVEL=WARNING # Only warnings and errors
```

## Logger Components

### Agent Loggers
- `agent.basic` - Basic communication agent
- `agent.linkedin` - LinkedIn posting agent
- `agent.slack` - Slack agent

### Service Loggers
- `service.shared_state` - Shared state operations
- `service.redis` - Redis operations
- `service.image` - Image generation

### System Loggers
- `router` - Agent routing decisions
- `observer` - Observer agent operations
- `agent` - Main agent entrypoint

## What Gets Logged

### Agent Operations
- User messages and agent responses
- Agent mode switches
- Tool/function calls with parameters
- Cross-agent data flow

### Router Operations
- Agent selection decisions
- Routing errors and fallbacks

### Shared State Operations
- State set/get operations
- Cross-agent data access
- Conversation history updates

### Tool Calls
- Function tool invocations
- Parameters (truncated for long values)
- Success/failure status

## Example Log Output

```
2024-01-03 12:34:56 | INFO     | router              | 🎯 Router selected: slack for message: 'Read the production channel...'
2024-01-03 12:34:56 | INFO     | agent.slack         | 🗣️  User: Read the production channel of Slack
2024-01-03 12:34:56 | INFO     | agent.slack         | 🔧 Tool call: read_slack_channel | params: channel=production
2024-01-03 12:34:56 | INFO     | agent.slack         | 📖 Reading Slack channel: production (mocked)
2024-01-03 12:34:56 | INFO     | service.shared_state| ✅ Shared state set: key='slack:channel:production' by agent='slack'
2024-01-03 12:34:56 | INFO     | agent.slack         | 💾 Stored 3 messages from #production in shared state for cross-agent access
2024-01-03 12:34:57 | INFO     | router              | 🎯 Router selected: linkedin for message: 'Help me write a LinkedIn post...'
2024-01-03 12:34:57 | INFO     | router              | 🔄 Agent switch: slack → linkedin (reason: User intent: Help me write...)
2024-01-03 12:34:57 | INFO     | agent.linkedin      | 🗣️  User: Help me write a LinkedIn post based on that
2024-01-03 12:34:57 | INFO     | agent.linkedin      | 🔧 Tool call: get_slack_channel_data | params: channel=None
2024-01-03 12:34:57 | INFO     | observer            | 📊 Data flow: slack → linkedin | type=channel_messages | key=last_read
2024-01-03 12:34:57 | INFO     | agent.linkedin      | 📊 Retrieving Slack channel data: last_read
2024-01-03 12:34:57 | INFO     | agent.linkedin      | ✅ Retrieved 3 messages from Slack channel #production
```

## Key Log Patterns

### Agent Switching
```
🔄 Agent switch: {from} → {to} (reason: {reason})
```

### Tool Calls
```
🔧 Tool call: {tool_name} | params: {params}
```

### Cross-Agent Data Flow
```
📊 Data flow: {from_agent} → {to_agent} | type={data_type} | key={key}
```

### Shared State Operations
```
✅ Shared state {operation}: key='{key}' by agent='{agent}'
```

## Tips for Testing

1. **Set LOG_LEVEL=DEBUG** for maximum visibility during development
2. **Watch for agent switches** - Shows when the router changes agents
3. **Monitor shared state operations** - See when data is stored/retrieved
4. **Check cross-agent data flow** - Verify data flows between agents
5. **Look for tool calls** - See what functions are being called

## Log File Output (Future)

Currently logs go to stdout. To save logs to a file, you can redirect:

```bash
python server.py > logs/app.log 2>&1
```

Or use a logging handler to write to files (can be added if needed).





