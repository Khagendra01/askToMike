import "dotenv/config";
import { SessionManager } from "./session-manager.js";
import { Page } from "playwright-core";
import fs from "fs";
import path from "path";
import os from "os";

type PostOutcome =
  | { status: "success"; detail: string }
  | { status: "error"; detail: string }
  | { status: "blocked"; detail: string }
  | { status: "unknown"; detail: string };

const DIAGNOSTICS_DIR = path.join(process.cwd(), ".diagnostics");

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureDiagnostics(playwrightPage: Page, label: string): Promise<void> {
  try {
    fs.mkdirSync(DIAGNOSTICS_DIR, { recursive: true });
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "-");
    const timestamp = Date.now();
    const screenshotPath = path.join(
      DIAGNOSTICS_DIR,
      `x-${safeLabel}-${timestamp}.png`
    );
    const htmlPath = path.join(
      DIAGNOSTICS_DIR,
      `x-${safeLabel}-${timestamp}.html`
    );

    await playwrightPage.screenshot({ path: screenshotPath, fullPage: true });
    const html = await playwrightPage.content();
    fs.writeFileSync(htmlPath, html);
    console.log(`📸 Saved diagnostics: ${screenshotPath}`);
    console.log(`🧾 Saved diagnostics: ${htmlPath}`);
  } catch (error) {
    console.log(`⚠️ Failed to save diagnostics: ${error}`);
  }
}

async function postAppearsInFeed(
  playwrightPage: Page,
  postText: string
): Promise<boolean> {
  const normalized = postText.trim();
  if (!normalized) {
    return false;
  }

  // X/Twitter uses article elements for tweets
  const firstPostText = await playwrightPage
    .locator("article[data-testid='tweet']")
    .first()
    .textContent()
    .catch(() => null);

  if (firstPostText && firstPostText.includes(normalized)) {
    return true;
  }

  // Alternative check for different tweet structures
  const alternativeCheck = await playwrightPage
    .locator("article")
    .first()
    .textContent()
    .catch(() => null);

  return Boolean(alternativeCheck && alternativeCheck.includes(normalized));
}

async function waitForPostOutcome(
  playwrightPage: Page,
  postText: string
): Promise<PostOutcome> {
  const timeoutMs = 20000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const url = playwrightPage.url();
    if (
      url.includes("/account/") ||
      url.includes("challenge") ||
      url.includes("auth") ||
      url.includes("suspended")
    ) {
      return { status: "blocked", detail: `Detected challenge/restriction URL: ${url}` };
    }

    const blockText = await playwrightPage
      .locator(
        "text=/suspended|verify|challenge|unusual activity|suspicious activity/i"
      )
      .first()
      .textContent()
      .catch(() => null);
    if (blockText) {
      return { status: "blocked", detail: "Detected verification text on page" };
    }

    const errorToast = await playwrightPage
      .locator(
        '[role="alert"]:has-text("Something went wrong"), [role="alert"]:has-text("error"), [role="alert"]:has-text("failed")'
      )
      .first()
      .textContent()
      .catch(() => null);
    if (errorToast) {
      return { status: "error", detail: errorToast.trim() };
    }

    // Check for success indicators in X/Twitter
    if (await postAppearsInFeed(playwrightPage, postText)) {
      return { status: "success", detail: "Post found in feed" };
    }

    await delay(1000);
  }

  return {
    status: "unknown",
    detail: "Timed out waiting for post to appear or errors to surface",
  };
}

/**
 * Download image from URL to a temporary local file
 * Handles both file:// URLs (local files) and http/https URLs (remote files)
 */
async function downloadImageToTempFile(imageUrl: string): Promise<string> {
  console.log(`📥 Processing image from: ${imageUrl}`);
  
  // Handle file:// URLs (local files from Python backend)
  if (imageUrl.startsWith("file://")) {
    // Extract the file path from file:// URL
    // file:///C:/path/to/file or file://C:/path/to/file
    let filePath = imageUrl.replace(/^file:\/\/+/, "");
    
    // On Windows, remove leading slash if present: file:///C:/ -> C:/
    if (process.platform === "win32" && filePath.match(/^\/[A-Z]:/)) {
      filePath = filePath.substring(1);
    }
    
    // Decode URL encoding if present
    try {
      filePath = decodeURIComponent(filePath);
    } catch (e) {
      // If decoding fails, use original path
    }
    
    console.log(`📁 Reading local file: ${filePath}`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`Image file not found: ${filePath}`);
    }
    
    // Copy to a new temp file (in case original gets deleted)
    const ext = path.extname(filePath) || ".png";
    const tempFilePath = path.join(os.tmpdir(), `x-upload-${Date.now()}${ext}`);
    
    fs.copyFileSync(filePath, tempFilePath);
    console.log(`✓ Image copied to: ${tempFilePath}`);
    return tempFilePath;
  }
  
  // Handle http/https URLs (remote files)
  console.log(`🌐 Downloading remote image...`);
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const ext = path.extname(new URL(imageUrl).pathname) || ".jpg";
  const tempFilePath = path.join(os.tmpdir(), `x-upload-${Date.now()}${ext}`);

  fs.writeFileSync(tempFilePath, Buffer.from(buffer));
  console.log(`✓ Image saved to: ${tempFilePath}`);
  return tempFilePath;
}

/**
 * Upload file using Playwright's file chooser API.
 * This is the only reliable way to upload files to X/Twitter.
 */
async function uploadFileWithPlaywright(
  playwrightPage: Page,
  filePath: string
): Promise<void> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  console.log(`📤 Uploading file using Playwright file chooser: ${filePath}`);

  const canWaitForEvent =
    typeof (playwrightPage as any).waitForEvent === "function";

  const trySetInputFiles = async (): Promise<boolean> => {
    const selectors = [
      'input[type="file"][accept*="image"]',
      'input[type="file"]',
    ];

    for (const selector of selectors) {
      try {
        if (typeof (playwrightPage as any).locator === "function") {
          const locator = (playwrightPage as any).locator(selector).first();
          if ((await locator.count()) > 0) {
            await locator.setInputFiles(filePath);
            return true;
          }
        } else if (typeof (playwrightPage as any).$ === "function") {
          const handle = await (playwrightPage as any).$(selector);
          if (handle) {
            await handle.setInputFiles(filePath);
            return true;
          }
        }
      } catch (error) {
        continue;
      }
    }

    return false;
  };

  if (!canWaitForEvent) {
    const uploaded = await trySetInputFiles();
    if (!uploaded) {
      throw new Error("Could not find a file input to upload the image");
    }
    console.log("✓ File uploaded successfully via input set");
    return;
  }

  // Try multiple selectors for media upload button in X/Twitter
  const selectors = [
    '[data-testid="attach"]',
    '[aria-label*="Media"]',
    '[aria-label*="Add photos"]',
    'button[aria-label*="Add photos"]',
    'input[type="file"]',
  ];

  let clicked = false;
  for (const selector of selectors) {
    try {
      // Wait for file chooser and click the button simultaneously
      // This creates the trusted user gesture X/Twitter requires
      const fileChooserPromise = playwrightPage.waitForEvent("filechooser", {
        timeout: 5000,
      });
      await playwrightPage.click(selector, { timeout: 3000 });

      // Get the file chooser and set files
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(filePath);
      clicked = true;
      break;
    } catch (error) {
      // Try next selector
      continue;
    }
  }

  if (!clicked) {
    // Fallback: try clicking file input directly
    try {
      const fileChooserPromise = playwrightPage.waitForEvent("filechooser", {
        timeout: 5000,
      });
      await playwrightPage.click('input[type="file"]', { timeout: 3000 });
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(filePath);
    } catch (error) {
      const uploaded = await trySetInputFiles();
      if (!uploaded) {
        throw new Error(
          `Could not trigger file chooser with any method. Last error: ${error}`
        );
      }
    }
  }

  console.log("✓ File uploaded successfully via Playwright");
}

async function main() {
  // === Input ===
  const postText = process.env.POST_TEXT ?? "Lets go";
  const imageUrl = process.env.IMAGE_URL ?? ""; // Only use image if explicitly provided
  const keepBrowserOpen = process.env.KEEP_BROWSER_OPEN === "true";

  // === Initialize session manager ===
  const sessionManager = new SessionManager({
    sessionName: process.env.SESSION_NAME || "linkedin",
    headless: process.env.HEADLESS === "true",
  });

  const mode = sessionManager.getMode();
  console.log(`🚀 Starting X/Twitter post in ${mode} mode...`);

  // === Initialize Stagehand with persistent session ===
  const session = await sessionManager.initializeStagehand({
    model: "google/gemini-3-flash-preview",
  });

  console.log("🤖 Stagehand session initialized");

  // Get the page from Stagehand
  const page = session.page;

  // Navigate to X/Twitter home
  await page.goto("https://x.com/home", {
    waitUntil: "domcontentloaded",
  });
  console.log("➡️ Navigated to X.com/home");

  // Get Playwright page for file uploads (if available, mainly for Browserbase)
  const playwrightPage = session.playwrightPage || page;

  // Wait a moment to ensure page is ready
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // === Find and click the post composer textarea ===
  // X/Twitter uses a textarea or div with contenteditable for the post input
  await session.stagehand.act("click on the text area or input field where you can type a post");
  console.log("📝 Opening post composer");

  // Wait a bit for the composer to be ready
  await new Promise((resolve) => setTimeout(resolve, 500));

  // === Enter post text ===
  await session.stagehand.act(`type "${postText}" into the post text area`);
  console.log("✍️ Entered post text");

  // === If imageUrl exists, attach image ===
  let tempFilePath: string | null = null;
  if (imageUrl) {
    try {
      // Download image to temporary file
      tempFilePath = await downloadImageToTempFile(imageUrl);

      // Open image upload dialog with Stagehand
      await session.stagehand.act(
        "click the media or photo button to add an image"
      );
      console.log("📸 Opened image upload");

      // Wait a bit for the upload dialog to fully appear
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Use Playwright's file chooser API to upload the file
      await uploadFileWithPlaywright(playwrightPage, tempFilePath);
      console.log("🖼 Image uploaded successfully");

      // Wait for the upload to process
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`❌ Failed to upload image: ${error}`);
      throw error;
    }
  }

  // === Click "Post" button ===
  await session.stagehand.act("click the 'Post' button to publish the tweet");
  console.log("📤 Clicked Post button");

  // Wait for post to process
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Check if there's a confirmation button using Playwright
  try {
    // Try multiple selectors for X/Twitter post button
    const confirmSelectors = [
      '[data-testid="tweetButton"]',
      'button:has-text("Post")',
      'button[aria-label*="Post"]',
      '[role="button"]:has-text("Post")',
    ];

    let confirmed = false;
    for (const selector of confirmSelectors) {
      try {
        const button = await playwrightPage.locator(selector).first();
        if (await button.isVisible({ timeout: 2000 })) {
          await button.click();
          console.log("✓ Clicked post confirmation button");
          confirmed = true;
          break;
        }
      } catch (e) {
        // Try next selector
        continue;
      }
    }

    if (!confirmed) {
      console.log("ℹ️ No confirmation button found, checking if post was submitted");
    }
  } catch (error) {
    console.log("ℹ️ Could not find confirmation button");
  }

  // Wait for post to be processed and appear in feed
  const outcome = await waitForPostOutcome(playwrightPage, postText);
  if (outcome.status === "success") {
    console.log(`✔ Post verified: ${outcome.detail}`);
  } else if (outcome.status === "blocked") {
    console.log(`🚫 Possible bot detection or account restriction: ${outcome.detail}`);
    await captureDiagnostics(playwrightPage, "blocked");
  } else if (outcome.status === "error") {
    console.log(`❌ X/Twitter error: ${outcome.detail}`);
    await captureDiagnostics(playwrightPage, "error");
  } else {
    console.log(`⚠️ Unknown post status: ${outcome.detail}`);
    await captureDiagnostics(playwrightPage, "unknown");
  }

  if (tempFilePath && fs.existsSync(tempFilePath)) {
    fs.unlinkSync(tempFilePath);
    console.log("🧹 Cleaned up temporary file");
  }

  console.log("✔ Post submission process completed");

  // === Cleanup ===
  if (keepBrowserOpen) {
    console.log("🕵️ KEEP_BROWSER_OPEN=true, leaving session open for inspection");
  } else {
    await sessionManager.cleanup(session);
    console.log("🛑 Session cleaned up");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
