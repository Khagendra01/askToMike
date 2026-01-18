"""
Simple Google Calendar Service (Service Account)

Uses hardcoded service account credentials for solo testing.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

# Hardcoded path to credentials - adjust if needed
CREDENTIALS_FILE = Path(__file__).parent.parent / "calendar_credentials.json"

# Your calendar ID - use 'primary' or your email
# Change this to your email if 'primary' doesn't work
CALENDAR_ID = "primary"  # <-- Change to "your-email@gmail.com" if needed


class CalendarService:
    """Simple Google Calendar service using service account"""
    
    def __init__(self):
        self._service = None
    
    def _get_service(self):
        """Get or create Calendar API service"""
        if self._service is None:
            if not CREDENTIALS_FILE.exists():
                raise FileNotFoundError(
                    f"Calendar credentials not found at {CREDENTIALS_FILE}. "
                    "Please download service account JSON from Google Cloud Console."
                )
            
            creds = service_account.Credentials.from_service_account_file(
                str(CREDENTIALS_FILE),
                scopes=['https://www.googleapis.com/auth/calendar']
            )
            self._service = build('calendar', 'v3', credentials=creds)
        return self._service
    
    async def list_events(self, max_results: int = 10) -> List[Dict[str, Any]]:
        """List upcoming events from calendar"""
        service = self._get_service()
        now = datetime.utcnow().isoformat() + 'Z'
        
        # Run synchronous Google API call in thread pool to avoid blocking
        def _list_events_sync():
            return service.events().list(
                calendarId=CALENDAR_ID,
                timeMin=now,
                maxResults=max_results,
                singleEvents=True,
                orderBy='startTime'
            ).execute()
        
        result = await asyncio.to_thread(_list_events_sync)
        return result.get('items', [])
    
    async def create_event(
        self,
        title: str,
        start_time: datetime,
        end_time: datetime,
        description: str = ""
    ) -> Dict[str, Any]:
        """Create a calendar event"""
        service = self._get_service()
        
        event = {
            'summary': title,
            'description': description,
            'start': {'dateTime': start_time.isoformat(), 'timeZone': 'America/Los_Angeles'},
            'end': {'dateTime': end_time.isoformat(), 'timeZone': 'America/Los_Angeles'},
        }
        
        # Run synchronous Google API call in thread pool to avoid blocking
        def _create_event_sync():
            return service.events().insert(calendarId=CALENDAR_ID, body=event).execute()
        
        return await asyncio.to_thread(_create_event_sync)
    
    async def delete_event(self, event_id: str) -> bool:
        """Delete a calendar event by ID"""
        service = self._get_service()
        
        # Run synchronous Google API call in thread pool to avoid blocking
        def _delete_event_sync():
            service.events().delete(calendarId=CALENDAR_ID, eventId=event_id).execute()
            return True
        
        return await asyncio.to_thread(_delete_event_sync)
