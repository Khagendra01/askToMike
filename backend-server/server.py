"""
LiveKit Agent Server - Entry Point

This is the main entry point for the LiveKit agent server.
All functionality has been modularized into separate files.
"""

import asyncio
import logging
import sys
import os

from dotenv import load_dotenv

# Load environment variables first
load_dotenv()

# Setup logging before importing other modules
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from utils.logger import setup_logging

# Setup logging with level from environment or default to INFO
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
log_level_map = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
    "CRITICAL": logging.CRITICAL,
}
setup_logging(level=log_level_map.get(log_level, logging.INFO), use_colors=True)

# Import and run the main application
from app import main

if __name__ == "__main__":
    try:
        asyncio.run(main())
        print("\n✅ Exited cleanly")
    except KeyboardInterrupt:
        print("\n✅ Exited cleanly")
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
