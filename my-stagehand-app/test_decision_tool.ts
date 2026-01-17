import "dotenv/config";
import { analyzePostAndDecide, startToolServer, type PostData } from "./comment_decision_tool.js";
import http from "http";

/**
 * Test script to verify the decision tool works
 * Tests both direct function call and HTTP endpoint
 */

async function testDirectFunction() {
  console.log("🧪 Testing direct function call...\n");

  const testPost: PostData = {
    postText: "Excited to share that I've just launched a new AI-powered tool that helps developers automate their workflows! 🚀 What are your thoughts on AI automation?",
    mediaUrls: [
      "https://example.com/image1.jpg",
      "https://example.com/image2.png"
    ],
  };

  try {
    console.log("📝 Test Post Data:");
    console.log(`   Text: ${testPost.postText.substring(0, 80)}...`);
    console.log(`   Images: ${testPost.mediaUrls?.length || 0}\n`);

    const result = await analyzePostAndDecide(testPost);
    
    console.log("✅ Function call successful!");
    console.log("\n📊 Decision Result:");
    console.log(`   Should Comment: ${result.shouldComment}`);
    console.log(`   Comment Text: ${result.commentText || "(empty)"}\n`);
    
    return true;
  } catch (error) {
    console.error("❌ Function call failed:", error);
    return false;
  }
}

async function testHttpEndpoint(port: number = 5000) {
  console.log("🧪 Testing HTTP endpoint...\n");

  return new Promise<boolean>((resolve) => {
    // Start the server
    const server = startToolServer(port);
    
    // Wait a moment for server to start
    setTimeout(async () => {
      const testPost: PostData = {
        postText: "Just finished reading an amazing book on software architecture. The principles of clean code and scalable systems are more important than ever. What books have influenced your development journey?",
        mediaUrls: ["https://example.com/book-cover.jpg"],
      };

      try {
        console.log("📝 Sending POST request to /decide endpoint...");
        console.log(`   Post text: ${testPost.postText.substring(0, 60)}...\n`);

        const response = await fetch(`http://localhost:${port}/decide`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testPost),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        
        console.log("✅ HTTP endpoint test successful!");
        console.log("\n📊 Decision Result:");
        console.log(`   Should Comment: ${result.shouldComment}`);
        console.log(`   Comment Text: ${result.commentText || "(empty)"}\n`);

        server.close(() => {
          resolve(true);
        });
      } catch (error) {
        console.error("❌ HTTP endpoint test failed:", error);
        server.close(() => {
          resolve(false);
        });
      }
    }, 1000);
  });
}

async function main() {
  console.log("=".repeat(60));
  console.log("🔧 Decision Tool Verification Test");
  console.log("=".repeat(60));
  console.log();

  // Check for API key
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ Missing API key!");
    console.error("   Please set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY in your .env file");
    process.exit(1);
  }
  console.log("✓ API key found\n");

  // Test 1: Direct function call
  const directTestPassed = await testDirectFunction();
  
  console.log("-".repeat(60));
  console.log();

  // Test 2: HTTP endpoint
  const port = parseInt(process.env.TOOL_SERVER_PORT || "5000");
  const httpTestPassed = await testHttpEndpoint(port);

  // Summary
  console.log("=".repeat(60));
  console.log("📋 Test Summary");
  console.log("=".repeat(60));
  console.log(`   Direct Function: ${directTestPassed ? "✅ PASSED" : "❌ FAILED"}`);
  console.log(`   HTTP Endpoint:   ${httpTestPassed ? "✅ PASSED" : "❌ FAILED"}`);
  console.log();

  if (directTestPassed && httpTestPassed) {
    console.log("🎉 All tests passed! The tool is ready to use.");
    process.exit(0);
  } else {
    console.log("⚠️  Some tests failed. Please check the errors above.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

