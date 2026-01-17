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
    console.log(
      "🔗 Open this link in your browser and log in to LinkedIn:",
      `https://browserbase.com/sessions/${sessionInfo.sessionId}`
    );
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
