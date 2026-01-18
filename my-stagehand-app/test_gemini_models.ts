import "dotenv/config";

/**
 * Test script to verify Gemini API models and connectivity
 * Run with: npx tsx test_gemini_models.ts
 */

const MODELS_TO_TEST = [
  "gemini-2.0-flash-exp",
  "gemini-2.5-computer-use-preview-10-2025",
  "gemini-3-flash-preview",
];

async function testModel(modelName: string, apiKey: string): Promise<void> {
  console.log(`\n🧪 Testing model: ${modelName}`);
  console.log("─".repeat(50));

  const prompt = "Say hello in one word.";

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.log(`   ❌ HTTP Error: ${response.status}`);
      console.log(`   Error details:`, JSON.stringify(data, null, 2));
      return;
    }

    // Check for candidates
    if (!data.candidates || data.candidates.length === 0) {
      console.log(`   ❌ Response has no candidates!`);
      console.log(`   Full response:`, JSON.stringify(data, null, 2));
      return;
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    if (text) {
      console.log(`   ✅ Success! Response: "${text}"`);
    } else {
      console.log(`   ⚠️  Empty text in response`);
      console.log(`   Full response:`, JSON.stringify(data, null, 2));
    }

    // Check for safety ratings or blocks
    if (data.candidates?.[0]?.finishReason && data.candidates[0].finishReason !== "STOP") {
      console.log(`   ⚠️  Finish reason: ${data.candidates[0].finishReason}`);
    }

    if (data.promptFeedback?.blockReason) {
      console.log(`   ⚠️  Prompt blocked: ${data.promptFeedback.blockReason}`);
    }

  } catch (error) {
    console.log(`   ❌ Fetch error:`, error);
  }
}

async function testVisionModel(modelName: string, apiKey: string): Promise<void> {
  console.log(`\n🖼️  Testing vision capability: ${modelName}`);
  console.log("─".repeat(50));

  // Create a simple 1x1 red pixel PNG (base64)
  const tinyRedPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: "What color is this image? Reply with just the color name.",
                },
                {
                  inline_data: {
                    mime_type: "image/png",
                    data: tinyRedPng,
                  },
                },
              ],
            },
          ],
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.log(`   ❌ HTTP Error: ${response.status}`);
      console.log(`   Error details:`, JSON.stringify(data, null, 2));
      return;
    }

    if (!data.candidates || data.candidates.length === 0) {
      console.log(`   ❌ Response has no candidates!`);
      console.log(`   Full response:`, JSON.stringify(data, null, 2));
      return;
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    if (text) {
      console.log(`   ✅ Vision works! Response: "${text}"`);
    } else {
      console.log(`   ⚠️  Empty text in response`);
    }

  } catch (error) {
    console.log(`   ❌ Fetch error:`, error);
  }
}

async function testJsonMode(modelName: string, apiKey: string): Promise<void> {
  console.log(`\n📋 Testing JSON mode: ${modelName}`);
  console.log("─".repeat(50));

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: 'Generate a comment for a LinkedIn post about AI. Respond with JSON: {"comment": "your comment"}',
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                comment: { type: "string" }
              },
              required: ["comment"]
            }
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.log(`   ❌ HTTP Error: ${response.status}`);
      console.log(`   Error details:`, JSON.stringify(data, null, 2));
      return;
    }

    if (!data.candidates || data.candidates.length === 0) {
      console.log(`   ❌ Response has no candidates!`);
      console.log(`   Full response:`, JSON.stringify(data, null, 2));
      return;
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    if (text) {
      try {
        const parsed = JSON.parse(text);
        console.log(`   ✅ JSON mode works! Comment: "${parsed.comment}"`);
      } catch {
        console.log(`   ⚠️  Response not valid JSON: "${text}"`);
      }
    } else {
      console.log(`   ⚠️  Empty text in response`);
    }

  } catch (error) {
    console.log(`   ❌ Fetch error:`, error);
  }
}

async function listAvailableModels(apiKey: string): Promise<void> {
  console.log(`\n📜 Listing available models...`);
  console.log("─".repeat(50));

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );

    const data = await response.json();

    if (!response.ok) {
      console.log(`   ❌ HTTP Error: ${response.status}`);
      console.log(`   Error details:`, JSON.stringify(data, null, 2));
      return;
    }

    const models = data.models || [];
    const geminiModels = models
      .filter((m: any) => m.name.includes("gemini"))
      .map((m: any) => m.name.replace("models/", ""));

    console.log(`   Found ${geminiModels.length} Gemini models:`);
    geminiModels.forEach((name: string) => {
      console.log(`   - ${name}`);
    });

  } catch (error) {
    console.log(`   ❌ Fetch error:`, error);
  }
}

async function main() {
  console.log("🔑 Checking API keys...");
  
  const googleApiKey = process.env.GOOGLE_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const googleGenAiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  console.log(`   GOOGLE_API_KEY: ${googleApiKey ? "✅ Set" : "❌ Not set"}`);
  console.log(`   GEMINI_API_KEY: ${geminiApiKey ? "✅ Set" : "❌ Not set"}`);
  console.log(`   GOOGLE_GENERATIVE_AI_API_KEY: ${googleGenAiKey ? "✅ Set" : "❌ Not set"}`);

  const apiKey = googleGenAiKey || googleApiKey || geminiApiKey;

  if (!apiKey) {
    console.error("\n❌ No API key found! Set GOOGLE_GENERATIVE_AI_API_KEY, GOOGLE_API_KEY, or GEMINI_API_KEY");
    process.exit(1);
  }

  console.log(`\n   Using key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);

  // List available models first
  await listAvailableModels(apiKey);

  // Test each model
  for (const model of MODELS_TO_TEST) {
    await testModel(model, apiKey);
  }

  // Test vision on the main model used in linkedin_comment.ts
  await testVisionModel("gemini-2.0-flash-exp", apiKey);

  // Test JSON mode
  await testJsonMode("gemini-2.0-flash-exp", apiKey);

  console.log("\n" + "═".repeat(50));
  console.log("✅ Tests complete!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
