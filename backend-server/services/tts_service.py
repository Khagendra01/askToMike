"""
TTS Service

Text-to-Speech service implementations (System TTS using pyttsx3).
"""

import os
import asyncio
import tempfile
import uuid
import wave
import aifc
import audioop
import shutil
import subprocess

import pyttsx3
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
    """System TTS implementation using pyttsx3"""
    
    def __init__(self):
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=24000,
            num_channels=1
        )
        
    def synthesize(self, text: str, **kwargs) -> "ChunkedStreamWrapper":
        return ChunkedStreamWrapper(self._synthesize_impl(text))

    async def _synthesize_impl(self, text: str):
        # Retry logic for intermittent pyttsx3 failures on macOS
        max_retries = 3
        retry_delay = 0.2  # seconds
        
        for attempt in range(max_retries):
            # Run pyttsx3 in a separate thread because it's blocking
            loop = asyncio.get_running_loop()
            audio_data = None
            
            try:
                audio_data = await loop.run_in_executor(None, self._generate_audio_sync, text)
                
                if not audio_data:
                    if attempt < max_retries - 1:
                        print(f"⚠️ SystemTTS generation failed (attempt {attempt + 1}/{max_retries}), retrying...")
                        await asyncio.sleep(retry_delay)
                        continue
                    raise RuntimeError("SystemTTS failed to generate audio")

                # Create audio frame
                # pyttsx3 can emit WAV on some platforms and AIFF on macOS.
                try:
                    frames, sample_rate, num_channels, sample_width = self._read_audio_file(audio_data)
                    if not frames:
                        raise RuntimeError("SystemTTS generated empty audio data")
                    
                    # Normalize audio to 16-bit (2 bytes per sample)
                    frames, normalized_sample_width = self._normalize_audio(frames, sample_width)
                    if not frames:
                        raise RuntimeError("SystemTTS generated empty audio data after normalization")

                    # Calculate samples per channel using normalized sample width
                    bytes_per_sample = normalized_sample_width * num_channels
                    if bytes_per_sample == 0:
                        raise RuntimeError("Invalid audio format: zero bytes per sample")
                    
                    samples_per_channel = len(frames) // bytes_per_sample

                    print(f"✅ Creating AudioFrame: {sample_rate}Hz, {num_channels}ch, {normalized_sample_width}B, {samples_per_channel} samples/channel")

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
                    
                    # Success! Exit retry loop
                    return
                    
                except Exception as e:
                    # If this is not the last attempt, retry
                    if attempt < max_retries - 1:
                        print(f"⚠️ Error reading audio file (attempt {attempt + 1}/{max_retries}): {e}, retrying...")
                        # Cleanup failed file
                        if audio_data and os.path.exists(audio_data):
                            try:
                                os.unlink(audio_data)
                            except:
                                pass
                        await asyncio.sleep(retry_delay)
                        continue
                    # Last attempt failed, raise the error
                    print(f"❌ Error reading audio file after {max_retries} attempts: {e}")
                    raise
                finally:
                    # Cleanup temp file on success or after last retry
                    if audio_data and os.path.exists(audio_data):
                        try:
                            os.unlink(audio_data)
                        except:
                            pass
                            
            except Exception as e:
                # Cleanup on any exception
                if audio_data and os.path.exists(audio_data):
                    try:
                        os.unlink(audio_data)
                    except:
                        pass
                
                # If this is not the last attempt, retry
                if attempt < max_retries - 1:
                    print(f"⚠️ SystemTTS error (attempt {attempt + 1}/{max_retries}): {e}, retrying...")
                    await asyncio.sleep(retry_delay)
                    continue
                
                # Last attempt failed
                raise

    def _read_audio_file(self, path: str):
        # Try reading as WAV first
        try:
            with wave.open(path, 'rb') as wf:
                sample_rate = wf.getframerate()
                num_channels = wf.getnchannels()
                sample_width = wf.getsampwidth()
                frames = wf.readframes(wf.getnframes())
                print(f"✅ Read audio as WAV: {sample_rate}Hz, {num_channels}ch, {sample_width}B")
                return frames, sample_rate, num_channels, sample_width
        except (wave.Error, Exception) as e:
            # If WAV reading fails, try AIFF
            print(f"⚠️ WAV read failed, trying AIFF: {e}")
            pass
        
        # Try reading as AIFF
        try:
            with aifc.open(path, 'rb') as af:
                sample_rate = af.getframerate()
                num_channels = af.getnchannels()
                sample_width = af.getsampwidth()
                comp_type = af.getcomptype()
                num_frames = af.getnframes()
                
                # Check if the file actually has audio frames
                if num_frames == 0:
                    print(f"⚠️ AIFF file has 0 frames, attempting conversion")
                    raise aifc.Error("AIFF file has 0 frames")
                
                frames = af.readframes(num_frames)
                
                if not frames or len(frames) == 0:
                    print(f"⚠️ AIFF file has no audio data, attempting conversion")
                    raise aifc.Error("AIFF file has no audio data")
                
                print(f"✅ Read audio as AIFF: {sample_rate}Hz, {num_channels}ch, {sample_width}B, comp={comp_type}, {num_frames} frames")
                # AIFF is big-endian; LiveKit expects little-endian PCM.
                if comp_type == "NONE" and sample_width in (2, 4):
                    frames = audioop.byteswap(frames, sample_width)
                return frames, sample_rate, num_channels, sample_width
        except (aifc.Error, Exception) as e:
            # If AIFF reading also fails, try converting the file
            print(f"⚠️ AIFF read failed, attempting conversion: {e}")
            pass

        # If both direct reads failed, attempt conversion
        # First, verify the source file actually has some audio data
        source_size = os.path.getsize(path)
        if source_size < 100:  # AIFF files should be at least a few hundred bytes
            raise RuntimeError(f"Source audio file appears to be too small ({source_size} bytes) - may be corrupted")
        
        print(f"🔄 Attempting to convert audio file: {path} ({source_size} bytes)")
        converted_path = self._convert_to_wav(path)
        if not converted_path:
            raise RuntimeError(f"SystemTTS produced unsupported audio compression. Failed to read or convert: {path}")

        try:
            # Verify converted file exists and has content
            if not os.path.exists(converted_path):
                raise RuntimeError(f"Converted file does not exist: {converted_path}")
            
            converted_size = os.path.getsize(converted_path)
            if converted_size == 0:
                raise RuntimeError(f"Converted file is empty: {converted_path}")
            
            print(f"📄 Reading converted WAV file: {converted_path} ({converted_size} bytes)")
            
            with wave.open(converted_path, 'rb') as wf:
                sample_rate = wf.getframerate()
                num_channels = wf.getnchannels()
                sample_width = wf.getsampwidth()
                num_frames = wf.getnframes()
                frames = wf.readframes(num_frames)
                
                print(f"✅ Read converted WAV: {sample_rate}Hz, {num_channels}ch, {sample_width}B, {num_frames} frames, {len(frames)} bytes")
                
                if not frames or len(frames) == 0:
                    raise RuntimeError(f"Converted WAV file has no audio frames")
                
                return frames, sample_rate, num_channels, sample_width
        except Exception as e:
            print(f"❌ Failed to read converted file: {e}")
            raise
        finally:
            try:
                os.unlink(converted_path)
            except OSError:
                pass

    def _convert_to_wav(self, path: str) -> str | None:
        afconvert = shutil.which("afconvert")
        if not afconvert:
            print(f"❌ afconvert not found, cannot convert audio file")
            return None

        fd, out_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)

        try:
            result = subprocess.run(
                [afconvert, "-f", "WAVE", "-d", "LEI16", path, out_path],
                check=True,
                capture_output=True,
                text=True
            )
            
            # Wait a moment for file to be fully written
            import time
            time.sleep(0.1)
            
            # Verify converted file exists and has content
            if not os.path.exists(out_path):
                print(f"❌ Conversion failed: output file does not exist")
                return None
                
            file_size = os.path.getsize(out_path)
            if file_size == 0:
                print(f"❌ Conversion failed: output file is empty")
                return None
            
            # Verify it's a valid WAV file with actual audio frames
            try:
                with wave.open(out_path, 'rb') as test_wf:
                    test_frames = test_wf.getnframes()
                    if test_frames == 0:
                        print(f"❌ Conversion failed: converted WAV has 0 frames - source file may be invalid")
                        try:
                            os.unlink(out_path)
                        except OSError:
                            pass
                        return None
                    else:
                        print(f"✅ Converted audio file to WAV: {out_path} ({file_size} bytes, {test_frames} frames)")
            except Exception as e:
                print(f"❌ Conversion failed: converted file is not valid WAV: {e}")
                try:
                    os.unlink(out_path)
                except OSError:
                    pass
                return None
            
            return out_path
        except subprocess.CalledProcessError as e:
            print(f"❌ afconvert failed: {e.stderr if e.stderr else str(e)}")
            if e.stdout:
                print(f"   stdout: {e.stdout}")
            try:
                os.unlink(out_path)
            except OSError:
                pass
            return None
        except Exception as e:
            print(f"❌ Conversion error: {e}")
            import traceback
            traceback.print_exc()
            try:
                os.unlink(out_path)
            except OSError:
                pass
            return None

    def _normalize_audio(self, frames: bytes, sample_width: int) -> tuple[bytes, int]:
        if not frames:
            return frames, sample_width
        if sample_width == 2:
            return frames, sample_width
        if sample_width in (1, 3, 4):
            try:
                return audioop.lin2lin(frames, sample_width, 2), 2
            except Exception:
                return frames, sample_width
        return frames, sample_width

    def _generate_audio_sync(self, text: str) -> str:
        # We need to return the path to the temp file so we can read it with wave
        # Or read bytes.
        pythoncom = None
        if os.name == "nt":
            try:
                import pythoncom as _pythoncom  # type: ignore
                pythoncom = _pythoncom
            except Exception:
                pythoncom = None
        
        try:
            if pythoncom:
                pythoncom.CoInitialize()
            
            # Create a temp file
            # On macOS, pyttsx3 saves in AIFF format, so use .aiff extension
            import platform
            if platform.system() == "Darwin":  # macOS
                fd, path = tempfile.mkstemp(suffix=".aiff")
            else:
                fd, path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)
            
            engine = pyttsx3.init()
            # Set sample rate if possible (some engines support this)
            try:
                # Get available voices/properties to set rate
                rate = engine.getProperty('rate')
                # Keep default rate or adjust if needed
            except:
                pass
            
            engine.save_to_file(text, path)
            engine.runAndWait()
            
            if engine._inLoop:
                engine.endLoop()
            
            del engine
            
            # Wait a moment for file to be fully written
            import time
            time.sleep(0.2)  # Increased wait time
            
            # Verify file was created and has content
            if not os.path.exists(path):
                print(f"❌ SystemTTS: File was not created: {path}")
                return None
            
            file_size = os.path.getsize(path)
            if file_size == 0:
                print(f"❌ SystemTTS: File is empty: {path}")
                os.unlink(path)
                return None
            
            # On macOS, verify the AIFF file actually has audio frames
            # Note: pyttsx3 may generate compressed AIFF that aifc can't read directly,
            # but afconvert can handle it, so we just check file size
            if platform.system() == "Darwin":
                # Just check file size - if it's reasonable, let conversion handle it
                # Compressed AIFF files often show as 4096 bytes initially
                if file_size < 1000:
                    print(f"⚠️ SystemTTS: Generated file seems too small ({file_size} bytes), may be corrupted")
                else:
                    print(f"✅ SystemTTS: Generated audio file {path} ({file_size} bytes)")
            else:
                print(f"✅ SystemTTS: Generated audio file {path} ({file_size} bytes)")
            
            return path
        except Exception as e:
            print(f"❌ SystemTTS generation failed: {e}")
            import traceback
            traceback.print_exc()
            return None
        finally:
            if pythoncom:
                pythoncom.CoUninitialize()
