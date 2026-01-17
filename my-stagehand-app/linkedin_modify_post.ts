import "dotenv/config";
import { Browserbase } from "@browserbasehq/sdk";
import { Stagehand } from "@browserbasehq/stagehand";
import { chromium, Browser, Page } from "playwright-core";
import fs from "fs";

/**
 * Interface for post modification request
 */
interface ModifyPostRequest {
  action: "edit" | "delete";
  postIdentifier: "latest" | "second" | "third" | number; // "latest", "second", "third", or specific index (1-based)
  newText?: string; // Required if action is "edit"
}

/**
 * Connect Playwright to the same browser instance that Stagehand is using.
 * This enables us to use Playwright's reliable text editing APIs.
 */
async function connectPlaywrightToBrowserbase(
  session: { id: string; connectUrl: string }
): Promise<{ browser: Browser; page: Page } | null> {
  try {
    console.log("🔗 Connecting Playwright to Browserbase session...");
    const browser = await chromium.connectOverCDP(session.connectUrl);

    // Get the current page from the browser context
    let page: Page;
    if (browser.contexts().length > 0) {
      const context = browser.contexts()[0];
      if (context.pages().length > 0) {
        page = context.pages()[0];
      } else {
        page = await context.newPage();
      }
    } else {
      const context = await browser.newContext();
      page = await context.newPage();
    }

    console.log("✓ Playwright connected successfully");
    return { browser, page };
  } catch (error) {
    console.error(`❌ Failed to connect Playwright: ${error}`);
    return null;
  }
}

async function main() {
  // === Input ===
  const action = (process.env.POST_ACTION || "edit") as "edit" | "delete";
  const postIdentifier = process.env.POST_IDENTIFIER || "latest"; // "latest", "second", "third", or number
  const newText = process.env.NEW_POST_TEXT || undefined; // Required for edit action

  // Parse postIdentifier
  let postIndex: number | "latest" | "second" | "third";
  if (postIdentifier === "latest" || postIdentifier === "second" || postIdentifier === "third") {
    postIndex = postIdentifier;
  } else {
    const parsed = parseInt(postIdentifier);
    postIndex = isNaN(parsed) ? "latest" : parsed;
  }

  const request: ModifyPostRequest = {
    action,
    postIdentifier: postIndex,
    newText,
  };

  // Validate request
  if (request.action === "edit" && !request.newText) {
    throw new Error("NEW_POST_TEXT is required when POST_ACTION is 'edit'");
  }

  console.log(`🎯 Action: ${request.action.toUpperCase()}`);
  console.log(`📌 Target post: ${request.postIdentifier}`);
  if (request.action === "edit") {
    console.log(`📝 New text: ${request.newText?.substring(0, 60)}...`);
  }

  // === Load saved login context ===
  const { contextId } = JSON.parse(
    fs.readFileSync("linkedin-context.json", "utf-8")
  );

  const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });

  // === Start a new Browserbase session with the saved login state ===
  const session = await bb.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    keepAlive: true, // Prevents session from auto-closing after agent.execute()
    timeout: 15 * 60, // 15 minutes in seconds (max is 21600 seconds = 6 hours)
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
    "🔗 Live session (optional view):",
    `https://browserbase.com/sessions/${session.id}`
  );

  // === Initialize Stagehand using the existing session ===
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    browserbaseSessionID: session.id,
    model: "google/gemini-3-flash-preview",
  });

  await stagehand.init();
  console.log("🤖 Stagehand session initialized");

  // Get the page from context
  const page = stagehand.context.pages()[0];

  // Navigate to LinkedIn
  await page.goto("https://www.linkedin.com/", {
    waitUntil: "domcontentloaded",
  });
  console.log("➡️ Navigated to LinkedIn");

  // Wait for page to load
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // === Validate API key ===
  const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!googleApiKey) {
    throw new Error(
      "Missing Google API key! Please set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY environment variable."
    );
  }
  console.log("✓ Google API key found");

  // === Create autonomous agent (UI interaction only) ===
  const agent = stagehand.agent({
    mode: "cua", // Enable Computer Use Agent mode
    model: {
      modelName: "google/gemini-2.5-computer-use-preview-10-2025",
      apiKey: googleApiKey,
    },
    systemPrompt: `You are a LinkedIn profile navigation agent. Follow instructions exactly:
- Click buttons and links when told
- Type text when provided
- Scroll when instructed
- Wait when asked to wait
- Navigate through profile pages accurately
Do nothing else.`,
  });

  console.log("🤖 Autonomous agent created");

  // === Step 1: Navigate to Profile ===
  console.log("\n📋 Step 1: Navigating to profile...");
  
  const navigateToProfilePrompt = `Navigate to your LinkedIn profile by following these steps:
1. Look for the "Me" button or icon in the top navigation bar (usually in the top right area)
2. Click on "Me" - this may open a dropdown menu
3. In the dropdown menu, look for "View Profile" or "Profile" option and click it
4. Wait 3 seconds for the profile page to load
5. Stop.

If you see a "Me" button with a dropdown arrow, click it first to open the menu, then click "View Profile".
If you see your profile picture or name in the top navigation, you can also click that to access profile options.
The goal is to get to your own LinkedIn profile page.`;

  await agent.execute({
    instruction: navigateToProfilePrompt,
    maxSteps: 10,
    highlightCursor: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 3000));
  console.log("✓ Navigated to profile");

  // === Step 2: Scroll to Posts Section ===
  console.log("\n📋 Step 2: Finding posts section...");

  const findPostsPrompt = `Scroll down on the profile page to find the "Posts" section. Look for:
- A section labeled "Posts" or "Activity"
- A button or link that says "Show all posts" or "See all activity"
- Scroll down gradually if needed
- Once you see posts or a "Show all posts" button, click on "Show all posts" if it exists
- Wait 2 seconds after clicking
- Stop.

If you already see posts listed on the profile page, you don't need to click "Show all posts". Just make sure you can see the posts section.`;

  await agent.execute({
    instruction: findPostsPrompt,
    maxSteps: 8,
    highlightCursor: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 3000));
  console.log("✓ Found posts section");

  // === Step 3: Identify Target Post ===
  console.log("\n📋 Step 3: Identifying target post...");

  // Determine which post to target
  let postTargetDescription = "";
  if (request.postIdentifier === "latest") {
    postTargetDescription = "the first/latest post at the top of the posts list";
  } else if (request.postIdentifier === "second") {
    postTargetDescription = "the second post in the list (the one below the first/latest post)";
  } else if (request.postIdentifier === "third") {
    postTargetDescription = "the third post in the list";
  } else if (typeof request.postIdentifier === "number") {
    postTargetDescription = `post number ${request.postIdentifier} in the list (counting from the top, where 1 is the latest post)`;
  }

  const identifyPostPrompt = `Find ${postTargetDescription} in the posts list. 
- Look at the posts displayed on the page
- Identify which post is ${postTargetDescription}
- You don't need to click anything yet, just visually identify it
- Stop.

The posts are typically displayed in a vertical list, with the most recent post at the top.`;

  await agent.execute({
    instruction: identifyPostPrompt,
    maxSteps: 5,
    highlightCursor: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log(`✓ Identified target post: ${postTargetDescription}`);

  // === Step 4: Open Post Options Menu ===
  console.log("\n📋 Step 4: Opening post options menu...");

  const openOptionsPrompt = `On ${postTargetDescription}, find and click the three dots menu icon (⋯) or "More" button.
- Look for a three-dot icon (⋯) or "More" button on the post
- This is usually located in the top-right corner of the post
- Click on it to open a dropdown menu or modal
- Wait 2 seconds for the menu to appear
- Stop.

The three dots icon is typically a small icon with three horizontal dots, often found near the top-right of each post.`;

  await agent.execute({
    instruction: openOptionsPrompt,
    maxSteps: 8,
    highlightCursor: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log("✓ Opened post options menu");

  // === Step 5: Execute Action (Edit or Delete) ===
  console.log(`\n📋 Step 5: Executing ${request.action} action...`);

  if (request.action === "edit") {
    const editPrompt = `Click the "Edit post" or "Edit" button in the dropdown menu that just opened.
- Look for a button or option that says "Edit post" or "Edit" in the dropdown menu (NOT inside any dialog)
- Click on it ONCE to open the edit dialog/modal
- Wait 3 seconds for the edit dialog to fully open
- Stop immediately after the dialog opens

CRITICAL INSTRUCTIONS - READ CAREFULLY:
- After clicking "Edit post" from the menu, a modal/dialog will appear
- Inside this modal, you may see an "Edit" button next to images - this is for editing image alt text
- DO NOT click any "Edit" buttons that appear INSIDE the modal/dialog
- DO NOT interact with image edit buttons
- Your only job is to click "Edit post" from the menu and wait for the modal to open
- Once the modal is open, STOP - do nothing else
- The text editing will be handled in the next step using a different method`;

    await agent.execute({
      instruction: editPrompt,
      maxSteps: 6,
      highlightCursor: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log("✓ Edit dialog opened");

    // === Step 6: Modify Post Text (using Playwright for reliability) ===
    console.log("\n📋 Step 6: Modifying post text...");

    // Connect Playwright to the same browser session
    const playwrightConnection = await connectPlaywrightToBrowserbase({
      id: session.id,
      connectUrl: session.connectUrl,
    });

    if (!playwrightConnection) {
      throw new Error("Failed to connect Playwright to browser session");
    }

    const { browser: playwrightBrowser, page: playwrightPage } = playwrightConnection;

    // Wait a moment to ensure Playwright page is synced with Stagehand's page
    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      // Find the contenteditable editor element
      console.log("   🔍 Finding contenteditable editor...");
      const editor = playwrightPage.locator('[contenteditable="true"]').first();
      
      // Wait for editor to be visible
      await editor.waitFor({ state: "visible", timeout: 10000 });
      console.log("   ✓ Editor found");

      // Scroll editor into view and focus it
      console.log("   🎯 Focusing editor...");
      await editor.scrollIntoViewIfNeeded();
      await editor.click({ delay: 50 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      console.log("   ✓ Editor focused");

      // Get editor text length for verification
      const editorText = await editor.innerText();
      const originalTextLength = editorText.trim().length;
      console.log(`   📊 Original text length: ${originalTextLength} characters`);

      // Detect if we're on Mac
      const isMac = (await playwrightPage.evaluate(() => navigator.platform)).toLowerCase().includes("mac");
      const selectAllKey = isMac ? "Meta+A" : "Control+A";
      console.log(`   ⌨️  Using ${selectAllKey} to select all (${isMac ? "Mac" : "Windows/Linux"})`);

      // Select all text using keyboard shortcut
      await playwrightPage.keyboard.press(selectAllKey);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify selection using window.getSelection()
      console.log("   ✅ Verifying selection...");
      const selInfo = await playwrightPage.evaluate(() => {
        const sel = window.getSelection();
        return {
          type: sel?.type || null,
          selectedText: sel?.toString() || "",
          rangeCount: sel?.rangeCount || 0,
        };
      });

      console.log(`   📋 Selection info: type=${selInfo.type}, rangeCount=${selInfo.rangeCount}, selectedLength=${selInfo.selectedText.trim().length}`);

      // Verify selection is good enough (at least 80% of text selected)
      const looksSelected =
        selInfo.rangeCount > 0 &&
        selInfo.selectedText.trim().length > 0 &&
        selInfo.selectedText.trim().length >= Math.floor(originalTextLength * 0.8);

      if (!looksSelected) {
        console.log("   ⚠️  Selection verification failed, retrying...");
        // Retry: click again + select-all
        await editor.click({ delay: 50 });
        await new Promise((resolve) => setTimeout(resolve, 200));
        await playwrightPage.keyboard.press(selectAllKey);
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Verify again
        const retrySelInfo = await playwrightPage.evaluate(() => {
          const sel = window.getSelection();
          return {
            type: sel?.type || null,
            selectedText: sel?.toString() || "",
            rangeCount: sel?.rangeCount || 0,
          };
        });

        const retryLooksSelected =
          retrySelInfo.rangeCount > 0 &&
          retrySelInfo.selectedText.trim().length > 0 &&
          retrySelInfo.selectedText.trim().length >= Math.floor(originalTextLength * 0.8);

        if (!retryLooksSelected) {
          console.log("   ⚠️  Selection still not verified, proceeding anyway...");
        } else {
          console.log("   ✓ Selection verified after retry");
        }
      } else {
        console.log("   ✓ Selection verified");
      }

      // Delete selected text (backspace) then insert new text
      console.log("   ⌨️  Replacing text...");
      await playwrightPage.keyboard.press("Backspace");
      await new Promise((resolve) => setTimeout(resolve, 200));
      
      // Insert the new text
      await playwrightPage.keyboard.insertText(request.newText!);
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log("   ✓ Text replaced");

      // Verify the text was replaced
      const newEditorText = await editor.innerText();
      console.log(`   📊 New text length: ${newEditorText.trim().length} characters`);
      
      if (newEditorText.includes(request.newText!.substring(0, 50))) {
        console.log("   ✓ Text replacement verified");
      } else {
        console.log("   ⚠️  Text replacement may not have worked correctly");
      }

    } finally {
      // Keep Playwright connection open for save step
      // We'll close it after saving
    }

    console.log("✓ Post text modified");

    // === Step 7: Save Changes ===
    console.log("\n📋 Step 7: Saving changes...");

    const savePrompt = `Click the "Save" or "Post" or "Update" button to save your edited post changes.

IMPORTANT: 
- Look for a button INSIDE the edit dialog/modal that says "Save", "Post", "Update", "Publish", "Done", or similar
- This button is usually at the BOTTOM of the edit dialog or in the top-right area of the dialog
- Do NOT click "Save" from any dropdown menu or post options menu - only click the save button within the edit dialog itself
- The button should be clearly visible in the edit dialog where you just modified the text

Steps:
1. Find the save button in the edit dialog (not in any menu)
2. Click on it to save the edited post
3. Wait 3 seconds for the changes to be saved
4. Stop.

The edit dialog should close after saving, confirming your changes were saved.`;

    await agent.execute({
      instruction: savePrompt,
      maxSteps: 6,
      highlightCursor: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log("✓ Changes saved");

    // Close Playwright connection after saving
    if (playwrightConnection) {
      await playwrightBrowser.close();
    }

  } else if (request.action === "delete") {
    const deletePrompt = `Click the "Delete" button in the menu that just opened.
- Look for a button or option that says "Delete" or "Delete post"
- Click on it
- Wait 2 seconds
- Stop.

After clicking Delete, a confirmation dialog may appear.`;

    await agent.execute({
      instruction: deletePrompt,
      maxSteps: 6,
      highlightCursor: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log("✓ Delete option clicked");

    // === Step 6: Confirm Deletion ===
    console.log("\n📋 Step 6: Confirming deletion...");

    const confirmDeletePrompt = `If a confirmation dialog appears asking you to confirm the deletion:
- Look for a "Delete" or "Confirm" or "Yes" button in the confirmation dialog
- Click on it to confirm the deletion
- Wait 3 seconds
- Stop.

If no confirmation dialog appears, that's okay - the deletion may have already been processed.`;

    await agent.execute({
      instruction: confirmDeletePrompt,
      maxSteps: 6,
      highlightCursor: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log("✓ Deletion confirmed");
  }

  // Final wait to ensure action is processed
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log(`\n✅ Post ${request.action} completed successfully`);

  // === Cleanup ===
  await stagehand.close();

  // Release session
  await bb.sessions.update(session.id, {
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    status: "REQUEST_RELEASE",
  });

  console.log("🛑 Session released");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

