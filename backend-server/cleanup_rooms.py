#!/usr/bin/env python3
"""
Cleanup Script - Delete all rooms and agents from LiveKit Cloud

Run this to clean up stale rooms and agents:
    python cleanup_rooms.py
"""

import asyncio
import os
from dotenv import load_dotenv
from livekit import api

load_dotenv()


async def cleanup_all_rooms():
    """Delete all rooms from LiveKit Cloud"""
    
    api_key = os.getenv("LIVEKIT_API_KEY")
    api_secret = os.getenv("LIVEKIT_API_SECRET")
    livekit_url = os.getenv("LIVEKIT_URL", "wss://del-hecqeidt.livekit.cloud")
    
    if not api_key or not api_secret:
        print("❌ LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set")
        return
    
    # Convert wss:// to https:// for API
    api_url = livekit_url.replace("wss://", "https://")
    
    print(f"🔗 Connecting to: {api_url}")
    print(f"🔑 Using API Key: {api_key[:10]}...")
    
    livekit_api = api.LiveKitAPI(
        url=api_url,
        api_key=api_key,
        api_secret=api_secret,
    )
    
    try:
        # List all rooms
        print("\n📋 Listing all rooms...")
        rooms_response = await livekit_api.room.list_rooms(api.ListRoomsRequest())
        rooms = rooms_response.rooms
        
        if not rooms:
            print("✅ No rooms found - already clean!")
            return
        
        print(f"Found {len(rooms)} room(s):\n")
        
        for room in rooms:
            print(f"  🏠 Room: {room.name}")
            print(f"     Participants: {room.num_participants}")
            print(f"     Created: {room.creation_time}")
            
            # List participants in this room
            try:
                participants_response = await livekit_api.room.list_participants(
                    api.ListParticipantsRequest(room=room.name)
                )
                for p in participants_response.participants:
                    print(f"     👤 {p.identity} (joined: {p.joined_at})")
            except Exception as e:
                print(f"     ⚠️ Could not list participants: {e}")
        
        # Ask for confirmation
        print(f"\n⚠️  About to delete {len(rooms)} room(s)")
        confirm = input("Type 'yes' to confirm deletion: ")
        
        if confirm.lower() != 'yes':
            print("❌ Cancelled")
            return
        
        # Delete all rooms
        print("\n🗑️  Deleting rooms...")
        for room in rooms:
            try:
                await livekit_api.room.delete_room(
                    api.DeleteRoomRequest(room=room.name)
                )
                print(f"  ✅ Deleted: {room.name}")
            except Exception as e:
                print(f"  ❌ Failed to delete {room.name}: {e}")
        
        print("\n✅ Cleanup complete!")
        
    finally:
        await livekit_api.aclose()


if __name__ == "__main__":
    asyncio.run(cleanup_all_rooms())
