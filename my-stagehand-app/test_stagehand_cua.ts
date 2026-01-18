import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";

/**
 * Test script to verify Stagehand CUA (Computer Use Agent) functionality
 * This tests the exact setup used in linkedin_comment.ts
 * 
 * Run with: npx tsx test_stagehand_cua.ts
 */

async function main() {
  console.log("🧪 Testing Stagehand CUA (Computer Use Agent)...\n");

  // Check API keys
  const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  
  console.log("🔑 API Key check:");
  console.log(`   GOOGLE_GENERATIVE_AI_API_KEY: ${process.env.GOOGLE_GENERATIVE_AI_API_KEY ? "✅ Set" : "❌ Not set"}`);
  console.log(`   GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? "✅ Set" : "❌ Not set"}`);
  console.log(`   GOOGLE_API_KEY: ${process.env.GOOGLE_API_KEY ? "✅ Set" : "❌ Not set"}`);

  if (!googleApiKey) {
    console.error("\n❌ No Google API key found!");
    process.exit(1);
  }

  console.log(`\n   Using key: ${googleApiKey.substring(0, 8)}...${googleApiKey.substring(googleApiKey.length - 4)}`);

  // Initialize Stagehand
  console.log("\n📦 Initializing Stagehand...");
  
  const stagehand = new Stagehand({
    env: "LOCAL",
    localBrowserLaunchOptions: {
      headless: false,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
      ],
    },
    model: "google/gemini-3-flash-preview",
    verbose: 1, // Enable verbose logging to see what's happening
  });

  try {
    await stagehand.init();
    console.log("   ✅ Stagehand initialized");

    const page = stagehand.context.pages()[0];
    await page.setViewportSize(1288, 711);

    // Navigate to a simple test page
    console.log("\n🌐 Navigating to test page...");
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    console.log("   ✅ Navigated to example.com");

    // Wait a moment
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Test 1: Create CUA agent with the exact config from linkedin_comment.ts
    console.log("\n🤖 Test 1: Creating CUA agent with gemini-2.5-computer-use-preview-10-2025...");
    
    try {
      const cuaAgent = stagehand.agent({
        mode: "cua",
        model: {
          modelName: "google/gemini-2.5-computer-use-preview-10-2025",
          apiKey: googleApiKey,
        },
        systemPrompt: "You are a test assistant. Execute simple actions.",
      });

      console.log("   ✅ CUA agent created");

      // Try a simple action
      console.log("\n🎯 Executing simple CUA task...");
      const result = await cuaAgent.execute({
        instruction: "Click on the 'More information...' link on this page.",
        maxSteps: 3,
      });

      console.log(`   Result success: ${result.success}`);
      console.log(`   Steps taken: ${result.steps?.length || 0}`);
      
      if (result.success) {
        console.log("   ✅ CUA agent executed successfully!");
      } else {
        console.log("   ❌ CUA agent execution failed");
        console.log(`   Error: ${result.error || "Unknown error"}`);
      }
    } catch (error: any) {
      console.log("   ❌ CUA agent failed:");
      console.log(`   Error: ${error.message}`);
      if (error.cause) {
        console.log(`   Cause: ${JSON.stringify(error.cause, null, 2)}`);
      }
    }

    // Test 2: Try with a different model (gemini-2.0-flash-exp)
    console.log("\n🤖 Test 2: Creating CUA agent with gemini-2.0-flash-exp...");
    
    try {
      // Navigate back to example.com
      await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const cuaAgent2 = stagehand.agent({
        mode: "cua",
        model: {
          modelName: "google/gemini-2.0-flash-exp",
          apiKey: googleApiKey,
        },
        systemPrompt: "You are a test assistant. Execute simple actions.",
      });

      console.log("   ✅ CUA agent created with gemini-2.0-flash-exp");

      const result2 = await cuaAgent2.execute({
        instruction: "Click on the 'More information...' link on this page.",
        maxSteps: 3,
      });

      console.log(`   Result success: ${result2.success}`);
      
      if (result2.success) {
        console.log("   ✅ CUA agent with gemini-2.0-flash-exp executed successfully!");
      } else {
        console.log("   ❌ CUA agent execution failed");
      }
    } catch (error: any) {
      console.log("   ❌ CUA agent with gemini-2.0-flash-exp failed:");
      console.log(`   Error: ${error.message}`);
    }

    // Test 3: Try stagehand.act() instead of agent
    console.log("\n🤖 Test 3: Using stagehand.act() directly...");
    
    try {
      await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const actResult = await stagehand.act({
        action: "Click on the 'More information...' link",
      });

      console.log(`   ✅ stagehand.act() completed`);
      console.log(`   Result: ${JSON.stringify(actResult)}`);
    } catch (error: any) {
      console.log("   ❌ stagehand.act() failed:");
      console.log(`   Error: ${error.message}`);
    }

  } catch (error: any) {
    console.error("\n❌ Test failed with error:");
    console.error(error);
  } finally {
    console.log("\n🧹 Cleaning up...");
    await stagehand.close();
    console.log("   ✅ Stagehand closed");
  }

  console.log("\n" + "═".repeat(50));
  console.log("✅ Tests complete!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
