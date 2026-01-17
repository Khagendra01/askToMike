import "dotenv/config";
import { type PostData, type DecisionResult } from "./comment_decision_tool.js";

/**
 * Simple standalone test script for the decision tool
 * Tests the tool via HTTP endpoint
 * 
 * Usage: npm run test-tool-simple
 * Or: tsx test_tool_simple.ts
 */

async function main() {
  console.log("🧪 Testing Decision Tool via HTTP Endpoint\n");

  // Configure endpoint - use IP with port 5000
  const toolServerUrl = process.env.TOOL_SERVER_URL || "http://100.35.90.89/decide";
  console.log(`🔗 Endpoint: ${toolServerUrl}\n`);

  // ===== CUSTOMIZE YOUR TEST DATA HERE =====
  const testPost: PostData = {
    postText: `Excited to share that I've just launched a new AI-powered tool that helps developers automate their workflows! 🚀 

The tool uses advanced machine learning to understand code patterns and suggest optimizations. It's been a game-changer for our team's productivity.

What are your thoughts on AI automation in software development? Have you tried any AI coding assistants?`,
    
    mediaUrls: [
      "https://example.com/screenshot1.jpg",
      "https://example.com/demo.png"
    ],
    
    // videoUrls: ["https://example.com/demo.mp4"] // Optional
  };
  // ==========================================

  console.log("📝 Test Post Data:");
  console.log(`   Text: ${testPost.postText.substring(0, 100)}...`);
  console.log(`   Images: ${testPost.mediaUrls?.length || 0}`);
  console.log(`   Videos: ${testPost.videoUrls?.length || 0}\n`);

  try {
    console.log("🔄 Sending POST request to endpoint...\n");
    
    const startTime = Date.now();
    const response = await fetch(toolServerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testPost),
    });
    
    const duration = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json() as DecisionResult;
    
    console.log("✅ HTTP request successful!");
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log(`📡 Status: ${response.status} ${response.statusText}\n`);
    
    console.log("📊 Decision Result:");
    console.log("─".repeat(60));
    console.log(`   Should Comment: ${result.shouldComment ? "✅ YES" : "❌ NO"}`);
    console.log(`   Comment Text:`);
    if (result.commentText) {
      console.log(`   "${result.commentText}"`);
    } else {
      console.log(`   (empty - no comment generated)`);
    }
    console.log("─".repeat(60));
    
    // Exit with success
    process.exit(0);
    
  } catch (error) {
    console.error("\n❌ HTTP request failed!");
    console.error("Error:", error);
    if (error instanceof Error) {
      console.error("Message:", error.message);
      if (error.stack) {
        console.error("\nStack trace:");
        console.error(error.stack);
      }
    }
    console.error(`\n💡 Make sure your tool server is running at: ${toolServerUrl}`);
    process.exit(1);
  }
}

main();

