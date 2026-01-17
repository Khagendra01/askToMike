import "dotenv/config";
import { SessionManager } from "./session-manager.js";
import fs from "fs";
import path from "path";

/**
 * Database structure for tracking messaged contacts
 */
interface MessagedContact {
  firstName: string;
  lastName: string;
  messagedAt?: string; // ISO timestamp
}

interface MessagedDatabase {
  messaged: MessagedContact[];
}

/**
 * Database file path
 */
const DB_FILE_PATH = path.join(process.cwd(), "linkedin_messaged.json");

/**
 * Load the messaged contacts database
 */
function loadDatabase(): MessagedDatabase {
  try {
    if (fs.existsSync(DB_FILE_PATH)) {
      const data = fs.readFileSync(DB_FILE_PATH, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn(`⚠️ Error loading database: ${error}`);
  }
  return { messaged: [] };
}

/**
 * Save the messaged contacts database
 */
function saveDatabase(db: MessagedDatabase): void {
  try {
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(db, null, 2));
  } catch (error) {
    console.error(`❌ Error saving database: ${error}`);
  }
}

/**
 * Parse full name into first and last name
 * Handles various name formats: "John Doe", "John M. Doe", "John", etc.
 */
function parseName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const parts = trimmed.split(/\s+/).filter(p => p.length > 0);
  
  if (parts.length === 0) {
    return { firstName: trimmed, lastName: "" };
  }
  
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  
  // First name is first part, last name is last part
  // Middle names/initials are ignored
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  
  return { firstName, lastName };
}

/**
 * Check if a person has been messaged before
 */
function hasBeenMessaged(fullName: string, db: MessagedDatabase): boolean {
  const { firstName, lastName } = parseName(fullName);
  
  return db.messaged.some(contact => {
    const firstNameMatch = contact.firstName.toLowerCase() === firstName.toLowerCase();
    const lastNameMatch = contact.lastName.toLowerCase() === lastName.toLowerCase();
    
    // Match if both first and last name match
    // If last name is empty in either, only match on first name
    if (lastName === "" || contact.lastName === "") {
      return firstNameMatch;
    }
    
    return firstNameMatch && lastNameMatch;
  });
}

/**
 * Add a person to the messaged database
 */
function addToMessaged(fullName: string, db: MessagedDatabase): void {
  const { firstName, lastName } = parseName(fullName);
  
  // Check if already exists
  if (hasBeenMessaged(fullName, db)) {
    return;
  }
  
  // Add to database
  db.messaged.push({
    firstName,
    lastName,
    messagedAt: new Date().toISOString(),
  });
  
  saveDatabase(db);
}

/**
 * Generate intro message using template (no LLM)
 * Simple template: "Hi [firstName], I'd love to learn more about what you do and get your take on AI in 2026!"
 */
function generateIntroMessage(userName: string): string {
  const { firstName } = parseName(userName);
  return `Hi ${firstName}, I'd love to learn more about what you do and get your take on AI in 2026!`;
}

async function main() {
  // Configuration
  const profileUrl = "https://www.linkedin.com/in/khagendrakhatri-ai/";
  const numConnections = parseInt(process.argv[2] || process.env.NUM_CONNECTIONS || "10");
  
  // Load database
  const db = loadDatabase();
  console.log(`📊 Database loaded: ${db.messaged.length} contacts already messaged`);
  
  console.log(`🚀 Starting LinkedIn message explore`);
  console.log(`📊 Will message up to ${numConnections} new connections`);
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

    // Step 4: Extract list of users from connections
    console.log("\n📌 Step 4: Extracting connections list...");
    const connections = await page.evaluate(() => {
      const connectionList = [];
      
      // Try multiple selectors to find connection items
      const connectionSelectors = [
        '[data-testid="connection-item"]',
        'li[class*="connection"]',
        'div[class*="connection"]',
        'div[role="listitem"]',
      ];

      let connectionItems: Element[] = [];
      for (let i = 0; i < connectionSelectors.length; i++) {
        const selector = connectionSelectors[i];
        connectionItems = Array.from(document.querySelectorAll(selector)) as Element[];
        if (connectionItems.length > 0) break;
      }

      // If no specific selectors work, try finding user cards
      if (connectionItems.length === 0) {
        // Look for elements that contain names and might have message buttons
        const allDivs = Array.from(document.querySelectorAll('div[class*="entity-result"], div[class*="search-result"]')) as Element[];
        connectionItems = allDivs;
      }

      for (let j = 0; j < connectionItems.length; j++) {
        const item = connectionItems[j] as Element;
        
        // Extract name
        const nameSelectors = [
          '[data-testid="connection-name"]',
          'span[class*="name"]',
          'a[class*="name"]',
          'strong',
        ];

        let name = '';
        for (let k = 0; k < nameSelectors.length; k++) {
          const selector = nameSelectors[k];
          const nameEl = item.querySelector(selector);
          if (nameEl) {
            name = (nameEl.textContent || '').trim();
            if (name.length > 0 && name.length < 100) break;
          }
        }

        // If no name found, try getting text from the item
        if (!name) {
          const allText = item.textContent || '';
          const lines = allText.split('\n').map(function(l: string) { return l.trim(); }).filter(function(l: string) { return l.length > 0; });
          // First non-empty line that's not too long is likely the name
          for (let m = 0; m < lines.length; m++) {
            const line = lines[m];
            if (line.length > 2 && line.length < 100 && 
                line.indexOf('Message') === -1 && 
                line.indexOf('Connect') === -1 &&
                line.indexOf('Following') === -1) {
              name = line;
              break;
            }
          }
        }

        // Check if message button exists (we don't need to return it, just check)
        let hasMessageButton = false;
        const messageButton = item.querySelector('button[aria-label*="Message"], button[aria-label*="message"], a[aria-label*="Message"]');
        if (messageButton) {
          hasMessageButton = true;
        }

        if (name && name.length > 0) {
          connectionList.push({
            name: name,
            hasMessageButton: hasMessageButton
          });
        }
      }

      return connectionList.slice(0, 50); // Limit to first 50
    });

    console.log(`✓ Found ${connections.length} connections`);
    if (connections.length === 0) {
      console.log("⚠️ No connections found. Exiting.");
      return;
    }

    // Step 4.5: Filter out already messaged contacts
    console.log("\n📌 Step 4.5: Filtering out already messaged contacts...");
    const newConnections = connections.filter((conn: { name: string; hasMessageButton: boolean }) => {
      const alreadyMessaged = hasBeenMessaged(conn.name, db);
      if (alreadyMessaged) {
        const { firstName, lastName } = parseName(conn.name);
        console.log(`   ⏭️  Skipping ${conn.name} (already messaged)`);
      }
      return !alreadyMessaged;
    });

    console.log(`✓ Filtered: ${connections.length} total, ${newConnections.length} new, ${connections.length - newConnections.length} already messaged`);

    if (newConnections.length === 0) {
      console.log("⚠️ No new connections to message. All have been messaged before.");
      return;
    }

    // Step 5: Process each connection (up to numConnections)
    const connectionsToProcess = newConnections.slice(0, numConnections);
    console.log(`\n📌 Step 5: Processing ${connectionsToProcess.length} new connections...`);

    for (let i = 0; i < connectionsToProcess.length; i++) {
      const connection = connectionsToProcess[i];
      console.log(`\n👤 Processing ${i + 1}/${connectionsToProcess.length}: ${connection.name}`);

      try {
        // Step 5a: Click message button for this user
        console.log(`   🤖 Clicking message button...`);
        await agent.execute({
          instruction: `Find and click the "Message" button next to the user named "${connection.name}" in the connections list. This will open a message dialog or modal. Wait 3 seconds after clicking.`,
          maxSteps: 5,
          highlightCursor: true,
        });
        await new Promise((resolve) => setTimeout(resolve, 3000));
        console.log(`   ✓ Message dialog opened`);

        // Step 5b: Generate intro message using template
        console.log(`   📝 Generating intro message...`);
        const introMessage = generateIntroMessage(connection.name);
        console.log(`   ✓ Message (${introMessage.length} chars): ${introMessage}`);

        // Step 5c: Set message in input field directly (no typing - fixes truncation issue)
        // LinkedIn uses contenteditable divs - keyboard.type() gets cut off, so we set content directly
        console.log(`   🤖 Setting message directly (${introMessage.length} chars): "${introMessage}"`);
        
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
                
                // Set content directly - this is the fix for truncation
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
                }, introMessage);
                
                await new Promise((resolve) => setTimeout(resolve, 500));
                
                // Verify
                const typedValue = await input.evaluate((el: any) => {
                  return (el.value || el.textContent || el.innerText || '').trim();
                });
                
                if (typedValue === introMessage.trim()) {
                  console.log(`   ✓ Message set successfully (${typedValue.length} chars)`);
                  inputFound = true;
                  break;
                } else {
                  console.warn(`   ⚠️ Mismatch: Expected ${introMessage.length} chars, got ${typedValue.length} chars`);
                }
              }
            } catch (e) {
              continue;
            }
          }
          
          if (!inputFound) {
            console.warn(`   ⚠️ Could not find input field, using agent fallback...`);
            const escapedMessage = introMessage.replace(/"/g, '\\"').replace(/\n/g, '\\n');
            await agent.execute({
              instruction: `Type the complete message: "${escapedMessage}" into the message input field. Wait 1 second after typing.`,
              maxSteps: 5,
              highlightCursor: true,
            });
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } else {
          // No playwrightPage, use agent
          const escapedMessage = introMessage.replace(/"/g, '\\"').replace(/\n/g, '\\n');
          await agent.execute({
            instruction: `Type the complete message: "${escapedMessage}" into the message input field. Wait 1 second after typing.`,
            maxSteps: 5,
            highlightCursor: true,
          });
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        
        console.log(`   ✓ Message set completed`);

        // Step 5d: Click send button
        console.log(`   🤖 Clicking send button...`);
        await agent.execute({
          instruction: `Find and click the "Send" button in the message dialog. This is typically a button with text "Send" or an icon/button that sends the message. Wait 2 seconds after clicking to ensure the message is sent.`,
          maxSteps: 5,
          highlightCursor: true,
        });
        await new Promise((resolve) => setTimeout(resolve, 2000));
        console.log(`   ✓ Message sent`);

        // Step 5d.5: Add to database IMMEDIATELY after successful send (before closing dialog)
        console.log(`   💾 Saving to database...`);
        try {
          addToMessaged(connection.name, db);
          console.log(`   ✓ Added ${connection.name} to database`);
        } catch (dbError) {
          console.error(`   ❌ Error saving to database: ${dbError}`);
          // Continue anyway - don't let DB error stop the process
        }

        console.log(`   ✅ Successfully sent message to ${connection.name}`);

        // Step 5e: IMPORTANT - Close the message dialog with X button before proceeding
        console.log(`   🤖 Checking if dialog needs to be closed...`);
        
        // Actually check if dialog is still visible/open by looking for message input field
        let dialogStillOpen = false;
        if (playwrightPage) {
          try {
            const dialogVisible = await playwrightPage.evaluate(() => {
              // Check if message input field is still visible (means dialog is open)
              const messageInputs = document.querySelectorAll('textarea[placeholder*="Write a message" i], textarea[placeholder*="Type a message" i], div[contenteditable="true"][placeholder*="Write a message" i], div[contenteditable="true"][placeholder*="Type a message" i]');
              
              for (const input of Array.from(messageInputs)) {
                const rect = (input as HTMLElement).getBoundingClientRect();
                const style = window.getComputedStyle(input as HTMLElement);
                // Check if element is actually visible (not hidden, has dimensions, not off-screen)
                if (rect.width > 0 && rect.height > 0 && 
                    style.display !== 'none' && 
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0') {
                  return true; // Dialog is still open
                }
              }
              
              // Also check for any visible dialog/modal overlays
              const allDialogs = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="dialog" i], [class*="overlay" i]');
              for (const dialog of Array.from(allDialogs)) {
                const rect = (dialog as HTMLElement).getBoundingClientRect();
                const style = window.getComputedStyle(dialog as HTMLElement);
                if (rect.width > 0 && rect.height > 0 && 
                    style.display !== 'none' && 
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0' &&
                    rect.top >= 0 && rect.left >= 0) {
                  return true; // Dialog overlay is still visible
                }
              }
              
              return false; // No visible dialog found
            });
            dialogStillOpen = dialogVisible;
          } catch (e) {
            // Assume dialog might be open if we can't check
            console.warn(`   ⚠️ Could not check dialog state, assuming it might be open`);
            dialogStillOpen = true;
          }
        } else {
          // No playwrightPage, assume dialog might be open
          dialogStillOpen = true;
        }

        if (!dialogStillOpen) {
          console.log(`   ✓ Dialog already closed automatically`);
        } else {
          console.log(`   🤖 Dialog is still open, closing it...`);
          let dialogClosed = false;
          
          // Method 1: Try to find and click X button using Playwright (more precise)
          if (playwrightPage) {
            try {
              // Actually refind the dialog by looking for visible message input, then find close button
              const closeButton = await playwrightPage.evaluateHandle(() => {
                // First, find the visible message input to locate the dialog
                const messageInputs = document.querySelectorAll('textarea[placeholder*="Write a message" i], textarea[placeholder*="Type a message" i], div[contenteditable="true"][placeholder*="Write a message" i], div[contenteditable="true"][placeholder*="Type a message" i]');
                
                let dialog: Element | null = null;
                
                // Find the visible input and get its parent dialog/container
                for (const input of Array.from(messageInputs)) {
                  const rect = (input as HTMLElement).getBoundingClientRect();
                  const style = window.getComputedStyle(input as HTMLElement);
                  if (rect.width > 0 && rect.height > 0 && 
                      style.display !== 'none' && 
                      style.visibility !== 'hidden') {
                    // Found visible input, now find its dialog container
                    let parent = input.parentElement;
                    while (parent && parent !== document.body) {
                      const parentRect = parent.getBoundingClientRect();
                      const parentStyle = window.getComputedStyle(parent);
                      // Check if this parent looks like a dialog (has significant size, is visible)
                      if (parentRect.width > 300 && parentRect.height > 200 &&
                          parentStyle.display !== 'none' &&
                          parentStyle.visibility !== 'hidden') {
                        dialog = parent;
                        break;
                      }
                      parent = parent.parentElement;
                    }
                    if (dialog) break;
                  }
                }
                
                // If no dialog found via input, try finding visible overlay/dialog directly
                if (!dialog) {
                  const allDialogs = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="dialog" i], [class*="overlay" i]');
                  for (const d of Array.from(allDialogs)) {
                    const rect = (d as HTMLElement).getBoundingClientRect();
                    const style = window.getComputedStyle(d as HTMLElement);
                    if (rect.width > 0 && rect.height > 0 && 
                        style.display !== 'none' && 
                        style.visibility !== 'hidden') {
                      dialog = d;
                      break;
                    }
                  }
                }
                
                if (!dialog) return null;
                
                // Look for close button within the found dialog
                const closeSelectors = [
                  'button[aria-label*="Close" i]',
                  'button[aria-label*="Dismiss" i]',
                  'button[aria-label*="close" i]',
                  'button[class*="close" i]',
                  '[data-testid="close-button"]',
                ];
                
                for (const selector of closeSelectors) {
                  const btn = dialog.querySelector(selector);
                  if (btn) {
                    const btnRect = (btn as HTMLElement).getBoundingClientRect();
                    const btnStyle = window.getComputedStyle(btn as HTMLElement);
                    if (btnRect.width > 0 && btnRect.height > 0 && btnStyle.display !== 'none') {
                      return btn;
                    }
                  }
                }
                
                // Fallback: look for X icon button in top right area of dialog
                const buttons = dialog.querySelectorAll('button');
                const dialogRect = dialog.getBoundingClientRect();
                for (const btn of Array.from(buttons)) {
                  const rect = (btn as HTMLElement).getBoundingClientRect();
                  const style = window.getComputedStyle(btn as HTMLElement);
                  // Check if button is in top-right area of dialog and is visible
                  if (rect.width > 0 && rect.height > 0 &&
                      style.display !== 'none' &&
                      rect.top < dialogRect.top + 60 && 
                      rect.right > dialogRect.right - 60) {
                    return btn;
                  }
                }
                return null;
              });

              if (closeButton && closeButton.asElement()) {
                await (closeButton.asElement()!).click();
                await new Promise((resolve) => setTimeout(resolve, 1500));
                
                // Verify dialog is actually closed by checking if message input is gone
                const stillOpen = await playwrightPage.evaluate(() => {
                  const messageInputs = document.querySelectorAll('textarea[placeholder*="Write a message" i], textarea[placeholder*="Type a message" i], div[contenteditable="true"][placeholder*="Write a message" i]');
                  for (const input of Array.from(messageInputs)) {
                    const rect = (input as HTMLElement).getBoundingClientRect();
                    const style = window.getComputedStyle(input as HTMLElement);
                    if (rect.width > 0 && rect.height > 0 && style.display !== 'none') {
                      return true; // Still open
                    }
                  }
                  return false; // Closed
                });
                
                if (!stillOpen) {
                  dialogClosed = true;
                  console.log(`   ✓ Dialog closed via X button`);
                } else {
                  console.warn(`   ⚠️ Dialog still appears open after clicking close button`);
                }
              }
            } catch (e) {
              // Continue to agent method
            }
          }
          
          // Method 2: Use agent with VERY SPECIFIC instruction (only if Playwright failed)
          if (!dialogClosed) {
            try {
              await agent.execute({
                instruction: `Look for the message dialog that is currently open on the screen. Inside that dialog, find the X button or close button located at the TOP RIGHT CORNER of that specific dialog. Click ONLY that button. Do NOT click any other buttons on the page. Wait 1 second after clicking.`,
                maxSteps: 3,
                highlightCursor: true,
              });
              await new Promise((resolve) => setTimeout(resolve, 1000));
              
              // Verify dialog is actually closed by checking if message input is gone
              if (playwrightPage) {
                const stillOpen = await playwrightPage.evaluate(() => {
                  const messageInputs = document.querySelectorAll('textarea[placeholder*="Write a message" i], textarea[placeholder*="Type a message" i], div[contenteditable="true"][placeholder*="Write a message" i]');
                  for (const input of Array.from(messageInputs)) {
                    const rect = (input as HTMLElement).getBoundingClientRect();
                    const style = window.getComputedStyle(input as HTMLElement);
                    if (rect.width > 0 && rect.height > 0 && style.display !== 'none') {
                      return true; // Still open
                    }
                  }
                  return false; // Closed
                });
                if (!stillOpen) {
                  dialogClosed = true;
                  console.log(`   ✓ Dialog closed via agent`);
                } else {
                  console.warn(`   ⚠️ Dialog still appears to be open after agent click`);
                }
              } else {
                dialogClosed = true;
                console.log(`   ✓ Dialog closed via agent (could not verify)`);
              }
            } catch (error) {
              console.warn(`   ⚠️ Error closing dialog with agent: ${error}`);
            }
          }
          
          if (!dialogClosed) {
            console.warn(`   ⚠️ Warning: Could not close dialog. It may have closed automatically.`);
          }
        }

        // Final verification: Make sure dialog is actually gone before proceeding
        if (playwrightPage) {
          const dialogStillThere = await playwrightPage.evaluate(() => {
            const messageInputs = document.querySelectorAll('textarea[placeholder*="Write a message" i], textarea[placeholder*="Type a message" i], div[contenteditable="true"][placeholder*="Write a message" i]');
            for (const input of Array.from(messageInputs)) {
              const rect = (input as HTMLElement).getBoundingClientRect();
              const style = window.getComputedStyle(input as HTMLElement);
              if (rect.width > 0 && rect.height > 0 && style.display !== 'none') {
                return true; // Dialog still there
              }
            }
            return false; // Dialog is gone
          });
          
          if (dialogStillThere) {
            console.warn(`   ⚠️ WARNING: Dialog still appears to be open! Trying to close again...`);
            // Try pressing Escape as last resort
            try {
              await playwrightPage.keyboard.press('Escape');
              await new Promise((resolve) => setTimeout(resolve, 1000));
              console.log(`   ✓ Pressed Escape to close dialog`);
            } catch (e) {
              console.warn(`   ⚠️ Could not press Escape`);
            }
          } else {
            console.log(`   ✓ Dialog confirmed closed`);
          }
        }
        
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log(`   ✓ Ready for next connection`);

        // Small delay between messages
        await new Promise((resolve) => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`   ❌ Error processing ${connection.name}:`, error);
        // Try to close dialog if it's still open
        try {
          await agent.execute({
            instruction: `If there is a close button (X) or cancel button visible, click it. Wait 1 second.`,
            maxSteps: 2,
            highlightCursor: true,
          });
        } catch (e) {
          // Ignore
        }
        // Continue with next connection
        continue;
      }
    }

    console.log("\n✅ All messages processed successfully");
    console.log(`📊 Summary: ${connectionsToProcess.length} messages sent`);
    console.log(`💾 Database: ${db.messaged.length} total contacts messaged`);

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

