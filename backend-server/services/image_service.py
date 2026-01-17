"""
Image Generation Service

Handles image generation using various providers (Google Gemini, etc.).
"""

import os
import asyncio
import tempfile
import uuid
from typing import Optional

import sys
from pathlib import Path
# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import Config


class ImageGenerationService:
    """Handles image generation using various providers"""
    
    def __init__(self, config: Config):
        self.config = config
    
    async def generate(self, description: str) -> Optional[str]:
        """Generate an image from description using Google Gemini"""
        if self.config.google_api_key:
            return await self._generate_with_gemini(description)
        
        print("⚠️ No image generation API configured")
        return None
    
    async def _generate_with_gemini(self, description: str) -> Optional[str]:
        """Generate image using Google Gemini 2.5 Flash Image"""
        try:
            from google import genai
            
            # Initialize client
            client = genai.Client(api_key=self.config.google_api_key)
            
            print(f"🎨 Generating image with Gemini: {description[:100]}...")
            
            # Generate image using the correct model
            response = await asyncio.to_thread(
                client.models.generate_content,
                model="gemini-2.5-flash-image",
                contents=description,
            )
            
            # Extract image data from response
            if not hasattr(response, 'candidates') or not response.candidates:
                print("⚠️ Gemini: No candidates in response")
                return None
            
            candidate = response.candidates[0]
            if not hasattr(candidate, 'content') or not candidate.content:
                print("⚠️ Gemini: No content in response")
                return None
            
            if not hasattr(candidate.content, 'parts') or not candidate.content.parts:
                print("⚠️ Gemini: No content parts in response")
                return None
            
            # Look for inline_data in parts (image will be in one of the parts)
            image_data = None
            for part in candidate.content.parts:
                if hasattr(part, 'inline_data') and part.inline_data:
                    if hasattr(part.inline_data, 'data'):
                        # The data is already in bytes format, not base64!
                        image_data = part.inline_data.data
                        break
            
            if not image_data:
                print("⚠️ Gemini: No inline_data found in response parts")
                return None
            
            # Create a temporary file to store the image
            temp_dir = tempfile.gettempdir()
            image_filename = f"gemini_image_{uuid.uuid4().hex[:8]}.png"
            image_path = os.path.join(temp_dir, image_filename)
            
            # Save the image (data is already bytes, no need to decode)
            try:
                with open(image_path, 'wb') as f:
                    f.write(image_data)
                
                print(f"✅ Gemini image saved to: {image_path} ({len(image_data)} bytes)")
                
                # Return file:// URL for local access
                # Note: In production, you'd upload this to a CDN/storage service
                return f"file://{image_path}"
            except Exception as save_error:
                print(f"⚠️ Failed to save image: {save_error}")
                return None
            
        except ImportError:
            print("⚠️ google-genai package not installed. Install with: pip install google-genai")
            return None
        except Exception as e:
            print(f"⚠️ Gemini image generation failed: {e}")
            import traceback
            traceback.print_exc()
            return None

