"""
ElevenLabs API Test Script

Tests the ElevenLabs API connection and TTS functionality.
Run with: python test_elevenlabs.py
"""

import os
import asyncio
from dotenv import load_dotenv

load_dotenv()


def test_api_key_present():
    """Test 1: Check if API key is set"""
    api_key = os.getenv("ELEVENLABS_API_KEY")
    
    print("=" * 60)
    print("TEST 1: API Key Check")
    print("=" * 60)
    
    if not api_key:
        print("❌ ELEVENLABS_API_KEY is not set in environment")
        print("   Set it in your .env file or environment variables")
        return False
    
    # Check key format (ElevenLabs keys are typically 32 chars)
    key_preview = f"{api_key[:8]}...{api_key[-4:]}" if len(api_key) > 12 else "***"
    print(f"✅ API Key found: {key_preview}")
    print(f"   Key length: {len(api_key)} characters")
    
    if len(api_key) < 20:
        print("⚠️  Warning: API key seems too short (expected ~32 chars)")
        return False
    
    return True


def test_elevenlabs_import():
    """Test 2: Check if elevenlabs package is installed"""
    print("\n" + "=" * 60)
    print("TEST 2: Package Import Check")
    print("=" * 60)
    
    try:
        import elevenlabs
        print("✅ elevenlabs package imported successfully")
        if hasattr(elevenlabs, '__version__'):
            print(f"   Version: {elevenlabs.__version__}")
        return True
    except ImportError as e:
        print("⚠️  elevenlabs package not installed (not required for LiveKit plugin)")
        print(f"   Error: {e}")
        return True  # Not a blocker - LiveKit plugin works without it


def test_livekit_elevenlabs_plugin():
    """Test 3: Check if livekit elevenlabs plugin is installed (skip import due to sandbox issues)"""
    print("\n" + "=" * 60)
    print("TEST 3: LiveKit ElevenLabs Plugin Check")
    print("=" * 60)
    
    # Just check if the package directory exists
    try:
        import importlib.util
        spec = importlib.util.find_spec("livekit.plugins.elevenlabs")
        if spec:
            print("✅ livekit-plugins-elevenlabs is installed")
            return True
        else:
            print("❌ livekit-plugins-elevenlabs not found")
            return False
    except Exception as e:
        print(f"⚠️  Could not check plugin: {e}")
        return True  # Assume it's there since server.py works


async def test_elevenlabs_api_connection():
    """Test 4: Test actual API connection with a simple request"""
    print("\n" + "=" * 60)
    print("TEST 4: API Connection Test")
    print("=" * 60)
    
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        print("❌ Skipping - no API key")
        return False
    
    try:
        import httpx
        
        # Test the voices endpoint (lightweight API call)
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.elevenlabs.io/v1/voices",
                headers={"xi-api-key": api_key},
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                voices = data.get("voices", [])
                print("✅ API connection successful!")
                print(f"   Available voices: {len(voices)}")
                if voices:
                    print(f"   First voice: {voices[0].get('name', 'Unknown')}")
                return True
            elif response.status_code == 401:
                print("❌ API returned 401 Unauthorized")
                print("   Your API key is invalid or expired")
                print("   Get a new key at: https://elevenlabs.io/app/settings/api-keys")
                return False
            elif response.status_code == 429:
                print("❌ API returned 429 Too Many Requests")
                print("   You've exceeded your rate limit or quota")
                return False
            else:
                print(f"❌ API returned status {response.status_code}")
                print(f"   Response: {response.text[:200]}")
                return False
                
    except httpx.ConnectError as e:
        print(f"❌ Connection error: {e}")
        print("   Check your internet connection")
        return False
    except Exception as e:
        print(f"❌ Error testing API: {e}")
        return False


async def test_elevenlabs_tts_synthesis():
    """Test 5: Test actual TTS synthesis"""
    print("\n" + "=" * 60)
    print("TEST 5: TTS Synthesis Test")
    print("=" * 60)
    
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        print("❌ Skipping - no API key")
        return False
    
    try:
        import httpx
        
        # Use the same voice_id as in agent.py
        voice_id = "EXAVITQu4vr4xnSDxMaL"  # Sarah voice
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                headers={
                    "xi-api-key": api_key,
                    "Content-Type": "application/json",
                },
                json={
                    "text": "Hello, this is a test.",
                    "model_id": "eleven_turbo_v2_5",
                    "voice_settings": {
                        "stability": 0.5,
                        "similarity_boost": 0.75
                    }
                },
                timeout=30.0
            )
            
            if response.status_code == 200:
                audio_size = len(response.content)
                print("✅ TTS synthesis successful!")
                print(f"   Audio size: {audio_size} bytes")
                
                # Optionally save the audio
                with open("test_audio.mp3", "wb") as f:
                    f.write(response.content)
                print("   Saved to: test_audio.mp3")
                return True
            elif response.status_code == 401:
                print("❌ TTS returned 401 Unauthorized")
                print("   Your API key is invalid")
                return False
            elif response.status_code == 422:
                print("❌ TTS returned 422 - Invalid request")
                error_detail = response.json() if response.headers.get("content-type", "").startswith("application/json") else response.text
                print(f"   Error: {error_detail}")
                return False
            else:
                print(f"❌ TTS returned status {response.status_code}")
                print(f"   Response: {response.text[:500]}")
                return False
                
    except Exception as e:
        print(f"❌ Error testing TTS: {e}")
        return False


async def test_elevenlabs_websocket():
    """Test 6: Test WebSocket streaming (what LiveKit uses)"""
    print("\n" + "=" * 60)
    print("TEST 6: WebSocket Streaming Test")
    print("=" * 60)
    
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        print("❌ Skipping - no API key")
        return False
    
    try:
        import websockets
        import json
        
        voice_id = "EXAVITQu4vr4xnSDxMaL"
        model_id = "eleven_turbo_v2_5"
        
        uri = f"wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input?model_id={model_id}"
        
        print("   Connecting to WebSocket...")
        
        async with websockets.connect(
            uri,
            additional_headers={"xi-api-key": api_key},
            close_timeout=5
        ) as ws:
            # Send initial config
            await ws.send(json.dumps({
                "text": " ",
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.75
                },
                "generation_config": {
                    "chunk_length_schedule": [120, 160, 250, 290]
                }
            }))
            
            # Send text
            await ws.send(json.dumps({
                "text": "Hello, this is a WebSocket test. ",
            }))
            
            # Send end of stream
            await ws.send(json.dumps({
                "text": ""
            }))
            
            # Receive audio chunks
            audio_chunks = []
            try:
                async for message in ws:
                    data = json.loads(message)
                    if "audio" in data and data["audio"]:
                        audio_chunks.append(data["audio"])
                    if data.get("isFinal"):
                        break
            except websockets.exceptions.ConnectionClosed as e:
                if audio_chunks:
                    print("✅ WebSocket streaming works!")
                    print(f"   Received {len(audio_chunks)} audio chunks")
                    return True
                else:
                    print(f"❌ WebSocket closed without audio: {e}")
                    print(f"   Code: {e.code}, Reason: {e.reason}")
                    return False
            
            if audio_chunks:
                print("✅ WebSocket streaming successful!")
                print(f"   Received {len(audio_chunks)} audio chunks")
                return True
            else:
                print("❌ No audio received from WebSocket")
                return False
                
    except websockets.exceptions.InvalidStatusCode as e:
        print(f"❌ WebSocket connection rejected: {e}")
        if e.status_code == 401:
            print("   Your API key is invalid or expired")
        return False
    except ImportError:
        print("⚠️  websockets package not installed")
        print("   Install with: pip install websockets")
        return False
    except Exception as e:
        print(f"❌ WebSocket error: {type(e).__name__}: {e}")
        return False


async def test_quota_status():
    """Test 7: Check account quota/subscription status"""
    print("\n" + "=" * 60)
    print("TEST 7: Account Quota Check")
    print("=" * 60)
    
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        print("❌ Skipping - no API key")
        return False
    
    try:
        import httpx
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.elevenlabs.io/v1/user/subscription",
                headers={"xi-api-key": api_key},
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                tier = data.get("tier", "unknown")
                char_count = data.get("character_count", 0)
                char_limit = data.get("character_limit", 0)
                
                print("✅ Account info retrieved!")
                print(f"   Tier: {tier}")
                print(f"   Characters used: {char_count:,} / {char_limit:,}")
                
                if char_limit > 0:
                    usage_pct = (char_count / char_limit) * 100
                    print(f"   Usage: {usage_pct:.1f}%")
                    
                    if usage_pct >= 100:
                        print("   ⚠️  QUOTA EXCEEDED - This is likely causing your errors!")
                        return False
                    elif usage_pct >= 90:
                        print("   ⚠️  Warning: Approaching quota limit")
                
                return True
            elif response.status_code == 401:
                print("❌ API returned 401 - Invalid API key")
                return False
            else:
                print(f"❌ API returned status {response.status_code}")
                return False
                
    except Exception as e:
        print(f"❌ Error checking quota: {e}")
        return False


async def main():
    """Run all tests"""
    print("\n" + "=" * 60)
    print("  ELEVENLABS API DIAGNOSTIC TEST")
    print("=" * 60)
    
    results = {}
    
    # Sync tests
    results["api_key"] = test_api_key_present()
    results["import"] = test_elevenlabs_import()
    results["livekit_plugin"] = test_livekit_elevenlabs_plugin()
    
    # Async tests
    results["api_connection"] = await test_elevenlabs_api_connection()
    results["quota"] = await test_quota_status()
    results["tts_synthesis"] = await test_elevenlabs_tts_synthesis()
    results["websocket"] = await test_elevenlabs_websocket()
    
    # Summary
    print("\n" + "=" * 60)
    print("  TEST SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, passed_test in results.items():
        status = "✅ PASS" if passed_test else "❌ FAIL"
        print(f"  {status}: {test_name}")
    
    print(f"\n  Total: {passed}/{total} tests passed")
    
    if not results["api_key"]:
        print("\n💡 FIX: Set ELEVENLABS_API_KEY in your .env file")
    elif not results["api_connection"]:
        print("\n💡 FIX: Your API key is invalid. Get a new one at:")
        print("   https://elevenlabs.io/app/settings/api-keys")
    elif not results["quota"]:
        print("\n💡 FIX: You may have exceeded your quota. Check your usage at:")
        print("   https://elevenlabs.io/app/subscription")
    elif not results["websocket"]:
        print("\n💡 FIX: WebSocket connection failing. This could be:")
        print("   - Network/firewall blocking WebSocket connections")
        print("   - API key doesn't have streaming permissions")
        print("   - Temporary ElevenLabs service issue")
    
    # Quick fix suggestion
    if passed < total:
        print("\n" + "=" * 60)
        print("  QUICK FIX: Use free TTS instead")
        print("=" * 60)
        print("  Set TTS_PROVIDER=free in your .env file to use")
        print("  the macOS 'say' command as a fallback TTS.")


if __name__ == "__main__":
    asyncio.run(main())
