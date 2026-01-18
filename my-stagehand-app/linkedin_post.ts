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
      `linkedin-${safeLabel}-${timestamp}.png`
    );
    const htmlPath = path.join(
      DIAGNOSTICS_DIR,
      `linkedin-${safeLabel}-${timestamp}.html`
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

  const firstPostText = await playwrightPage
    .locator("div.feed-shared-update-v2")
    .first()
    .textContent()
    .catch(() => null);

  if (firstPostText && firstPostText.includes(normalized)) {
    return true;
  }

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
      url.includes("/checkpoint/") ||
      url.includes("challenge") ||
      url.includes("authwall") ||
      url.includes("security")
    ) {
      return { status: "blocked", detail: `Detected challenge URL: ${url}` };
    }

    const blockText = await playwrightPage
      .locator(
        "text=/security verification|are you human|captcha|unusual activity|suspicious activity/i"
      )
      .first()
      .textContent()
      .catch(() => null);
    if (blockText) {
      return { status: "blocked", detail: "Detected verification text on page" };
    }

    const errorToast = await playwrightPage
      .locator(
        '[role="alert"]:has-text("Something went wrong"), [role="alert"]:has-text("couldn’t"), [role="alert"]:has-text("could not")'
      )
      .first()
      .textContent()
      .catch(() => null);
    if (errorToast) {
      return { status: "error", detail: errorToast.trim() };
    }

    const successToast = await playwrightPage
      .locator(
        '[role="alert"]:has-text("Post published"), [role="alert"]:has-text("Post shared"), [role="alert"]:has-text("Your post is live")'
      )
      .first()
      .textContent()
      .catch(() => null);
    if (successToast) {
      return { status: "success", detail: successToast.trim() };
    }

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
    const tempFilePath = path.join(os.tmpdir(), `linkedin-upload-${Date.now()}${ext}`);
    
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
  const tempFilePath = path.join(os.tmpdir(), `linkedin-upload-${Date.now()}${ext}`);

  fs.writeFileSync(tempFilePath, Buffer.from(buffer));
  console.log(`✓ Image saved to: ${tempFilePath}`);
  return tempFilePath;
}


/**
 * Upload file using Playwright's file chooser API.
 * This is the only reliable way to upload files to LinkedIn.
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

  // Try multiple selectors for "Upload from computer" button/label
  const selectors = [
    'label:has-text("Upload from computer")',
    'button:has-text("Upload from computer")',
    '[aria-label*="Upload from computer"]',
    'label[for*="file"]',
    'input[type="file"] + label',
  ];

  let clicked = false;
  for (const selector of selectors) {
    try {
      // Wait for file chooser and click the button simultaneously
      // This creates the trusted user gesture LinkedIn requires
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
  const imageUrl = process.env.IMAGE_URL ?? "https://dbukjj6eu5tsf.cloudfront.net/sidearm.sites/fsdb.sidearmsports.com/images/logos/site/site.png"; // Only use image if explicitly provided
  const keepBrowserOpen = process.env.KEEP_BROWSER_OPEN === "true";

  // === Initialize session manager ===
  const sessionManager = new SessionManager({
    sessionName: process.env.SESSION_NAME || "linkedin",
    headless: process.env.HEADLESS === "true",
  });

  const mode = sessionManager.getMode();
  console.log(`🚀 Starting LinkedIn post in ${mode} mode...`);

  // === Initialize Stagehand with persistent session ===
  const session = await sessionManager.initializeStagehand({
    model: "google/gemini-3-flash-preview",
  });

  console.log("🤖 Stagehand session initialized");

  // Get the page from Stagehand
  const page = session.page;

  // Navigate to LinkedIn feed
  await page.goto("https://www.linkedin.com/feed/", {
    waitUntil: "domcontentloaded",
  });
  console.log("➡️ Navigated to LinkedIn feed");

  // Get Playwright page for file uploads (if available, mainly for Browserbase)
  const playwrightPage = session.playwrightPage || page;

  // Wait a moment to ensure page is ready
  await new Promise((resolve) => setTimeout(resolve, 500));

  // === Open post dialog ===
  await session.stagehand.act("click on the 'Start a post' area");
  console.log("📝 Opening post editor");

  // === Enter post text ===
  await session.stagehand.act(`type "${postText}" into the post editor`);

  // === If imageUrl exists, attach image ===
  let tempFilePath: string | null = null;
  if (imageUrl) {
    try {
      // Download image to temporary file
      tempFilePath = await downloadImageToTempFile(imageUrl);

      // Open image upload dialog with Stagehand
      await session.stagehand.act(
        "click the 'Add a photo' button to open image upload"
      );
      console.log("📸 Opened image upload");

      // Wait a bit for the upload dialog to fully appear
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Use Playwright's file chooser API to upload the file
      await uploadFileWithPlaywright(playwrightPage, tempFilePath);
      console.log("🖼 Image uploaded successfully");

      // Wait for the upload to process and the Next button to appear
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Click the "Next" button that appears after image upload
      await session.stagehand.act("click the 'Next' button to continue after image upload");
      console.log("➡️ Clicked Next button");
    } catch (error) {
      console.error(`❌ Failed to upload image: ${error}`);
      throw error;
    }
  }

  // === Click "Post" ===
  await session.stagehand.act("click the 'Post' button");
  console.log("📤 Clicked Post button");

  // Wait for post to process - LinkedIn may show confirmation or process the post
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Check if there's a confirmation/publish button using Playwright
  try {
    // Try multiple selectors for confirmation buttons
    const confirmSelectors = [
      'button:has-text("Publish")',
      'button:has-text("Confirm")',
      'button[aria-label*="Publish"]',
      'button[aria-label*="Confirm"]',
      '[data-control-name="share.post"]',
    ];

    let confirmed = false;
    for (const selector of confirmSelectors) {
      try {
        const button = await playwrightPage.locator(selector).first();
        if (await button.isVisible({ timeout: 2000 })) {
          await button.click();
          console.log("✓ Clicked confirmation/publish button");
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

  // Wait for post dialog to close and post to be processed
  const outcome = await waitForPostOutcome(playwrightPage, postText);
  if (outcome.status === "success") {
    console.log(`✔ Post verified: ${outcome.detail}`);
  } else if (outcome.status === "blocked") {
    console.log(`🚫 Possible bot detection: ${outcome.detail}`);
    await captureDiagnostics(playwrightPage, "blocked");
  } else if (outcome.status === "error") {
    console.log(`❌ LinkedIn error: ${outcome.detail}`);
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
