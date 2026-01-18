"""
Arize AX Tracing Service

Provides full observability for the voice agent including:
- LLM call tracing (automatic via LangChainInstrumentor)
- Custom workflow spans (LangGraph workflow stages)
- LiveKit session context (room, participant, session)
- Tool call tracing
- Cost and latency tracking
"""

import os
import logging
from typing import Optional, Dict, Any
from contextlib import contextmanager
from functools import wraps

logger = logging.getLogger(__name__)

# Global tracer instance
_tracer = None
_tracer_provider = None
_arize_enabled = False


def init_arize_tracing(project_name: str = "delegate-voice-agent") -> bool:
    """
    Initialize Arize AX tracing using HTTP/OTLP (more reliable than gRPC).
    
    Returns True if successfully initialized, False otherwise.
    
    Environment variables:
    - ARIZE_SPACE_ID: Your Arize space ID (required)
    - ARIZE_API_KEY: Your Arize API key (required)  
    - ARIZE_ENABLED: Set to "false" to disable tracing (optional)
    """
    global _tracer, _tracer_provider, _arize_enabled
    
    # Check if explicitly disabled
    if os.getenv("ARIZE_ENABLED", "true").lower() == "false":
        logger.info("⚠️ Arize AX tracing disabled (ARIZE_ENABLED=false)")
        return False
    
    space_id = os.getenv("ARIZE_SPACE_ID")
    api_key = os.getenv("ARIZE_API_KEY")
    
    if not space_id or not api_key:
        logger.info("⚠️ Arize AX not configured (missing ARIZE_SPACE_ID or ARIZE_API_KEY)")
        return False
    
    # Validate credentials format
    if len(space_id) < 10:
        logger.warning(f"⚠️ ARIZE_SPACE_ID looks too short ({len(space_id)} chars). Check your .env file.")
    if len(api_key) < 10:
        logger.warning(f"⚠️ ARIZE_API_KEY looks too short ({len(api_key)} chars). Check your .env file.")
    
    try:
        # Try the newer HTTP-based approach first (more reliable)
        try:
            from opentelemetry import trace
            from opentelemetry.sdk.trace import TracerProvider
            from opentelemetry.sdk.trace.export import BatchSpanProcessor
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
            from opentelemetry.sdk.resources import Resource
            from openinference.instrumentation.langchain import LangChainInstrumentor
            
            logger.info("🔄 Connecting to Arize AX (HTTP/OTLP)...")
            logger.info(f"   Space ID: {space_id[:8]}...{space_id[-4:] if len(space_id) > 12 else ''}")
            logger.info(f"   API Key: {api_key[:8]}...{api_key[-4:] if len(api_key) > 12 else ''}")
            
            # Create resource with required Arize attributes
            # Arize requires 'arize.project.name' or 'model_id' attribute
            resource = Resource.create({
                "service.name": project_name,
                "arize.project.name": project_name,  # Required by Arize AX
                "model_id": project_name,  # Alternative attribute Arize accepts
            })
            
            # Create OTLP HTTP exporter for Arize with longer timeout
            # Default is 10s which can cause timeouts; increase to 30s for reliability
            otlp_exporter = OTLPSpanExporter(
                endpoint="https://otlp.arize.com/v1/traces",
                headers={
                    "space_id": space_id,
                    "api_key": api_key,
                },
                timeout=30,  # 30 second timeout (default is 10s)
            )
            
            # Create and set tracer provider
            _tracer_provider = TracerProvider(resource=resource)
            _tracer_provider.add_span_processor(BatchSpanProcessor(otlp_exporter))
            trace.set_tracer_provider(_tracer_provider)
            
            # Auto-instrument LangChain (covers LangGraph)
            LangChainInstrumentor().instrument(tracer_provider=_tracer_provider)
            
            # Try to instrument OpenAI if available
            try:
                from openinference.instrumentation.openai import OpenAIInstrumentor
                OpenAIInstrumentor().instrument(tracer_provider=_tracer_provider)
                logger.info("   ✅ OpenAI instrumentation enabled")
            except Exception:
                pass
            
            # Get tracer for custom spans
            _tracer = _tracer_provider.get_tracer("delegate.agent")
            _arize_enabled = True
            
            logger.info("=" * 60)
            logger.info("✅ ARIZE AX TRACING ENABLED (HTTP/OTLP)")
            logger.info(f"   Project: {project_name}")
            logger.info(f"   Endpoint: https://otlp.arize.com/v1/traces")
            logger.info("   Features:")
            logger.info("   - LangGraph/LangChain auto-instrumentation")
            logger.info("   - Custom workflow spans")
            logger.info("   - LiveKit session context")
            logger.info("   - Tool call tracing")
            logger.info("=" * 60)
            
            return True
            
        except ImportError:
            # Fall back to arize.otel if HTTP exporter not available
            logger.info("   Falling back to arize.otel (gRPC)...")
            from arize.otel import register
            from openinference.instrumentation.langchain import LangChainInstrumentor
            
            _tracer_provider = register(
                space_id=space_id,
                api_key=api_key,
                project_name=project_name,
            )
            
            LangChainInstrumentor().instrument(tracer_provider=_tracer_provider)
            _tracer = _tracer_provider.get_tracer("delegate.agent")
            _arize_enabled = True
            
            logger.info("=" * 60)
            logger.info("✅ ARIZE AX TRACING ENABLED (gRPC)")
            logger.info(f"   Project: {project_name}")
            logger.info("=" * 60)
            
            return True
        
    except ImportError as e:
        logger.warning(f"⚠️ Arize AX dependencies not installed: {e}")
        logger.warning("   Run: pip install arize-otel openinference-instrumentation-langchain opentelemetry-exporter-otlp-proto-http")
        return False
    except Exception as e:
        logger.error(f"❌ Failed to initialize Arize AX: {e}", exc_info=True)
        return False


def is_arize_enabled() -> bool:
    """Check if Arize tracing is enabled"""
    return _arize_enabled


def get_tracer():
    """Get the Arize tracer instance"""
    return _tracer


# =============================================================================
# Custom Span Helpers
# =============================================================================

@contextmanager
def trace_livekit_session(session_id: str, room_name: str, participant_id: str = None):
    """
    Create a parent span for an entire LiveKit session.
    
    Usage:
        with trace_livekit_session(session_id, room_name) as session_span:
            # ... session code ...
    """
    if not _arize_enabled or not _tracer:
        yield None
        return
    
    with _tracer.start_as_current_span("livekit.session") as span:
        span.set_attribute("livekit.session_id", session_id)
        span.set_attribute("livekit.room", room_name)
        if participant_id:
            span.set_attribute("livekit.participant_id", participant_id)
        span.set_attribute("agent.type", "voice")
        yield span


@contextmanager
def trace_conversation_turn(
    session_id: str,
    turn_number: int,
    user_text: str,
    agent_mode: str = "basic"
):
    """
    Create a span for a single conversation turn (user input → agent response).
    
    Usage:
        with trace_conversation_turn(session_id, turn, user_text) as turn_span:
            # ... process turn ...
            turn_span.set_attribute("output.assistant_text", response)
    """
    if not _arize_enabled or not _tracer:
        yield None
        return
    
    with _tracer.start_as_current_span("agent.turn") as span:
        span.set_attribute("session.id", session_id)
        span.set_attribute("turn.number", turn_number)
        span.set_attribute("input.user_text", user_text[:1000])  # Truncate long inputs
        span.set_attribute("agent.mode", agent_mode)
        yield span


@contextmanager
def trace_workflow(
    workflow_name: str,
    session_id: str,
    initial_input: str = None
):
    """
    Create a span for a LangGraph workflow execution.
    
    Usage:
        with trace_workflow("linkedin_post", session_id, topic) as wf_span:
            # ... workflow code ...
    """
    if not _arize_enabled or not _tracer:
        yield None
        return
    
    with _tracer.start_as_current_span(f"workflow.{workflow_name}") as span:
        span.set_attribute("workflow.name", workflow_name)
        span.set_attribute("session.id", session_id)
        if initial_input:
            span.set_attribute("workflow.input", initial_input[:500])
        yield span


@contextmanager
def trace_workflow_node(
    node_name: str,
    workflow_name: str,
    stage: str = None,
    metadata: Dict[str, Any] = None
):
    """
    Create a span for a specific workflow node execution.
    
    Usage:
        with trace_workflow_node("draft_post", "linkedin", stage="drafting") as node_span:
            # ... node code ...
    """
    if not _arize_enabled or not _tracer:
        yield None
        return
    
    with _tracer.start_as_current_span(f"workflow.node.{node_name}") as span:
        span.set_attribute("workflow.node", node_name)
        span.set_attribute("workflow.name", workflow_name)
        if stage:
            span.set_attribute("workflow.stage", stage)
        if metadata:
            for key, value in metadata.items():
                if isinstance(value, (str, int, float, bool)):
                    span.set_attribute(f"workflow.{key}", value)
        yield span


@contextmanager
def trace_tool_call(
    tool_name: str,
    agent_mode: str,
    parameters: Dict[str, Any] = None
):
    """
    Create a span for a tool/function call.
    
    Usage:
        with trace_tool_call("post_to_linkedin", "linkedin", {"post_length": 100}) as tool_span:
            # ... tool execution ...
            tool_span.set_attribute("tool.result", "success")
    """
    if not _arize_enabled or not _tracer:
        yield None
        return
    
    with _tracer.start_as_current_span(f"tool.{tool_name}") as span:
        span.set_attribute("tool.name", tool_name)
        span.set_attribute("agent.mode", agent_mode)
        if parameters:
            for key, value in parameters.items():
                if isinstance(value, (str, int, float, bool)):
                    span.set_attribute(f"tool.param.{key}", value)
        yield span


@contextmanager
def trace_llm_call(
    model: str,
    purpose: str,
    prompt_preview: str = None
):
    """
    Create a span for a direct LLM call (non-LangChain).
    
    Note: LangChain/LangGraph LLM calls are auto-instrumented.
    Use this for direct API calls outside of LangChain.
    """
    if not _arize_enabled or not _tracer:
        yield None
        return
    
    with _tracer.start_as_current_span("llm.call") as span:
        span.set_attribute("llm.model", model)
        span.set_attribute("llm.purpose", purpose)
        if prompt_preview:
            span.set_attribute("llm.prompt_preview", prompt_preview[:200])
        yield span


def record_workflow_completion(
    workflow_name: str,
    session_id: str,
    success: bool,
    final_stage: str,
    output_preview: str = None,
    metadata: Dict[str, Any] = None
):
    """
    Record a workflow completion event as a span.
    
    Call this when a workflow finishes (success or failure).
    """
    if not _arize_enabled or not _tracer:
        return
    
    with _tracer.start_as_current_span(f"workflow.complete.{workflow_name}") as span:
        span.set_attribute("workflow.name", workflow_name)
        span.set_attribute("session.id", session_id)
        span.set_attribute("workflow.success", success)
        span.set_attribute("workflow.final_stage", final_stage)
        if output_preview:
            span.set_attribute("workflow.output_preview", output_preview[:500])
        if metadata:
            for key, value in metadata.items():
                if isinstance(value, (str, int, float, bool)):
                    span.set_attribute(f"workflow.{key}", value)


def record_livekit_metrics(
    session_id: str,
    room_name: str,
    metrics_data: Dict[str, Any]
):
    """
    Record LiveKit metrics as a span.
    
    Call this when LiveKit emits metrics events.
    """
    if not _arize_enabled or not _tracer:
        return
    
    with _tracer.start_as_current_span("livekit.metrics") as span:
        span.set_attribute("livekit.session_id", session_id)
        span.set_attribute("livekit.room", room_name)
        # Add metrics as attributes (flatten if needed)
        for key, value in metrics_data.items():
            if isinstance(value, (str, int, float, bool)):
                span.set_attribute(f"livekit.metric.{key}", value)
            elif isinstance(value, dict):
                for sub_key, sub_value in value.items():
                    if isinstance(sub_value, (str, int, float, bool)):
                        span.set_attribute(f"livekit.metric.{key}.{sub_key}", sub_value)


def record_error(
    error_type: str,
    error_message: str,
    context: Dict[str, Any] = None
):
    """
    Record an error event as a span.
    """
    if not _arize_enabled or not _tracer:
        return
    
    with _tracer.start_as_current_span("error") as span:
        span.set_attribute("error.type", error_type)
        span.set_attribute("error.message", error_message[:500])
        if context:
            for key, value in context.items():
                if isinstance(value, (str, int, float, bool)):
                    span.set_attribute(f"error.context.{key}", value)


# =============================================================================
# Decorator for easy function tracing
# =============================================================================

def trace_function(span_name: str = None, attributes: Dict[str, Any] = None):
    """
    Decorator to trace a function execution.
    
    Usage:
        @trace_function("my_function", {"custom": "attribute"})
        async def my_function():
            ...
    """
    def decorator(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            if not _arize_enabled or not _tracer:
                return await func(*args, **kwargs)
            
            name = span_name or f"function.{func.__name__}"
            with _tracer.start_as_current_span(name) as span:
                span.set_attribute("function.name", func.__name__)
                if attributes:
                    for key, value in attributes.items():
                        span.set_attribute(key, value)
                try:
                    result = await func(*args, **kwargs)
                    span.set_attribute("function.success", True)
                    return result
                except Exception as e:
                    span.set_attribute("function.success", False)
                    span.set_attribute("function.error", str(e)[:200])
                    raise
        
        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            if not _arize_enabled or not _tracer:
                return func(*args, **kwargs)
            
            name = span_name or f"function.{func.__name__}"
            with _tracer.start_as_current_span(name) as span:
                span.set_attribute("function.name", func.__name__)
                if attributes:
                    for key, value in attributes.items():
                        span.set_attribute(key, value)
                try:
                    result = func(*args, **kwargs)
                    span.set_attribute("function.success", True)
                    return result
                except Exception as e:
                    span.set_attribute("function.success", False)
                    span.set_attribute("function.error", str(e)[:200])
                    raise
        
        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper
    
    return decorator
