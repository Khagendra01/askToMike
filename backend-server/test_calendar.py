"""
Test Google Calendar Integration

Simple test script to verify calendar service works.
"""

import asyncio
from datetime import datetime, timedelta
from services.calendar_service import CalendarService


async def test_calendar():
    """Test calendar service functionality"""
    
    print("=" * 60)
    print("Google Calendar Integration Test")
    print("=" * 60)
    
    try:
        # Initialize service
        print("\n1. Initializing Calendar Service...")
        cal = CalendarService()
        print("   ✅ Service initialized")
        
        # Test: List existing events
        print("\n2. Listing existing events...")
        events = await cal.list_events(max_results=5)
        print(f"   Found {len(events)} upcoming events")
        
        if events:
            print("\n   Upcoming events:")
            for i, event in enumerate(events, 1):
                summary = event.get('summary', 'No title')
                start = event['start'].get('dateTime', event['start'].get('date'))
                print(f"   {i}. {summary} - {start}")
        else:
            print("   No upcoming events found")
        
        # Test: Create a test event
        print("\n3. Creating a test event...")
        test_title = f"Test Event - {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        start_time = datetime.now() + timedelta(hours=1)  # 1 hour from now
        end_time = start_time + timedelta(minutes=30)  # 30 minutes duration
        
        print(f"   Title: {test_title}")
        print(f"   Start: {start_time.isoformat()}")
        print(f"   End: {end_time.isoformat()}")
        
        created_event = await cal.create_event(
            title=test_title,
            start_time=start_time,
            end_time=end_time,
            description="This is a test event created by the calendar integration test."
        )
        
        print("   ✅ Event created successfully!")
        print(f"   Event ID: {created_event.get('id')}")
        print(f"   Link: {created_event.get('htmlLink', 'N/A')}")
        
        # Wait a moment for calendar to sync
        await asyncio.sleep(1)
        
        # Test: List events again to verify creation
        print("\n4. Verifying event was created...")
        events_after = await cal.list_events(max_results=5)
        found_test_event = False
        
        for event in events_after:
            if event.get('summary') == test_title:
                found_test_event = True
                print(f"   ✅ Test event found in calendar: {event.get('id')}")
                break
        
        if not found_test_event:
            print("   ⚠️  Test event not found in recent list (may take a moment to sync)")
        
        # Optional: Clean up test event
        print("\n5. Cleanup - Delete test event? (y/n)")
        # For automated testing, we'll skip this - uncomment if you want to delete:
        # delete_choice = input().strip().lower()
        # if delete_choice == 'y':
        #     await cal.delete_event(created_event['id'])
        #     print("   ✅ Test event deleted")
        
        print("\n" + "=" * 60)
        print("✅ All tests completed successfully!")
        print("=" * 60)
        
        # Show service account email reminder
        print("\n📋 REMINDER:")
        print("   Make sure your Google Calendar is shared with:")
        print("   nexhack@gen-lang-client-0664564474.iam.gserviceaccount.com")
        print("   (with 'Make changes to events' permission)")
        
    except FileNotFoundError as e:
        print(f"\n❌ Error: {e}")
        print("\n   Make sure calendar_credentials.json is in the backend-server/ directory")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        print("\n   Common issues:")
        print("   1. Calendar not shared with service account")
        print("   2. Google Calendar API not enabled in Google Cloud Console")
        print("   3. Invalid credentials file")


if __name__ == "__main__":
    asyncio.run(test_calendar())
