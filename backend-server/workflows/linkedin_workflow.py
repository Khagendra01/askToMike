"""
LinkedIn Posting Workflow using LangGraph

A state-machine workflow for the LinkedIn posting process:
1. Draft post content
2. Optionally generate image description
3. Get user confirmation
4. Execute post

This workflow can be called from the main agent to handle complex
multi-step LinkedIn posting interactions.
"""

import os
import asyncio
from typing import TypedDict, Optional, Literal, Annotated
from datetime import datetime

# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv()

from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from utils.logger import get_logger

# Import Arize tracing helpers (graceful fallback if not available)
try:
    from services.arize_tracing import (
        trace_workflow_node,
        record_workflow_completion,
        is_arize_enabled
    )
    _has_arize = True
except ImportError:
    _has_arize = False
    def trace_workflow_node(*args, **kwargs):
        from contextlib import contextmanager
        @contextmanager
        def noop():
            yield None
        return noop()
    def record_workflow_completion(*args, **kwargs):
        pass
    def is_arize_enabled():
        return False

logger = get_logger(__name__)


# =============================================================================
# State Definition
# =============================================================================

class LinkedInWorkflowState(TypedDict):
    """State for the LinkedIn posting workflow"""
    # Conversation history
    messages: Annotated[list, add_messages]
    
    # User's original request
    user_request: str
    
    # Draft post content
    draft_content: Optional[str]
    
    # Image description (if user wants an image)
    image_description: Optional[str]
    
    # Whether user has confirmed the post
    user_confirmed: bool
    
    # Whether user wants an image
    wants_image: bool
    
    # Current stage of the workflow
    stage: Literal["drafting", "reviewing", "image_review", "confirmed", "posted", "cancelled"]
    
    # Final result message
    result: Optional[str]
    
    # Error message if any
    error: Optional[str]


# =============================================================================
# Node Functions
# =============================================================================

def get_llm():
    """Get the LLM instance for the workflow"""
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY or GEMINI_API_KEY environment variable required")
    
    return ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        google_api_key=api_key,
        temperature=0.7,
    )


async def draft_post(state: LinkedInWorkflowState) -> LinkedInWorkflowState:
    """
    Draft the LinkedIn post based on user's request.
    This node generates initial post content.
    """
    logger.info(f"📝 Drafting LinkedIn post for: {state['user_request'][:50]}...")
    
    # Trace this workflow node
    with trace_workflow_node("draft_post", "linkedin", stage="drafting", metadata={
        "user_request_length": len(state['user_request'])
    }):
        llm = get_llm()
        
        system_prompt = """You are a LinkedIn content specialist. Create engaging, professional LinkedIn posts.

Guidelines:
- Keep posts concise but impactful (ideally 150-300 words)
- Use a conversational, authentic tone
- Include relevant hashtags (3-5 max)
- Add a call-to-action or question to encourage engagement
- Format with line breaks for readability

Generate ONLY the post content, nothing else."""

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"Create a LinkedIn post about: {state['user_request']}")
        ]
        
        try:
            response = await llm.ainvoke(messages)
            draft = response.content.strip()
            
            logger.info(f"✅ Draft created ({len(draft)} chars)")
            
            return {
                **state,
                "draft_content": draft,
                "stage": "reviewing",
                "messages": state["messages"] + [
                    AIMessage(content=f"Here's a draft for your LinkedIn post:\n\n{draft}\n\nWould you like me to make any changes, or is this good to post?")
                ]
            }
        except Exception as e:
            logger.error(f"❌ Error drafting post: {e}")
            return {
                **state,
                "error": f"Failed to draft post: {str(e)}",
                "stage": "cancelled"
            }


async def review_draft(state: LinkedInWorkflowState) -> LinkedInWorkflowState:
    """
    Handle user's review of the draft.
    Parse user feedback and determine next action.
    """
    logger.info(f"🔍 Processing user review...")
    
    # Get the last user message
    user_messages = [m for m in state["messages"] if isinstance(m, HumanMessage)]
    if not user_messages:
        return state
    
    last_user_message = user_messages[-1].content.lower()
    
    # Trace this workflow node
    with trace_workflow_node("review_draft", "linkedin", stage="reviewing", metadata={
        "user_feedback_length": len(last_user_message)
    }):
        llm = get_llm()
        
        # Determine user intent
        intent_prompt = f"""Analyze the user's response to a LinkedIn post draft and determine their intent.

User's response: "{last_user_message}"

Respond with EXACTLY one of these options:
- APPROVE: if user wants to post as-is (e.g., "yes", "looks good", "post it", "go ahead")
- EDIT: if user wants changes (e.g., "make it shorter", "add more details", "change the tone")
- ADD_IMAGE: if user wants to add an image (e.g., "add an image", "include a picture")
- CANCEL: if user wants to cancel (e.g., "nevermind", "cancel", "don't post")

Respond with only the single word."""

        try:
            response = await llm.ainvoke([HumanMessage(content=intent_prompt)])
            intent = response.content.strip().upper()
            
            logger.info(f"🎯 User intent detected: {intent}")
            
            if intent == "APPROVE":
                return {
                    **state,
                    "user_confirmed": True,
                    "stage": "confirmed"
                }
            elif intent == "ADD_IMAGE":
                return {
                    **state,
                    "wants_image": True,
                    "stage": "image_review",
                    "messages": state["messages"] + [
                        AIMessage(content="Great! What would you like the image to show? Please describe the image you'd like me to generate.")
                    ]
                }
            elif intent == "CANCEL":
                return {
                    **state,
                    "stage": "cancelled",
                    "result": "Post cancelled by user."
                }
            else:  # EDIT or unknown - revise the draft
                return await revise_draft(state, last_user_message)
                
        except Exception as e:
            logger.error(f"❌ Error in review: {e}")
            return {
                **state,
                "error": f"Error processing review: {str(e)}"
            }


async def revise_draft(state: LinkedInWorkflowState, feedback: str) -> LinkedInWorkflowState:
    """
    Revise the draft based on user feedback.
    """
    logger.info(f"✏️ Revising draft based on feedback: {feedback[:50]}...")
    
    # Trace this workflow node
    with trace_workflow_node("revise_draft", "linkedin", stage="revising", metadata={
        "feedback_length": len(feedback),
        "original_draft_length": len(state.get('draft_content', ''))
    }):
        llm = get_llm()
        
        revision_prompt = f"""Revise this LinkedIn post based on the user's feedback.

Current draft:
{state['draft_content']}

User's feedback: {feedback}

Generate ONLY the revised post content, nothing else."""

        try:
            response = await llm.ainvoke([HumanMessage(content=revision_prompt)])
            revised = response.content.strip()
            
            logger.info(f"✅ Draft revised ({len(revised)} chars)")
            
            return {
                **state,
                "draft_content": revised,
                "stage": "reviewing",
                "messages": state["messages"] + [
                    AIMessage(content=f"Here's the revised post:\n\n{revised}\n\nHow does this look? Ready to post, or would you like more changes?")
                ]
            }
        except Exception as e:
            logger.error(f"❌ Error revising draft: {e}")
            return {
                **state,
                "error": f"Failed to revise draft: {str(e)}"
            }


async def handle_image_request(state: LinkedInWorkflowState) -> LinkedInWorkflowState:
    """
    Handle image description from user.
    """
    logger.info(f"🖼️ Processing image request...")
    
    # Get the last user message as image description
    user_messages = [m for m in state["messages"] if isinstance(m, HumanMessage)]
    if not user_messages:
        return state
    
    image_desc = user_messages[-1].content
    
    # Trace this workflow node
    with trace_workflow_node("handle_image", "linkedin", stage="image_review", metadata={
        "has_existing_image_desc": state.get("image_description") is not None,
        "user_input_length": len(image_desc)
    }):
        # Check if user is confirming or providing description
        lower_desc = image_desc.lower()
        
        if state.get("image_description"):
            # User is responding to image confirmation
            if any(word in lower_desc for word in ["yes", "good", "perfect", "go ahead", "post"]):
                return {
                    **state,
                    "user_confirmed": True,
                    "stage": "confirmed"
                }
            elif any(word in lower_desc for word in ["no", "cancel", "nevermind", "skip"]):
                return {
                    **state,
                    "image_description": None,
                    "wants_image": False,
                    "stage": "reviewing",
                    "messages": state["messages"] + [
                        AIMessage(content=f"No problem! Here's your post without an image:\n\n{state['draft_content']}\n\nReady to post?")
                    ]
                }
            else:
                # User wants to change the image description
                return {
                    **state,
                    "image_description": image_desc,
                    "messages": state["messages"] + [
                        AIMessage(content=f"I'll generate an image showing: \"{image_desc}\"\n\nDoes this sound good? Say 'yes' to confirm or describe something different.")
                    ]
                }
        else:
            # First time providing image description
            return {
                **state,
                "image_description": image_desc,
                "messages": state["messages"] + [
                    AIMessage(content=f"I'll generate an image showing: \"{image_desc}\"\n\nYour post will be:\n\n{state['draft_content']}\n\nReady to post with this image? Say 'yes' to confirm.")
                ]
            }


async def execute_post(state: LinkedInWorkflowState) -> LinkedInWorkflowState:
    """
    Execute the LinkedIn post.
    This node is called when user confirms.
    Note: Actual posting is done by the calling agent via Redis queue.
    """
    logger.info(f"🚀 Post confirmed! Ready for execution.")
    
    # Trace this workflow node
    with trace_workflow_node("execute_post", "linkedin", stage="posting", metadata={
        "post_length": len(state.get('draft_content', '')),
        "has_image": state.get('image_description') is not None
    }):
        result_msg = f"✅ Your LinkedIn post is ready to be published!"
        if state.get("image_description"):
            result_msg += f"\n\n📝 Post: {state['draft_content'][:100]}...\n🖼️ Image: {state['image_description']}"
        else:
            result_msg += f"\n\n📝 Post: {state['draft_content'][:100]}..."
        
        # Record workflow completion
        record_workflow_completion(
            workflow_name="linkedin",
            session_id="workflow",  # Will be overridden by caller if available
            success=True,
            final_stage="posted",
            output_preview=state.get('draft_content', '')[:200],
            metadata={
                "has_image": state.get('image_description') is not None,
                "post_length": len(state.get('draft_content', ''))
            }
        )
        
        return {
            **state,
            "stage": "posted",
            "result": result_msg,
            "messages": state["messages"] + [
                AIMessage(content=result_msg)
            ]
        }


# =============================================================================
# Routing Functions
# =============================================================================

def route_after_draft(state: LinkedInWorkflowState) -> str:
    """Route after drafting - always go to review"""
    if state.get("error"):
        return END
    return "await_user_input"


def route_after_review(state: LinkedInWorkflowState) -> str:
    """Route based on review outcome"""
    if state.get("error"):
        return END
    
    stage = state.get("stage", "reviewing")
    
    if stage == "confirmed":
        return "execute_post"
    elif stage == "image_review":
        return "await_user_input"
    elif stage == "cancelled":
        return END
    else:  # Still reviewing
        return "await_user_input"


def route_after_image(state: LinkedInWorkflowState) -> str:
    """Route after image handling"""
    if state.get("error"):
        return END
    
    stage = state.get("stage", "image_review")
    
    if stage == "confirmed":
        return "execute_post"
    elif stage == "reviewing":
        return "await_user_input"
    else:
        return "await_user_input"


# =============================================================================
# Workflow Graph Builder
# =============================================================================

def build_linkedin_workflow() -> StateGraph:
    """
    Build the LinkedIn posting workflow graph.
    
    Flow:
    1. draft_post -> await_user_input
    2. await_user_input -> review_draft (when user responds)
    3. review_draft -> execute_post (if confirmed)
                    -> await_user_input (if needs revision)
                    -> handle_image (if wants image)
                    -> END (if cancelled)
    4. handle_image -> await_user_input (for confirmation)
                    -> execute_post (if confirmed)
    5. execute_post -> END
    """
    
    workflow = StateGraph(LinkedInWorkflowState)
    
    # Add nodes
    workflow.add_node("draft_post", draft_post)
    workflow.add_node("review_draft", review_draft)
    workflow.add_node("handle_image", handle_image_request)
    workflow.add_node("execute_post", execute_post)
    
    # Note: "await_user_input" is a special node that pauses for user input
    # In practice, this is handled by the calling code
    workflow.add_node("await_user_input", lambda state: state)  # Pass-through
    
    # Set entry point
    workflow.set_entry_point("draft_post")
    
    # Add edges
    workflow.add_conditional_edges(
        "draft_post",
        route_after_draft,
        {
            "await_user_input": "await_user_input",
            END: END
        }
    )
    
    workflow.add_conditional_edges(
        "review_draft",
        route_after_review,
        {
            "execute_post": "execute_post",
            "await_user_input": "await_user_input",
            END: END
        }
    )
    
    workflow.add_conditional_edges(
        "handle_image",
        route_after_image,
        {
            "execute_post": "execute_post",
            "await_user_input": "await_user_input",
        }
    )
    
    # Execute post always ends
    workflow.add_edge("execute_post", END)
    
    return workflow


# =============================================================================
# Workflow Runner Class
# =============================================================================

class LinkedInWorkflowRunner:
    """
    Runner class to manage LinkedIn workflow state and execution.
    
    Usage:
        runner = LinkedInWorkflowRunner()
        
        # Start workflow with user request
        response = await runner.start("Post about AI trends in 2026")
        
        # Continue with user feedback
        response = await runner.continue_with("Make it more casual")
        
        # Get final result when confirmed
        if runner.is_complete:
            post_content = runner.get_post_content()
            image_desc = runner.get_image_description()
    """
    
    def __init__(self):
        self.workflow = build_linkedin_workflow().compile()
        self.state: Optional[LinkedInWorkflowState] = None
        self._is_complete = False
    
    @property
    def is_complete(self) -> bool:
        """Check if workflow has completed"""
        return self._is_complete or (
            self.state and self.state.get("stage") in ["posted", "cancelled"]
        )
    
    @property
    def is_confirmed(self) -> bool:
        """Check if user confirmed the post"""
        return self.state and self.state.get("user_confirmed", False)
    
    @property
    def current_stage(self) -> str:
        """Get current workflow stage"""
        return self.state.get("stage", "unknown") if self.state else "not_started"
    
    def get_post_content(self) -> Optional[str]:
        """Get the final post content"""
        return self.state.get("draft_content") if self.state else None
    
    def get_image_description(self) -> Optional[str]:
        """Get the image description (if any)"""
        return self.state.get("image_description") if self.state else None
    
    def get_last_response(self) -> Optional[str]:
        """Get the last AI response message"""
        if not self.state:
            return None
        messages = self.state.get("messages", [])
        ai_messages = [m for m in messages if isinstance(m, AIMessage)]
        return ai_messages[-1].content if ai_messages else None
    
    def get_result(self) -> Optional[str]:
        """Get the final result message"""
        return self.state.get("result") if self.state else None
    
    def get_error(self) -> Optional[str]:
        """Get error message if any"""
        return self.state.get("error") if self.state else None
    
    async def start(self, user_request: str) -> str:
        """
        Start a new LinkedIn posting workflow.
        
        Args:
            user_request: The user's request for what to post
            
        Returns:
            The AI's response (draft post for review)
        """
        logger.info(f"🚀 Starting LinkedIn workflow: {user_request[:50]}...")
        
        initial_state: LinkedInWorkflowState = {
            "messages": [HumanMessage(content=user_request)],
            "user_request": user_request,
            "draft_content": None,
            "image_description": None,
            "user_confirmed": False,
            "wants_image": False,
            "stage": "drafting",
            "result": None,
            "error": None,
        }
        
        # Run until we hit await_user_input or END
        self.state = await self.workflow.ainvoke(initial_state)
        
        return self.get_last_response() or "I'm working on your post..."
    
    async def continue_with(self, user_message: str) -> str:
        """
        Continue the workflow with user's response.
        
        Args:
            user_message: The user's response/feedback
            
        Returns:
            The AI's next response
        """
        if not self.state:
            return "No active workflow. Please start a new post request."
        
        if self.is_complete:
            return self.get_result() or "Workflow already complete."
        
        logger.info(f"➡️ Continuing workflow with: {user_message[:50]}...")
        
        # Add user message to state
        self.state["messages"] = self.state["messages"] + [HumanMessage(content=user_message)]
        
        # Determine which node to run based on current stage
        stage = self.state.get("stage", "reviewing")
        
        if stage == "image_review":
            # Run image handling
            self.state = await handle_image_request(self.state)
            
            # Check if we should execute
            if self.state.get("stage") == "confirmed":
                self.state = await execute_post(self.state)
                self._is_complete = True
        else:
            # Run review
            self.state = await review_draft(self.state)
            
            # Check if we should execute
            if self.state.get("stage") == "confirmed":
                self.state = await execute_post(self.state)
                self._is_complete = True
            elif self.state.get("stage") == "cancelled":
                self._is_complete = True
        
        return self.get_last_response() or self.get_result() or "Processing..."
    
    def reset(self):
        """Reset the workflow runner for a new workflow"""
        self.state = None
        self._is_complete = False


# =============================================================================
# Convenience Functions
# =============================================================================

async def create_linkedin_post_workflow(user_request: str) -> LinkedInWorkflowRunner:
    """
    Create and start a new LinkedIn posting workflow.
    
    Args:
        user_request: What the user wants to post about
        
    Returns:
        A LinkedInWorkflowRunner instance with the workflow started
    """
    runner = LinkedInWorkflowRunner()
    await runner.start(user_request)
    return runner


# =============================================================================
# Example Usage / Testing
# =============================================================================

async def _test_workflow():
    """Test the workflow interactively"""
    print("=" * 60)
    print("LinkedIn Workflow Test")
    print("=" * 60)
    
    runner = LinkedInWorkflowRunner()
    
    # Start workflow
    response = await runner.start("Share insights about the future of AI agents in 2026")
    print(f"\n🤖 AI: {response}\n")
    
    # Simulate user interactions
    while not runner.is_complete:
        user_input = input("👤 You: ").strip()
        if not user_input:
            continue
        
        response = await runner.continue_with(user_input)
        print(f"\n🤖 AI: {response}\n")
        print(f"   [Stage: {runner.current_stage}]")
    
    print("\n" + "=" * 60)
    print("Workflow Complete!")
    print(f"  Confirmed: {runner.is_confirmed}")
    print(f"  Post: {runner.get_post_content()[:100] if runner.get_post_content() else 'None'}...")
    print(f"  Image: {runner.get_image_description() or 'None'}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(_test_workflow())
