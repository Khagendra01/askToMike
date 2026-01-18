"""
TTS Service

Text-to-Speech service implementations.
Supports:
- macOS 'say' command (default on macOS - most reliable)
- pyttsx3 (cross-platform: Windows, Linux, macOS fallback)
"""

import os
import asyncio
import tempfile
import uuid
import wave
import platform
import subprocess

from livekit import rtc
from livekit.agents import tts

import sys
from pathlib import Path
# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import Config


class ChunkedStreamWrapper:
    """Helper to wrap async generator in a context manager for LiveKit"""
    def __init__(self, generator):
        self._generator = generator

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        # Async generators have an aclose method
        if hasattr(self._generator, 'aclose'):
            await self._generator.aclose()

    def __aiter__(self):
        return self._generator


class SystemTTS(tts.TTS):
    """System TTS implementation - uses macOS 'say' on Mac, pyttsx3 elsewhere"""
    
    def __init__(self, use_pyttsx3: bool = False):
        """
        Initialize SystemTTS.
        
        Args:
            use_pyttsx3: If True, force using pyttsx3 instead of macOS 'say'.
                         Default is False (use 'say' on macOS, pyttsx3 elsewhere).
        """
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=22050,
            num_channels=1
        )
        
        self._is_windows = platform.system() == "Windows"
        self._is_macos = platform.system() == "Darwin"
        
        # On macOS, prefer 'say' command (more reliable WAV output)
        # On Windows/Linux, use pyttsx3
        if self._is_macos and not use_pyttsx3 and self._command_exists("say"):
            self._use_macos_say = True
            print("🔊 Using macOS 'say' command for TTS")
        else:
            self._use_macos_say = False
            print("🔊 Using pyttsx3 for TTS")
    
    def _command_exists(self, cmd: str) -> bool:
        """Check if a command exists"""
        try:
            subprocess.run(["which", cmd], capture_output=True, check=True)
            return True
        except subprocess.CalledProcessError:
            return False
        
    def synthesize(self, text: str, **kwargs) -> "ChunkedStreamWrapper":
        return ChunkedStreamWrapper(self._synthesize_impl(text))

    async def _synthesize_impl(self, text: str):
        # Run TTS in a separate thread because it's blocking
        loop = asyncio.get_running_loop()
        
        if self._use_macos_say:
            audio_path = await loop.run_in_executor(None, self._generate_audio_macos_say, text)
        else:
            audio_path = await loop.run_in_executor(None, self._generate_audio_pyttsx3, text)
        
        if not audio_path:
            return

        # Read and yield audio frame
        try:
            with wave.open(audio_path, 'rb') as wf:
                sample_rate = wf.getframerate()
                num_channels = wf.getnchannels()
                sample_width = wf.getsampwidth()
                num_frames = wf.getnframes()
                frames = wf.readframes(num_frames)
            
            if num_frames == 0 or len(frames) == 0:
                print("❌ Generated audio has no frames")
                return
            
            # Calculate samples per channel
            samples_per_channel = len(frames) // (sample_width * num_channels)
            
            frame = rtc.AudioFrame(
                data=frames,
                sample_rate=sample_rate,
                num_channels=num_channels,
                samples_per_channel=samples_per_channel
            )
            
            yield tts.SynthesizedAudio(
                request_id="sys_" + uuid.uuid4().hex[:8],
                segment_id="seg_0",
                frame=frame
            )
        except Exception as e:
            print(f"❌ Error reading audio file: {e}")
        finally:
            # Cleanup temp file
            if audio_path and os.path.exists(audio_path):
                try:
                    os.unlink(audio_path)
                except:
                    pass

    def _generate_audio_pyttsx3(self, text: str) -> str:
        """Generate audio using pyttsx3 (cross-platform)"""
        try:
            import pyttsx3
            
            # Windows requires COM initialization in threads
            if self._is_windows:
                import pythoncom
                pythoncom.CoInitialize()
            
            # On macOS, pyttsx3 outputs AIFF, so we need to convert
            if self._is_macos:
                fd, aiff_path = tempfile.mkstemp(suffix=".aiff")
                os.close(fd)
                fd_wav, wav_path = tempfile.mkstemp(suffix=".wav")
                os.close(fd_wav)
                output_path = aiff_path
            else:
                fd, wav_path = tempfile.mkstemp(suffix=".wav")
                os.close(fd)
                output_path = wav_path
                aiff_path = None
            
            engine = pyttsx3.init()
            # Optionally set speech rate
            # engine.setProperty('rate', 150)
            engine.save_to_file(text, output_path)
            engine.runAndWait()
            
            # Clean up engine state
            if hasattr(engine, '_inLoop') and engine._inLoop:
                engine.endLoop()
            
            del engine
            
            # Verify the file was created and has content
            if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
                print("❌ pyttsx3 failed to generate audio file")
                return None
            
            # On macOS, convert AIFF to WAV
            if self._is_macos and aiff_path:
                result = subprocess.run(
                    ["afconvert", "-f", "WAVE", "-d", "LEI16", aiff_path, wav_path],
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                # Clean up AIFF
                if os.path.exists(aiff_path):
                    os.unlink(aiff_path)
                
                if result.returncode != 0:
                    print(f"❌ afconvert failed: {result.stderr}")
                    return None
            
            return wav_path
            
        except Exception as e:
            print(f"❌ pyttsx3 TTS generation failed: {e}")
            import traceback
            traceback.print_exc()
            return None
        finally:
            if self._is_windows:
                import pythoncom
                pythoncom.CoUninitialize()

    def _generate_audio_macos_say(self, text: str) -> str:
        """Generate audio using macOS 'say' command"""
        # Create temp file for AIFF output (say outputs AIFF by default)
        fd_aiff, aiff_path = tempfile.mkstemp(suffix=".aiff")
        os.close(fd_aiff)
        
        # Create temp file for WAV output
        fd_wav, wav_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd_wav)
        
        try:
            # Use 'say' to generate AIFF
            result = subprocess.run(
                ["say", "-o", aiff_path, text],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode != 0:
                print(f"❌ 'say' command failed: {result.stderr}")
                return None
            
            # Convert AIFF to WAV using afconvert
            result = subprocess.run(
                ["afconvert", "-f", "WAVE", "-d", "LEI16", aiff_path, wav_path],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode != 0:
                print(f"❌ 'afconvert' failed: {result.stderr}")
                return None
            
            # Verify WAV file
            if not os.path.exists(wav_path) or os.path.getsize(wav_path) == 0:
                print("❌ WAV file is empty or missing")
                return None
            
            # Verify it has audio frames
            try:
                with wave.open(wav_path, 'rb') as wf:
                    if wf.getnframes() == 0:
                        print("❌ WAV file has 0 frames")
                        return None
            except Exception as e:
                print(f"❌ Invalid WAV file: {e}")
                return None
            
            return wav_path
            
        except subprocess.TimeoutExpired:
            print("❌ TTS command timed out")
            return None
        except Exception as e:
            print(f"❌ macOS TTS generation error: {e}")
            return None
        finally:
            # Clean up AIFF file
            if os.path.exists(aiff_path):
                os.unlink(aiff_path)

