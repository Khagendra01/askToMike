import "dotenv/config";
import { SessionManager } from "./session-manager.js";

async function main() {
  // Get Full Name and Message from CLI arguments
  const fullName = process.argv[2];
  const message = process.argv[3];
  
  if (!fullName || !message) {
    console.error("❌ Error: Missing required arguments");
    console.error("Usage: ts-node linkedin_message_dm.ts <Full Name> <Message>");
    console.error("Example: ts-node linkedin_message_dm.ts 'John Doe' 'Hello, how are you?'");
    process.exit(1);
  }
  
  // Configuration
  const profileUrl = "https://www.linkedin.com/in/khagendrakhatri-ai/";
  
  console.log(`🚀 Starting LinkedIn message DM`);
  console.log(`👤 Full Name: ${fullName}`);
  console.log(`💬 Message: ${message}`);
  console.log(`🔗 Profile URL: ${profileUrl}`);

  // Initialize session manager
  const sessionManager = new SessionManager({
    sessionName: process.env.SESSION_NAME || "linkedin",
    headless: process.env.HEADLESS === "true",
  });

  const mode = sessionManager.getMode();
  console.log(`🌐 Mode: ${mode}`);

  // Initialize Stagehand session
  const { stagehand, page, sessionInfo, playwrightPage } = await sessionManager.initializeStagehand({
    model: "google/gemini-3-flash-preview",
  });

  console.log("🤖 Stagehand session initialized");

  // Validate API key
  const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!googleApiKey) {
    throw new Error(
      "Missing Google API key! Please set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY environment variable."
    );
  }
  console.log("✓ Google API key found");

  // Create autonomous agent for UI interaction
  const agent = stagehand.agent({
    mode: "cua",
    model: {
      modelName: "google/gemini-2.5-computer-use-preview-10-2025",
      apiKey: googleApiKey,
    },
    systemPrompt: `You are a simple UI interaction agent. Follow instructions exactly:
- Click buttons when told
- Type text when provided
- Scroll when instructed
- Wait when asked to wait
Do nothing else.`,
  });

  console.log("🤖 Autonomous agent created");

  try {
    // Step 1: Navigate to profile
    console.log("\n📌 Step 1: Navigating to profile...");
    await page.goto(profileUrl, {
      waitUntil: "domcontentloaded",
    });
    console.log("✓ Navigated to profile");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Step 2: Click on connections count
    console.log("\n📌 Step 2: Clicking on connections...");
    await agent.execute({
      instruction: `Find and click on the "connections" link or button that shows the number of connections. This is typically near the top of the profile page. Wait 3 seconds after clicking.`,
      maxSteps: 5,
      highlightCursor: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log("✓ Clicked on connections");

    // Step 3: Wait for connections list to load
    console.log("\n📌 Step 3: Waiting for connections list to load...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Step 4: Search for the user by name
    console.log(`\n📌 Step 4: Searching for "${fullName}"...`);
    await agent.execute({
      instruction: `Find the input field labeled "Search by Name" in the connections page. Type "${fullName}" into this search field. Wait 2 seconds after typing.`,
      maxSteps: 5,
      highlightCursor: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log(`✓ Searched for "${fullName}"`);

    // Step 5: Wait for search results
    console.log("\n📌 Step 5: Waiting for search results...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Step 6: Click message button for the user
    console.log(`\n📌 Step 6: Clicking message button for "${fullName}"...`);
    await agent.execute({
      instruction: `Find and click the "Message" button next to the user named "${fullName}" in the search results. This will open a message dialog or modal. Wait 3 seconds after clicking.`,
      maxSteps: 5,
      highlightCursor: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log(`✓ Message dialog opened`);

    // Step 7: Set message in input field
    console.log(`\n📌 Step 7: Setting message...`);
    
    if (playwrightPage) {
      // Find the input field (contenteditable div or textarea)
      const inputSelectors = [
        'div[contenteditable="true"][placeholder*="Write a message"]',
        'div[contenteditable="true"][placeholder*="Type a message"]',
        'textarea[placeholder*="Write a message"]',
        'textarea[placeholder*="Type a message"]',
        'div[contenteditable="true"]',
        'textarea',
      ];
      
      let inputFound = false;
      for (const selector of inputSelectors) {
        try {
          const input = await playwrightPage.$(selector);
          if (input) {
            // Click to focus
            await input.click();
            await new Promise((resolve) => setTimeout(resolve, 300));
            
            // Set content directly
            await input.evaluate((el: any, text: string) => {
              // Clear first
              if (el.value !== undefined) {
                el.value = '';
              } else {
                el.textContent = '';
                el.innerText = '';
              }
              
              // Set the full text directly
              if (el.value !== undefined) {
                el.value = text;
              } else {
                el.textContent = text;
                el.innerText = text;
              }
              
              // Trigger input event so LinkedIn recognizes the change
              const inputEvent = new Event('input', { bubbles: true });
              el.dispatchEvent(inputEvent);
              
              const changeEvent = new Event('change', { bubbles: true });
              el.dispatchEvent(changeEvent);
            }, message);
            
            await new Promise((resolve) => setTimeout(resolve, 500));
            
            // Verify
            const typedValue = await input.evaluate((el: any) => {
              return (el.value || el.textContent || el.innerText || '').trim();
            });
            
            if (typedValue === message.trim()) {
              console.log(`✓ Message set successfully (${typedValue.length} chars)`);
              inputFound = true;
              break;
            } else {
              console.warn(`⚠️ Mismatch: Expected ${message.length} chars, got ${typedValue.length} chars`);
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!inputFound) {
        console.warn(`⚠️ Could not find input field, using agent fallback...`);
        const escapedMessage = message.replace(/"/g, '\\"').replace(/\n/g, '\\n');
        await agent.execute({
          instruction: `Type the complete message: "${escapedMessage}" into the message input field. Wait 1 second after typing.`,
          maxSteps: 5,
          highlightCursor: true,
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } else {
      // No playwrightPage, use agent
      const escapedMessage = message.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      await agent.execute({
        instruction: `Type the complete message: "${escapedMessage}" into the message input field. Wait 1 second after typing.`,
        maxSteps: 5,
        highlightCursor: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Step 8: Click send button
    console.log(`\n📌 Step 8: Clicking send button...`);
    await agent.execute({
      instruction: `Find and click the "Send" button in the message dialog. This is typically a button with text "Send" or an icon/button that sends the message. Wait 2 seconds after clicking to ensure the message is sent.`,
      maxSteps: 5,
      highlightCursor: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log(`✓ Message sent`);

    console.log(`\n✅ Successfully sent message to ${fullName}`);


  } catch (error) {
    console.error(`❌ Error during processing: ${error}`);
    throw error;
  }

  // Cleanup
  await sessionManager.cleanup({ stagehand, page, sessionInfo });
  console.log("🛑 Session closed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

