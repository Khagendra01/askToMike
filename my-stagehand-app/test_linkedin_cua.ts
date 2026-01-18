import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";

/**
 * Test Stagehand CUA on LinkedIn specifically
 * This tests if the "no candidates" error is LinkedIn/content specific
 * 
 * Run with: npx tsx test_linkedin_cua.ts
 */

async function main() {
  console.log("🧪 Testing Stagehand CUA on LinkedIn...\n");

  const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;

  if (!googleApiKey) {
    console.error("❌ No Google API key found!");
    process.exit(1);
  }

  console.log(`🔑 Using key: ${googleApiKey.substring(0, 8)}...${googleApiKey.substring(googleApiKey.length - 4)}`);

  // Use existing session profile
  const userDataDir = ".sessions/linkedin-browser-profile";

  console.log("\n📦 Initializing Stagehand with LinkedIn session...");
  
  const stagehand = new Stagehand({
    env: "LOCAL",
    localBrowserLaunchOptions: {
      headless: false,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
      ],
      userDataDir: userDataDir,
    },
    model: "google/gemini-3-flash-preview",
    verbose: 1,
  });

  try {
    await stagehand.init();
    console.log("   ✅ Stagehand initialized");

    const page = stagehand.context.pages()[0];
    await page.setViewportSize(1288, 711);

    // Navigate to LinkedIn feed
    console.log("\n🌐 Navigating to LinkedIn feed...");
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
    
    // Wait for feed to load
    await new Promise((resolve) => setTimeout(resolve, 5000));
    console.log("   ✅ LinkedIn feed loaded");

    // Check if logged in
    const isLoggedIn = await page.evaluate(() => {
      return document.querySelector('div[data-urn*="urn:li:activity:"]') !== null;
    });

    if (!isLoggedIn) {
      console.log("   ⚠️  Not logged in or no posts visible. Please run login-session first.");
      await stagehand.close();
      return;
    }

    console.log("   ✅ Logged in, posts visible");

    // Skip Tests 1 and 2 (CUA agent tests) - go directly to API tests

    // Test 3: Direct Gemini API call with LinkedIn screenshot
    console.log("\n🤖 Test 3: Direct Gemini API with screenshot...");
    
    try {
      // Take screenshot
      const screenshot = await page.screenshot();
      const base64Image = screenshot.toString('base64');

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${googleApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: "Describe what you see in this screenshot in one sentence." },
                { inline_data: { mime_type: "image/png", data: base64Image } },
              ],
            }],
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.log(`   ❌ HTTP Error: ${response.status}`);
        console.log(`   Details: ${JSON.stringify(data.error, null, 2)}`);
      } else if (!data.candidates || data.candidates.length === 0) {
        console.log("   ❌ No candidates in response!");
        console.log(`   Full response: ${JSON.stringify(data, null, 2)}`);
        
        // Check for safety block
        if (data.promptFeedback?.blockReason) {
          console.log(`   🚫 BLOCKED: ${data.promptFeedback.blockReason}`);
        }
      } else {
        const text = data.candidates[0]?.content?.parts?.[0]?.text;
        console.log(`   ✅ Success: "${text?.substring(0, 100)}..."`);
      }
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }

    // Test 4: Check safety settings
    console.log("\n🤖 Test 4: Gemini API with relaxed safety settings...");
    
    try {
      const screenshot = await page.screenshot();
      const base64Image = screenshot.toString('base64');

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${googleApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: "What is the main topic of the first post visible on this LinkedIn page?" },
                { inline_data: { mime_type: "image/png", data: base64Image } },
              ],
            }],
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            ],
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.log(`   ❌ HTTP Error: ${response.status}`);
      } else if (!data.candidates || data.candidates.length === 0) {
        console.log("   ❌ Still no candidates even with relaxed safety!");
        if (data.promptFeedback) {
          console.log(`   Feedback: ${JSON.stringify(data.promptFeedback, null, 2)}`);
        }
      } else {
        const text = data.candidates[0]?.content?.parts?.[0]?.text;
        console.log(`   ✅ Success with relaxed safety: "${text?.substring(0, 100)}..."`);
      }
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }

  } catch (error: any) {
    console.error("\n❌ Test failed:", error.message);
  } finally {
    console.log("\n🧹 Cleaning up...");
    await stagehand.close();
  }

  console.log("\n" + "═".repeat(50));
  console.log("✅ Tests complete!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
