import "dotenv/config";
import { SessionManager } from "./session-manager.js";

async function main() {
  // Initialize session manager (mode determined by BROWSER_MODE env var or defaults to BROWSERBASE)
  const sessionManager = new SessionManager({
    sessionName: process.env.SESSION_NAME || "linkedin",
    headless: process.env.HEADLESS === "true",
  });

  const mode = sessionManager.getMode();
  console.log(`🚀 Starting login session in ${mode} mode...`);

  // Create a new login session
  const { page, browser, sessionInfo, cleanup } = await sessionManager.createLoginSession();

  // Navigate to LinkedIn so you can log in
  await page.goto("https://www.linkedin.com");

  if (mode === "BROWSERBASE") {
    console.log("\n" + "=".repeat(60));
    console.log("🔗 BROWSERBASE URLs:");
    console.log("=".repeat(60));
    console.log("📺 Session View (Dashboard - requires Browserbase login):");
    console.log(`   https://browserbase.com/sessions/${sessionInfo.sessionId}`);
    console.log("\n🔌 CDP Connection URL (for Playwright/automation):");
    console.log(`   ${sessionInfo.connectUrl}`);
    
    // Check if there's a viewer URL or embed URL available
    console.log("\n💻 For Frontend Display:");
    if (sessionInfo.viewerUrl) {
      console.log("   ✅ LIVE VIEWER URL (for iframe embedding):");
      console.log(`   ${sessionInfo.viewerUrl}`);
      console.log("\n   📦 Embed in frontend like this:");
      console.log(`   <iframe src="${sessionInfo.viewerUrl}" width="100%" height="600" />`);
    } else {
      console.log("   ⚠️  Live viewer URL not available (may need bb.sessions.debug())");
    }
    console.log("\n   📺 Dashboard URL (requires Browserbase login):");
    console.log(`   https://browserbase.com/sessions/${sessionInfo.sessionId}`);
    
    if (sessionInfo.contextId) {
      console.log("\n🔑 Context ID (for reusing login state):");
      console.log(`   ${sessionInfo.contextId}`);
      console.log(`   https://browserbase.com/contexts/${sessionInfo.contextId}`);
    }
    console.log("\n💡 Tip: For frontend display, you may need to generate a viewer token!");
    console.log("=".repeat(60) + "\n");
  } else {
    console.log("🌐 Browser opened locally. Please log in to LinkedIn in the browser window.");
  }

  console.log("⏳ Waiting for you to complete login (1 minute)…");

  // Give you time to log in manually
  await new Promise((resolve) => setTimeout(resolve, 60000));

  // Save session info (context ID for Browserbase, userDataDir for local)
  sessionManager.saveSessionInfo(sessionInfo);

  console.log(`✔ Login session saved successfully!`);
  console.log(`📝 Session info saved to: .sessions/${process.env.SESSION_NAME || "linkedin"}-session.json`);

  // Cleanup
  await cleanup();
  console.log("✅ Login session setup complete!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
