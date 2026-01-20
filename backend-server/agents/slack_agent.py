"""
Slack Agent (Mocked)

Mocked Slack agent for sending messages, reading channels, etc.
This is a demonstration agent with mock functionality.
"""

import asyncio

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from livekit.agents import Agent, llm, function_tool, RunContext
from utils.logger import get_agent_logger, log_tool_call

logger = get_agent_logger("slack")


class SlackAgent(Agent):
    """Slack agent with mocked functionality"""
    
    def __init__(self, *args, shared_state=None, config=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._shared_state = shared_state
        self._config = config
        self._agent_name = "slack"
        # Mock data - realistic Slack workspace
        self._mock_channels = [
            {"id": "C001", "name": "general", "unread": 3},
            {"id": "C002", "name": "random", "unread": 7},
            {"id": "C003", "name": "engineering", "unread": 12},
            {"id": "C004", "name": "announcements", "unread": 1},
            {"id": "C005", "name": "production", "unread": 8},
            {"id": "C006", "name": "design", "unread": 2},
            {"id": "C007", "name": "sales", "unread": 0},
            {"id": "C008", "name": "support-escalations", "unread": 3},
        ]
        self._mock_messages = {
            "C001": [  # general
                {"user": "Sarah Chen", "text": "Hey everyone! Quick reminder: all-hands meeting at 2pm PST today. We'll be covering Q1 roadmap and the new product launch.", "timestamp": "2026-01-18T09:15:00Z"},
                {"user": "Marcus Johnson", "text": "Thanks Sarah! Will there be a recording for folks in APAC?", "timestamp": "2026-01-18T09:18:00Z"},
                {"user": "Sarah Chen", "text": "Yes! Recording will be posted in #announcements within 24 hours", "timestamp": "2026-01-18T09:20:00Z"},
                {"user": "Priya Sharma", "text": "Can someone share the Zoom link? I can't find the calendar invite", "timestamp": "2026-01-18T09:45:00Z"},
                {"user": "David Kim", "text": "Just sent it to you in DM, Priya!", "timestamp": "2026-01-18T09:47:00Z"},
            ],
            "C002": [  # random
                {"user": "Jake Morrison", "text": "Anyone else's coffee machine broken on the 3rd floor? Had to walk all the way to 5th for my morning fix", "timestamp": "2026-01-18T08:30:00Z"},
                {"user": "Emma Wilson", "text": "Facilities said they're getting a new one next week. RIP old faithful", "timestamp": "2026-01-18T08:35:00Z"},
                {"user": "Carlos Rodriguez", "text": "There's a great coffee shop on the corner of 5th and Main. Their cold brew is amazing", "timestamp": "2026-01-18T08:42:00Z"},
                {"user": "Jake Morrison", "text": "Ooh thanks for the tip! Might check it out during lunch", "timestamp": "2026-01-18T08:45:00Z"},
                {"user": "Nina Patel", "text": "Speaking of lunch, anyone want to grab tacos? That new place on Market St has great reviews", "timestamp": "2026-01-18T11:30:00Z"},
                {"user": "Emma Wilson", "text": "I'm in! 12:30?", "timestamp": "2026-01-18T11:32:00Z"},
                {"user": "Carlos Rodriguez", "text": "Count me in too", "timestamp": "2026-01-18T11:33:00Z"},
            ],
            "C003": [  # engineering
                {"user": "Alex Thompson", "text": "PR #1247 is ready for review - it's the auth service refactor we discussed. Would appreciate eyes on it before EOD", "timestamp": "2026-01-18T10:00:00Z"},
                {"user": "Rachel Green", "text": "I'll take a look after standup. How big is the diff?", "timestamp": "2026-01-18T10:05:00Z"},
                {"user": "Alex Thompson", "text": "About 800 lines, but 400 of that is tests. Core changes are pretty contained", "timestamp": "2026-01-18T10:07:00Z"},
                {"user": "Wei Zhang", "text": "Heads up: I'm seeing some flaky tests in the CI pipeline for the payments module. Investigating now", "timestamp": "2026-01-18T10:30:00Z"},
                {"user": "Jordan Lee", "text": "Is it the Stripe webhook test? That one's been timing out intermittently", "timestamp": "2026-01-18T10:32:00Z"},
                {"user": "Wei Zhang", "text": "Yep, exactly that one. I think we need to increase the timeout or mock the external call", "timestamp": "2026-01-18T10:35:00Z"},
                {"user": "Rachel Green", "text": "@Alex Thompson reviewed! Left a few comments but overall looks solid. Nice work on the test coverage", "timestamp": "2026-01-18T14:20:00Z"},
                {"user": "Alex Thompson", "text": "Thanks Rachel! Addressing comments now", "timestamp": "2026-01-18T14:25:00Z"},
                {"user": "Mike Chen", "text": "Anyone available to pair on the GraphQL migration? Running into some N+1 query issues", "timestamp": "2026-01-18T15:00:00Z"},
                {"user": "Jordan Lee", "text": "I can hop on in 30 mins. DataLoader should fix that - done it before", "timestamp": "2026-01-18T15:05:00Z"},
                {"user": "Mike Chen", "text": "Perfect, I'll set up a huddle", "timestamp": "2026-01-18T15:06:00Z"},
                {"user": "DevOps Bot", "text": "Build #4521 passed. Deployed to staging environment successfully.", "timestamp": "2026-01-18T15:45:00Z"},
            ],
            "C004": [  # announcements
                {"user": "CEO - Lisa Park", "text": "Excited to announce we've closed our Series B! $45M led by Sequoia. This is a huge milestone for the team. More details in the all-hands today, but wanted to share the news here first. Thank you all for your incredible work!", "timestamp": "2026-01-18T08:00:00Z"},
                {"user": "HR - Amanda Foster", "text": "Reminder: Performance reviews are due by end of month. Please complete your self-assessments in Lattice. Reach out if you have any questions!", "timestamp": "2026-01-17T14:00:00Z"},
            ],
            "C005": [  # production - release and deployment channel
                {"user": "GitHub Actions", "text": "Release v2.4.0 tagged and build started. Changelog: https://github.com/company/app/releases/tag/v2.4.0", "timestamp": "2026-01-18T06:00:00Z"},
                {"user": "GitHub Actions", "text": "v2.4.0 build completed. Docker image pushed to ECR: company/app:v2.4.0 (sha256:a1b2c3d4...)", "timestamp": "2026-01-18T06:12:00Z"},
                {"user": "Release Manager - Derek Stone", "text": "Starting staged rollout for v2.4.0. Plan: 5% canary -> 25% -> 50% -> 100%. ETA for full rollout: ~4 hours", "timestamp": "2026-01-18T06:30:00Z"},
                {"user": "ArgoCD", "text": "Deployment started: app-production-canary (5% traffic). Image: company/app:v2.4.0. Replicas: 2/2 ready", "timestamp": "2026-01-18T06:32:00Z"},
                {"user": "Datadog", "text": "Canary metrics (15 min): p99 latency 145ms (baseline: 142ms), error rate 0.08% (baseline: 0.09%). No anomalies detected.", "timestamp": "2026-01-18T06:50:00Z"},
                {"user": "Release Manager - Derek Stone", "text": "Canary looks healthy. Proceeding to 25% rollout.", "timestamp": "2026-01-18T07:00:00Z"},
                {"user": "ArgoCD", "text": "Deployment updated: app-production (25% traffic). Replicas: 8/8 ready. Old pods terminating.", "timestamp": "2026-01-18T07:02:00Z"},
                {"user": "PagerDuty", "text": "ALERT: Elevated 5xx errors detected on /api/v2/checkout endpoint. Error rate: 2.1% (threshold: 1%). Triggered by: anomaly detection", "timestamp": "2026-01-18T07:15:00Z"},
                {"user": "On-Call - Sarah Mitchell", "text": "Investigating the checkout errors. Checking if it's related to the v2.4.0 rollout.", "timestamp": "2026-01-18T07:17:00Z"},
                {"user": "On-Call - Sarah Mitchell", "text": "Found the issue - v2.4.0 has a regression in the new payment validation logic. Initiating rollback to v2.3.2.", "timestamp": "2026-01-18T07:25:00Z"},
                {"user": "ArgoCD", "text": "Rollback initiated: app-production reverting to company/app:v2.3.2. Reason: manual trigger by sarah.mitchell", "timestamp": "2026-01-18T07:26:00Z"},
                {"user": "ArgoCD", "text": "Rollback completed: app-production now running v2.3.2. All 32 replicas healthy.", "timestamp": "2026-01-18T07:30:00Z"},
                {"user": "PagerDuty", "text": "RESOLVED: 5xx errors on /api/v2/checkout returned to normal (0.05%). Duration: 15 minutes.", "timestamp": "2026-01-18T07:32:00Z"},
                {"user": "On-Call - Sarah Mitchell", "text": "Rollback successful. Error rate back to baseline. Created incident report: INC-2847. Root cause: missing null check in PaymentValidator.validateCard() - PR #1892 introduced the bug.", "timestamp": "2026-01-18T07:45:00Z"},
                {"user": "Engineering - Alex Thompson", "text": "Hotfix PR ready: #1901 - Fix null pointer in PaymentValidator. Includes regression test. @derek.stone can we fast-track review?", "timestamp": "2026-01-18T09:30:00Z"},
                {"user": "Release Manager - Derek Stone", "text": "Reviewed and approved #1901. Merging now. Will cut v2.4.1 hotfix release.", "timestamp": "2026-01-18T09:45:00Z"},
                {"user": "GitHub Actions", "text": "Release v2.4.1 tagged (hotfix). Build started. Changes: Fix PaymentValidator null check (#1901)", "timestamp": "2026-01-18T09:50:00Z"},
                {"user": "GitHub Actions", "text": "v2.4.1 build completed. Docker image pushed: company/app:v2.4.1", "timestamp": "2026-01-18T10:02:00Z"},
                {"user": "Release Manager - Derek Stone", "text": "Starting v2.4.1 rollout. Given the hotfix nature, going with extended canary (10% for 30 min) before wider rollout.", "timestamp": "2026-01-18T10:15:00Z"},
                {"user": "ArgoCD", "text": "Deployment started: app-production-canary (10% traffic). Image: company/app:v2.4.1", "timestamp": "2026-01-18T10:17:00Z"},
                {"user": "Datadog", "text": "v2.4.1 canary metrics (30 min): p99 latency 140ms, error rate 0.04%, checkout success rate 99.2%. All metrics within baseline.", "timestamp": "2026-01-18T10:50:00Z"},
                {"user": "Release Manager - Derek Stone", "text": "v2.4.1 canary healthy. Proceeding with full rollout.", "timestamp": "2026-01-18T11:00:00Z"},
                {"user": "ArgoCD", "text": "Deployment completed: app-production now running v2.4.1. 32/32 replicas ready. Rollout took 12m 34s.", "timestamp": "2026-01-18T11:15:00Z"},
                {"user": "Release Manager - Derek Stone", "text": "v2.4.1 fully deployed to production. Monitoring for the next hour. Thanks @sarah.mitchell for the quick incident response and @alex.thompson for the fast hotfix!", "timestamp": "2026-01-18T11:20:00Z"},
            ],
            "C006": [  # design
                {"user": "Olivia Martinez", "text": "Just uploaded the new onboarding flow mockups to Figma. Would love feedback before I start on the prototype: https://figma.com/file/abc123", "timestamp": "2026-01-18T09:00:00Z"},
                {"user": "Tom Bradley", "text": "These look great! One thought - can we simplify step 3? Feels like a lot of form fields for a first-time user", "timestamp": "2026-01-18T10:15:00Z"},
                {"user": "Olivia Martinez", "text": "Good call. I'll explore a progressive disclosure approach - show basics first, advanced options later", "timestamp": "2026-01-18T10:30:00Z"},
                {"user": "Product - Kevin Nguyen", "text": "Love the direction! This aligns well with the user research findings. The current onboarding has a 40% drop-off at step 3", "timestamp": "2026-01-18T11:00:00Z"},
            ],
            "C007": [  # sales
                {"user": "Jennifer Adams", "text": "Just closed Acme Corp - $250K ARR! They're starting with 500 seats and planning to expand to 2000 by Q3", "timestamp": "2026-01-17T16:30:00Z"},
                {"user": "Sales Manager - Robert Taylor", "text": "Amazing work Jennifer! That's our biggest deal this quarter. Team drinks on me Friday!", "timestamp": "2026-01-17T16:35:00Z"},
                {"user": "Chris Evans", "text": "Congrats Jen! Any tips on how you handled their security questionnaire? I'm stuck on one with GlobalTech", "timestamp": "2026-01-17T16:40:00Z"},
                {"user": "Jennifer Adams", "text": "Thanks all! @Chris Evans I'll DM you - had to loop in our security team for a few items but they were super helpful", "timestamp": "2026-01-17T16:45:00Z"},
            ],
            "C008": [  # support-escalations
                {"user": "Support - Maria Garcia", "text": "ESCALATION: Enterprise customer (TechFlow Inc) reporting data sync issues. They're unable to export reports for the past 2 hours. Ticket #45892", "timestamp": "2026-01-18T13:00:00Z"},
                {"user": "Engineering - Wei Zhang", "text": "Looking into it now. Can you confirm which data center they're on?", "timestamp": "2026-01-18T13:05:00Z"},
                {"user": "Support - Maria Garcia", "text": "They're on us-west-2. Account ID: TF-2847", "timestamp": "2026-01-18T13:07:00Z"},
                {"user": "Engineering - Wei Zhang", "text": "Found it - there was a stuck job in the export queue. Cleared it and their exports are processing now. Should be fully resolved in ~10 mins", "timestamp": "2026-01-18T13:25:00Z"},
                {"user": "Support - Maria Garcia", "text": "Confirmed working on their end. Thanks for the quick turnaround Wei!", "timestamp": "2026-01-18T13:40:00Z"},
            ],
        }
    
    async def on_agent_speech_committed(self, message: llm.ChatMessage):
        """Log agent speech"""
        logger.info(f"💬 Agent: {message.text_content}")
    
    async def on_user_speech_committed(self, message: llm.ChatMessage):
        """Log user speech"""
        logger.info(f"🗣️  User: {message.text_content}")
    
    async def _list_slack_channels_impl(self) -> str:
        """Implementation for listing Slack channels"""
        log_tool_call("list_slack_channels", self._agent_name)
        logger.info("📋 Listing Slack channels (mocked)")
        result = "Slack Channels:\n"
        for channel in self._mock_channels:
            unread = channel["unread"]
            unread_str = f" ({unread} unread)" if unread > 0 else ""
            result += f"- #{channel['name']}{unread_str}\n"
        
        return result
    
    @function_tool
    async def list_slack_channels(self, context: RunContext) -> str:
        """
        List all Slack channels with unread message counts.
        Returns a formatted list of channels.
        """
        return await self._list_slack_channels_impl()
    
    async def _read_slack_channel_impl(self, channel_name: str) -> str:
        """Implementation for reading Slack channel messages"""
        # Strip leading # if present (users often include it)
        channel_name = channel_name.lstrip("#")
        log_tool_call("read_slack_channel", self._agent_name, {"channel": channel_name})
        logger.info(f"📖 Reading Slack channel: {channel_name} (mocked)")
        
        # Find channel
        channel = next((c for c in self._mock_channels if c["name"] == channel_name), None)
        if not channel:
            return f"Channel #{channel_name} not found"
        
        # Get messages
        messages = self._mock_messages.get(channel["id"], [])
        if not messages:
            return f"No messages in #{channel_name}"
        
        result = f"Messages in #{channel_name}:\n"
        for msg in messages:
            result += f"[{msg['user']}]: {msg['text']}\n"
        
        return result
    
    @function_tool
    async def read_slack_channel(
        self, 
        context: RunContext,
        channel_name: str
    ) -> str:
        """
        Read messages from a Slack channel.
        
        Args:
            channel_name: Name of the channel to read (e.g., "general", "engineering")
        """
        return await self._read_slack_channel_impl(channel_name)
    
    async def _send_slack_message_impl(self, channel_name: str, message: str) -> str:
        """Implementation for sending Slack messages"""
        # Strip leading # if present (users often include it)
        channel_name = channel_name.lstrip("#")
        log_tool_call("send_slack_message", self._agent_name, {"channel": channel_name})
        logger.info(f"📤 Sending to #{channel_name}: {message[:100]}...")
        
        # Find channel
        channel = next((c for c in self._mock_channels if c["name"] == channel_name), None)
        if not channel:
            return f"Channel #{channel_name} not found"
        
        # Mock sending (in real implementation, this would call Slack API)
        await asyncio.sleep(0.1)  # Simulate network delay
        
        # Add to mock messages
        if channel["id"] not in self._mock_messages:
            self._mock_messages[channel["id"]] = []
        
        self._mock_messages[channel["id"]].append({
            "user": self._config.user_name if self._config else "User",
            "text": message,
            "timestamp": asyncio.get_event_loop().time()
        })
        
        logger.info(f"✅ Message sent to #{channel_name}")
        return f"Message sent to #{channel_name}: {message}"
    
    @function_tool
    async def send_slack_message(
        self,
        context: RunContext,
        channel_name: str,
        message: str
    ) -> str:
        """
        Send a message to a Slack channel.
        
        Args:
            channel_name: Name of the channel to send to
            message: The message text to send
        """
        return await self._send_slack_message_impl(channel_name, message)

