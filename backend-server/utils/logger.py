"""
Logging Configuration

Centralized logging setup for the multi-agent system.
Provides structured logging with different loggers for different components.
"""

import logging
import sys
from datetime import datetime
from typing import Optional

# Track if logging has been set up to prevent duplicate handlers
_logging_initialized = False


class ColoredFormatter(logging.Formatter):
    """Custom formatter with colors for different log levels"""
    
    # ANSI color codes
    COLORS = {
        'DEBUG': '\033[36m',      # Cyan
        'INFO': '\033[32m',       # Green
        'WARNING': '\033[33m',    # Yellow
        'ERROR': '\033[31m',      # Red
        'CRITICAL': '\033[35m',   # Magenta
    }
    RESET = '\033[0m'
    
    def format(self, record):
        # Add color to levelname
        if record.levelname in self.COLORS:
            record.levelname = f"{self.COLORS[record.levelname]}{record.levelname}{self.RESET}"
        
        return super().format(record)


def setup_logging(level: int = logging.INFO, use_colors: bool = True) -> None:
    """
    Setup logging configuration for the application.
    
    Args:
        level: Logging level (default: INFO)
        use_colors: Whether to use colored output (default: True)
    """
    # Get root logger
    root_logger = logging.getLogger()
    
    # Check if we already have our custom handler (by checking formatter type)
    for handler in root_logger.handlers:
        if hasattr(handler, 'formatter') and isinstance(handler.formatter, ColoredFormatter):
            # Already set up with our formatter
            return
    
    root_logger.setLevel(level)
    
    # Remove ALL existing handlers from root to prevent duplicates
    root_logger.handlers.clear()
    
    # Also clear handlers from common loggers
    for logger_name in ['agent', 'router', 'observer', 'service', 'agent.basic', 'agent.slack', 'agent.linkedin']:
        sub_logger = logging.getLogger(logger_name)
        sub_logger.handlers.clear()
        sub_logger.propagate = True
    
    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    
    # Create formatter
    if use_colors:
        formatter = ColoredFormatter(
            '%(asctime)s | %(levelname)-8s | %(name)-20s | %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
    else:
        formatter = logging.Formatter(
            '%(asctime)s | %(levelname)-8s | %(name)-20s | %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
    
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # Suppress noisy library logs
    logging.getLogger("livekit.agents").setLevel(logging.INFO)
    logging.getLogger("livekit").setLevel(logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance for a specific component.
    
    Args:
        name: Logger name (typically module name)
    
    Returns:
        Logger instance
    """
    return logging.getLogger(name)


# Component-specific loggers
def get_agent_logger(agent_name: str) -> logging.Logger:
    """Get logger for a specific agent"""
    return logging.getLogger(f"agent.{agent_name}")


def get_service_logger(service_name: str) -> logging.Logger:
    """Get logger for a specific service"""
    return logging.getLogger(f"service.{service_name}")


def get_router_logger() -> logging.Logger:
    """Get logger for agent router"""
    return logging.getLogger("router")


def get_observer_logger() -> logging.Logger:
    """Get logger for observer agent"""
    return logging.getLogger("observer")


def log_agent_switch(from_agent: str, to_agent: str, reason: Optional[str] = None):
    """Log agent switching"""
    logger = get_router_logger()
    msg = f"🔄 Agent switch: {from_agent} → {to_agent}"
    if reason:
        msg += f" (reason: {reason})"
    logger.info(msg)


def log_shared_state_operation(operation: str, key: str, agent: str, success: bool = True):
    """Log shared state operations"""
    logger = get_service_logger("shared_state")
    status = "✅" if success else "❌"
    logger.info(f"{status} Shared state {operation}: key='{key}' by agent='{agent}'")


def log_tool_call(tool_name: str, agent: str, params: Optional[dict] = None):
    """Log function tool calls"""
    logger = get_agent_logger(agent)
    msg = f"🔧 Tool call: {tool_name}"
    if params:
        # Truncate long parameters
        params_str = ", ".join([f"{k}={str(v)[:50]}" for k, v in params.items()])
        msg += f" | params: {params_str}"
    logger.info(msg)


def log_cross_agent_data_flow(from_agent: str, to_agent: str, data_type: str, key: str):
    """Log cross-agent data flow"""
    logger = get_observer_logger()
    logger.info(f"📊 Data flow: {from_agent} → {to_agent} | type={data_type} | key={key}")

