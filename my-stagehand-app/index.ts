import "dotenv/config";
import { Browserbase } from "@browserbasehq/sdk";
import { chromium } from "playwright-core";
import fs from "fs";

async function main() {
  // 1) Read saved context ID
  const { contextId } = JSON.parse(
    fs.readFileSync("linkedin-context.json", "utf-8")
  );

  const bb = new Browserbase({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });

  // 2) Create a new session using the saved context
  const session = await bb.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    browserSettings: {
      blockAds: true,
      viewport: {
        width: 1288,
        height: 711,
      },
      context: { id: contextId, persist: false },
    },
  });

  console.log(
    "🔗 Session live view (optional):",
    `https://browserbase.com/sessions/${session.id}`
  );

  // 3) Connect Playwright to the live remote browser
  const browser = await chromium.connectOverCDP(session.connectUrl);
  const page = browser.contexts()[0].pages()[0];

  // 4) Navigate to the LinkedIn feed
  await page.goto("https://www.linkedin.com/feed/", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(5000); // give feed time to load

  // 5) Extract the first post text
  const firstPost = await page.$eval(
    "div.feed-shared-update-v2",
    (el) => (el as HTMLElement).innerText.trim()
  );

  console.log("📌 First LinkedIn post text:\n", firstPost.slice(0, 300) + "...");

  // 6) Cleanup: close Playwright browser connection
  await browser.close();

  // 7) Explicitly request session release (optional)
  await bb.sessions.update(session.id, {
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    status: "REQUEST_RELEASE",
  });

  console.log("🛑 Session released successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
