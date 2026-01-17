import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { SessionManager } from "./session-manager.js";

/**
 * Interface for message data extracted from LinkedIn
 */
interface MessageData {
  senderName: string;
  messageText: string;
  conversationId?: string;
  messageId?: string;
  timestamp?: string;
  isFromToday?: boolean;
  isFromMe?: boolean;
  sidebarIndex?: number; // Original position in the sidebar (for clicking)
  recentMessages?: Array<{
    senderName: string;
    messageText: string;
    isFromMe: boolean;
    timestamp?: string;
  }>;
}

/**
 * Interface for reply decision
 */
interface ReplyDecision {
  shouldReply: boolean;
  replyText: string;
}

/**
 * Interface for conversation message history
 */
interface ConversationMessage {
  speaker: string;
  message: string;
  isFromMe: boolean;
  timestamp?: string;
}

/**
 * Extract messages from the currently open conversation view using Stagehand's AI extraction
 */
async function extractMessagesFromConversationView(
  stagehand: any,
  senderFirstName: string,
  senderLastName: string,
  maxMessages: number = 10
): Promise<ConversationMessage[]> {
  try {
    // Use Stagehand's extract to get messages from the conversation
    const senderFullName = `${senderFirstName} ${senderLastName}`.trim();
    
    const instruction = `Extract the conversation messages from this LinkedIn conversation with ${senderFullName}. 
Extract up to ${maxMessages} most recent messages. 
For each message, identify if it's from you or from ${senderFullName}. 
Return the messages in chronological order (oldest first). 
Only extract actual message content, not UI elements or system messages.`;
    
    const schema = z.object({
      messages: z.array(
        z.object({
          speaker: z.string().describe("Either 'You' if the message is from you, or the sender's name if from them"),
          message: z.string().describe("The actual message text content"),
          isFromMe: z.boolean().describe("True if message is from you, false if from the other person"),
          timestamp: z.string().optional().describe("Optional timestamp of the message")
        })
      )
    });
    
    const extractionResult = await stagehand.extract(instruction, schema);

    if (extractionResult && extractionResult.messages && Array.isArray(extractionResult.messages)) {
      // Convert to our ConversationMessage format
      const messages: ConversationMessage[] = extractionResult.messages.map((msg: any) => ({
        speaker: msg.speaker || (msg.isFromMe ? 'You' : senderFullName),
        message: msg.message || '',
        isFromMe: msg.isFromMe || false,
        timestamp: msg.timestamp || undefined,
      }));

      // Filter out empty messages and validate
      return messages.filter(msg => msg.message && msg.message.trim().length > 0);
    }

    return [];
  } catch (error) {
    console.warn('   ⚠️ Error extracting messages with Stagehand:', error);
    // Fallback to manual extraction if Stagehand extract fails
    return extractMessagesFromConversationViewManual(stagehand.context.pages()[0]);
  }
}

/**
 * Fallback manual extraction method (old logic)
 */
async function extractMessagesFromConversationViewManual(
  page: any
): Promise<ConversationMessage[]> {
  try {
    const messages = await page.evaluate(() => {
      const messageList: ConversationMessage[] = [];
      
      // First, find the conversation view container (right side, not the sidebar)
      // Look for the main conversation area - it should contain the message input field
      let conversationView: Element | null = null;
      
      // Strategy 1: Find the message input area and get its parent container
      const messageInputSelectors = [
        'div[contenteditable="true"][role="textbox"]',
        'div[aria-label*="message" i]',
        'div[placeholder*="message" i]',
        'textarea[placeholder*="message" i]',
        'div[class*="compose"]',
        'div[class*="message-input"]',
      ];
      
      for (const selector of messageInputSelectors) {
        const inputEl = document.querySelector(selector);
        if (inputEl) {
          // Walk up the DOM to find the conversation view container
          let parent = inputEl.parentElement;
          let depth = 0;
          while (parent && depth < 10) {
            // Look for containers that are likely the conversation view
            const parentClasses = parent.classList.toString();
            const parentId = parent.id || '';
            if (parentClasses.includes('conversation') || 
                parentClasses.includes('thread') ||
                parentClasses.includes('message-list') ||
                parentId.includes('conversation') ||
                parentId.includes('thread')) {
              conversationView = parent;
              break;
            }
            parent = parent.parentElement;
            depth++;
          }
          if (conversationView) break;
        }
      }
      
      // Strategy 2: If we didn't find it via input, look for the main content area
      if (!conversationView) {
        const mainContentSelectors = [
          'main[role="main"]',
          'div[role="main"]',
          'div[class*="conversation-view"]',
          'div[class*="thread-view"]',
          'div[class*="message-thread"]',
        ];
        
        for (const selector of mainContentSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            conversationView = el;
            break;
          }
        }
      }
      
      // Strategy 3: Find the right side panel (exclude the left sidebar)
      if (!conversationView) {
        // LinkedIn typically has the sidebar on the left and conversation on the right
        // Look for containers that are NOT the sidebar
        const allContainers = Array.from(document.querySelectorAll('div[class*="conversation"], div[class*="thread"], div[class*="message"]'));
        for (const container of allContainers) {
          const rect = container.getBoundingClientRect();
          // If it's on the right side of the screen (not the left sidebar), it's likely the conversation view
          if (rect.left > window.innerWidth * 0.3 && rect.width > 400) {
            conversationView = container;
            break;
          }
        }
      }
      
      // If we still don't have a conversation view, use document.body but be more careful
      const searchRoot = conversationView || document.body;
      
      // Try multiple selectors to find message containers WITHIN the conversation view
      const messageSelectors = [
        'div[class*="message"]',
        'div[class*="msg-"]',
        'div[role="log"] > div',
        'li[class*="message"]',
        'div[class*="bubble"]',
        'div[class*="message-item"]',
      ];
      
      let messageElements: Element[] = [];
      for (const selector of messageSelectors) {
        messageElements = Array.from(searchRoot.querySelectorAll(selector));
        // Filter out elements that are in the sidebar (left side of screen)
        messageElements = messageElements.filter(el => {
          const rect = el.getBoundingClientRect();
          // Only include messages that are in the right side (conversation view)
          return rect.left > window.innerWidth * 0.25;
        });
        if (messageElements.length > 0) break;
      }
      
      // If no specific selectors work, try finding message bubbles within the conversation view
      if (messageElements.length === 0) {
        // Look for elements that are likely message bubbles in the conversation view only
        const allDivs = Array.from(searchRoot.querySelectorAll('div'));
        messageElements = allDivs.filter(div => {
          const rect = div.getBoundingClientRect();
          const text = (div.textContent || '').trim();
          // Filter for divs that:
          // 1. Are in the right side (conversation view, not sidebar)
          // 2. Look like messages (have text, not too short, not UI elements)
          return rect.left > window.innerWidth * 0.25 &&
                 text.length > 5 && 
                 text.length < 500 && 
                 !text.includes('Write a message') &&
                 !text.includes('Type a message') &&
                 !text.includes('Send') &&
                 !text.includes('Press return') &&
                 !div.querySelector('input') &&
                 !div.querySelector('textarea');
        });
      }
      
      // List of UI/system text patterns to exclude
      const uiTextPatterns = [
        'write a message',
        'type a message',
        'send',
        'press return',
        'expanding',
        'compose field',
        'compose',
        'message input',
        'active conversation',
        'jump to',
        'open the options',
        'status is reachable',
        'search messages',
        'focused',
        'unread',
        'connections',
        'inmail',
        'starred',
        'conversation list',
        'attention screen reader',
        'aria-label',
        'role=',
        'button',
        'link',
        'navigation',
      ];
      
      // Helper function to check if text looks like UI/system text
      function isUIText(text: string): boolean {
        const lowerText = text.toLowerCase();
        // Check for UI patterns
        for (const pattern of uiTextPatterns) {
          if (lowerText.includes(pattern)) {
            return true;
          }
        }
        // Check if it's mostly punctuation or very short
        if (text.length < 3) return true;
        // Check if it's all caps (likely a label)
        if (text === text.toUpperCase() && text.length < 20) return true;
        // Check if it looks like an aria-label or tooltip
        if (text.startsWith('Click') || text.startsWith('Press') || text.startsWith('Open')) {
          return true;
        }
        return false;
      }
      
      // Helper function to extract clean message text (remove timestamps, UI elements)
      function extractCleanMessage(element: Element): string {
        // Clone the element to avoid modifying the original
        const clone = element.cloneNode(true) as Element;
        
        // Remove common UI elements
        const elementsToRemove = clone.querySelectorAll(
          'time, button, a[role="button"], [aria-label], [class*="timestamp"], [class*="time"], [class*="button"], [class*="icon"]'
        );
        elementsToRemove.forEach(el => el.remove());
        
        // Get text content
        let text = (clone.textContent || '').trim();
        
        // Remove timestamp patterns from text
        text = text.replace(/\d{1,2}:\d{2}\s*(AM|PM|am|pm)?/gi, '').trim();
        text = text.replace(/\d+\s*(min|hour|day|week|month|year)s?\s*ago/gi, '').trim();
        text = text.replace(/(just\s+now|today|yesterday)/gi, '').trim();
        
        // Remove common prefixes/suffixes that are UI elements
        text = text.replace(/^(active|unread|new|focused)\s+/i, '').trim();
        text = text.replace(/\s*(press|click|open|expand).*$/i, '').trim();
        
        return text;
      }
      
      for (const msgEl of messageElements) {
        // Extract clean message text
        let text = extractCleanMessage(msgEl);
        
        // Skip if too short or too long (likely not a real message)
        if (text.length < 3 || text.length > 1000) continue;
        
        // Skip if it's UI/system text
        if (isUIText(text)) {
          continue;
        }
        
        // Additional validation: real messages usually have some letters
        const hasLetters = /[a-zA-Z]/.test(text);
        if (!hasLetters) continue;
        
        // Skip if it's just numbers or special characters
        if (/^[\d\s\.,;:!?\-_]+$/.test(text)) continue;
        
        // Determine if message is from me (right side) or them (left side)
        // LinkedIn typically shows your messages on the right, theirs on the left
        const rect = msgEl.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(msgEl);
        const isRightAligned = computedStyle.textAlign === 'right' || 
                               computedStyle.marginLeft === 'auto' ||
                               msgEl.classList.toString().includes('right') ||
                               msgEl.classList.toString().includes('sent') ||
                               msgEl.classList.toString().includes('outgoing');
        
        const isLeftAligned = computedStyle.textAlign === 'left' || 
                             computedStyle.marginRight === 'auto' ||
                             msgEl.classList.toString().includes('left') ||
                             msgEl.classList.toString().includes('received') ||
                             msgEl.classList.toString().includes('incoming');
        
        // Use position on screen as primary indicator
        // Messages on the right side (center-right) are usually from me
        // Messages on the left side (center-left) are usually from them
        const screenCenter = window.innerWidth / 2;
        const elementCenter = rect.left + rect.width / 2;
        let isFromMe = elementCenter > screenCenter;
        
        // Check parent elements for alignment clues (override position if found)
        let parent = msgEl.parentElement;
        let depth = 0;
        while (parent && parent !== document.body && depth < 5) {
          const parentClasses = parent.classList.toString();
          if (parentClasses.includes('right') || 
              parentClasses.includes('sent') || 
              parentClasses.includes('outgoing') ||
              parentClasses.includes('self') ||
              parentClasses.includes('sender')) {
            isFromMe = true;
            break;
          }
          if (parentClasses.includes('left') || 
              parentClasses.includes('received') || 
              parentClasses.includes('incoming') ||
              parentClasses.includes('recipient')) {
            isFromMe = false;
            break;
          }
          parent = parent.parentElement;
          depth++;
        }
        
        // If we couldn't determine from parent, use alignment or position
        if (parent === document.body || depth >= 5) {
          if (isRightAligned && !isLeftAligned) {
            isFromMe = true;
          } else if (isLeftAligned && !isRightAligned) {
            isFromMe = false;
          }
          // Otherwise keep the position-based guess
        }
        
        // Extract timestamp if available
        const timeEl = msgEl.querySelector('time, span[class*="time"], span[class*="timestamp"]');
        const timestamp = timeEl ? (timeEl.textContent || timeEl.getAttribute('datetime') || '').trim() : '';
        
        // Only add if we have valid message text
        if (text.length >= 3) {
          messageList.push({
            speaker: isFromMe ? 'You' : 'Them',
            message: text,
            isFromMe,
            timestamp: timestamp || undefined,
          });
        }
      }
      
      // Messages appear in chronological order in DOM (oldest first)
      // Take the last 10 messages (most recent) but keep them in chronological order
      return messageList.slice(-10);
    });
    
    return messages || [];
  } catch (error) {
    console.warn('   ⚠️ Error extracting messages from conversation view:', error);
    return [];
  }
}

/**
 * Generate a reply using conversation history and LLM
 */
async function generateReplyFromHistory(
  conversationHistory: ConversationMessage[],
  senderName: string,
  maxHistory: number = 10
): Promise<ReplyDecision> {
  const apiKey =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing Google API key! Please set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY environment variable."
    );
  }

  // Check if it's our turn (last message should not be from us)
  const lastMessage = conversationHistory[conversationHistory.length - 1];
  if (!lastMessage || lastMessage.isFromMe) {
    console.log(`   ⏭️  Not our turn (last message is from us or no messages)`);
    return {
      shouldReply: false,
      replyText: "",
    };
  }

  // Take last maxHistory messages
  const recentHistory = conversationHistory.slice(-maxHistory);
  
  // Build conversation context for LLM
  const conversationContext = recentHistory
    .map(msg => `${msg.isFromMe ? 'You' : senderName}: ${msg.message}`)
    .join('\n');

  // LinkedIn-appropriate system prompt (casual but professional)
  const systemPrompt = `You are Khagendra Khatri replying to a LinkedIn message from ${senderName}. Keep it casual but professional, matching their tone.

CRITICAL RULES - FOLLOW STRICTLY:
1. **1 SENTENCE ONLY, 50-150 CHARACTERS**: ONE sentence. LinkedIn message style - short and punchy. NEVER write 2 sentences.
2. **MATCH THEIR TONE**: If they're casual, be casual. If they're formal, be slightly more formal but still friendly.
3. **BE NATURALLY CASUAL**: 
   - Use contractions (I'm, you're, that's, it's, we'll, gonna)
   - Use casual connectors: "like", "you know", "I mean", "actually"
   - Use interjections: "yeah", "oh", "nice", "cool", "haha" (but keep it LinkedIn-appropriate)
   - Avoid slang unless they use it first
   - Say it simply: "Yeah, that's cool!" not "I completely agree with that perspective"
4. **CONTEXT AWARENESS**: Reference the conversation naturally. If they asked a question, answer it. If they shared something, acknowledge it briefly.
5. **COMPLETE YOUR THOUGHT**: Always end with proper punctuation (. ! ?). NEVER cut off mid-sentence.

Your goal: Generate ONE natural, contextually appropriate reply (50-150 chars) that matches their tone and responds to their message.`;

  // Build the prompt with conversation history
  const prompt = `Here's the recent conversation history:

${conversationContext}

Generate a natural, contextually appropriate reply to the last message. Keep it to ONE sentence (50-150 characters), casual but professional, matching their tone.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          generationConfig: {
            temperature: 0.9,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 800,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    let replyText =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!replyText) {
      throw new Error("No text in Gemini API response");
    }

    // Validate and fix response (1 sentence, proper length, complete)
    replyText = validateAndFixReply(replyText);

    // Check if message is worth replying to (skip spam, etc.)
    const lowerText = lastMessage.message.toLowerCase();
    const isSpam = lowerText.includes('click here') || 
                   lowerText.includes('free money') ||
                   lowerText.includes('limited time offer') ||
                   lowerText.length < 3;

    if (isSpam) {
      console.log(`   ⏭️  Message appears to be spam, skipping`);
      return {
        shouldReply: false,
        replyText: "",
      };
    }

    return {
      shouldReply: true,
      replyText,
    };
  } catch (error) {
    console.error("Error generating reply from history:", error);
    throw error;
  }
}

/**
 * Validate and fix reply to ensure it meets requirements (1 sentence, proper length)
 */
function validateAndFixReply(text: string): string {
  let fixed = text.trim();
  
  // Ensure it ends with punctuation
  if (!/[.!?]$/.test(fixed)) {
    const sentences = fixed.match(/[^.!?]*[.!?]/g);
    if (sentences && sentences.length > 0) {
      fixed = sentences[sentences.length - 1].trim();
    } else {
      fixed = fixed + ".";
    }
  }
  
  // Ensure only 1 sentence
  const sentences = fixed.match(/[^.!?]*[.!?]/g);
  if (sentences && sentences.length > 1) {
    fixed = sentences[0].trim();
  }
  
  // Check length (50-150 chars ideal, max 200)
  if (fixed.length > 200) {
    const firstSentence = fixed.match(/[^.!?]*[.!?]/)?.[0] || fixed;
    fixed = firstSentence.substring(0, 197).trim();
    if (!/[.!?]$/.test(fixed)) {
      fixed += ".";
    }
  }
  
  return fixed;
}

/**
 * Generate a reply by analyzing a screenshot of the conversation
 * Uses Gemini's vision API to analyze the screenshot directly - faster than extraction!
 * This is now used as a fallback when message extraction fails.
 */
async function generateReplyFromScreenshot(
  screenshot: string,
  senderName: string,
  modelName: string = "gemini-2.0-flash-exp"
): Promise<ReplyDecision> {
  const apiKey =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing Google API key! Please set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY environment variable."
    );
  }

  // Define the function schema for Gemini to call
  const functionDeclaration = {
    name: "generate_reply",
    description: "Analyze the LinkedIn conversation screenshot and generate an appropriate reply. Determine if it's your turn to reply (last message is from the other person), and if so, what the reply should be.",
    parameters: {
      type: "object",
      properties: {
        isMyTurn: {
          type: "boolean",
          description: "Whether it's your turn to reply. True if the last message in the conversation is from the other person (not from you). False if the last message is from you or if there are no messages.",
        },
        shouldReply: {
          type: "boolean",
          description: "Whether to reply to this message. Set to false if the message is spam, inappropriate, doesn't require a response, or if it's not your turn (isMyTurn is false).",
        },
        replyText: {
          type: "string",
          description: "The reply text to send. Should be professional, friendly, and contextually appropriate. Empty string if shouldReply is false.",
        },
      },
      required: ["isMyTurn", "shouldReply", "replyText"],
    },
  };

  const prompt = `You are analyzing a LinkedIn conversation screenshot. Look at the conversation messages visible in the screenshot.

Sender: ${senderName}

Analyze the screenshot to determine:
1. Is it my turn to reply? (Check if the last message in the conversation is from the other person, not from me. Messages from me are typically on the right side, messages from others are on the left side, or they may have different styling/indicators)
2. If it IS my turn, is this message worth replying to? (Skip spam, inappropriate content, or messages that don't require a response)
3. If yes to both, what would be a professional, friendly, and contextually appropriate reply?

The reply should:
- Be concise and relevant
- Match the tone of the conversation
- Be professional but personable
- Consider the full conversation context visible in the screenshot
- If the message is spam or inappropriate, set shouldReply to false
- If it's not your turn (last message is from you), set isMyTurn to false and shouldReply to false

CRITICAL: You MUST call the generate_reply function with your analysis. Do NOT respond with plain text. You MUST use function calling. The function expects:
- isMyTurn: boolean (true if last message is from the other person)
- shouldReply: boolean (true if you should reply)
- replyText: string (the actual reply text, or empty string if shouldReply is false)

Call the function now with your decision.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: screenshot,
                  },
                },
              ],
            },
          ],
          tools: [
            {
              functionDeclarations: [functionDeclaration],
            },
          ],
          toolConfig: {
            functionCallingConfig: {
              mode: "ANY", // Force function calling - ANY means it can call functions
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    // Check if Gemini called the function
    const functionCall = 
      data.candidates?.[0]?.content?.parts?.[0]?.functionCall;

    // Debug: log what we received
    if (!functionCall) {
      const textPart = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (textPart) {
        console.log(`   [DEBUG] Gemini returned text instead of function call: ${textPart.substring(0, 200)}...`);
      } else {
        console.log(`   [DEBUG] Gemini response structure:`, JSON.stringify(data.candidates?.[0]?.content?.parts, null, 2).substring(0, 500));
      }
    }

    if (functionCall && functionCall.name === "generate_reply") {
      // Gemini called our function - extract the arguments
      const args = functionCall.args as { isMyTurn: boolean; shouldReply: boolean; replyText: string };
      
      // Validate the response
      if (
        typeof args.isMyTurn === "boolean" &&
        typeof args.shouldReply === "boolean" &&
        typeof args.replyText === "string"
      ) {
        // If it's not our turn, return shouldReply: false
        if (!args.isMyTurn) {
          console.log(`   ⏭️  Not our turn (last message is from us)`);
          return {
            shouldReply: false,
            replyText: "",
          };
        }
        return {
          shouldReply: args.shouldReply,
          replyText: args.replyText,
        };
      } else {
        throw new Error("Invalid function call arguments from Gemini");
      }
    }

    // Fallback: if no function call, try to extract text response
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      console.warn("Gemini returned text instead of function call, attempting to parse...");
      // Try to extract JSON from the text
      let jsonText = text.trim();
      
      // Try to find JSON in code blocks
      if (jsonText.includes("```json")) {
        jsonText = jsonText.split("```json")[1].split("```")[0].trim();
      } else if (jsonText.includes("```")) {
        jsonText = jsonText.split("```")[1].split("```")[0].trim();
      }
      
      // Try to find JSON object in the text
      const jsonMatch = jsonText.match(/\{[\s\S]*"shouldReply"[\s\S]*"replyText"[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }

      // Try to parse as JSON
      try {
        const decision = JSON.parse(jsonText) as ReplyDecision;
        if (
          typeof decision.shouldReply === "boolean" &&
          typeof decision.replyText === "string"
        ) {
          console.log("   ✓ Successfully parsed JSON from text response");
          return decision;
        }
      } catch (parseError) {
        console.warn(`   ⚠️ Could not parse JSON from text: ${text.substring(0, 100)}...`);
        // If we can't parse it, try to extract decision from natural language
        const lowerText = text.toLowerCase();
        
        // Check if it's not our turn
        if (lowerText.includes("should reply: false") || 
            lowerText.includes("shouldreply: false") ||
            lowerText.includes("do not reply") ||
            lowerText.includes("skip") ||
            lowerText.includes("not my turn") ||
            lowerText.includes("last message is from me")) {
          return {
            shouldReply: false,
            replyText: "",
          };
        }
        
        // Check if it IS our turn and suggests replying
        if (lowerText.includes("it is my turn") || 
            lowerText.includes("it's my turn") ||
            lowerText.includes("my turn to reply")) {
          // Try to extract a suggested reply from the text
          // Look for patterns like "a casual response", "reply with...", etc.
          let extractedReply = "";
          
          // Try to find quoted text that might be a suggested reply
          const quotedMatch = text.match(/"([^"]+)"/);
          if (quotedMatch && quotedMatch[1].length > 5) {
            extractedReply = quotedMatch[1];
          } else {
            // Look for patterns like "reply with X" or "say X"
            const replyMatch = text.match(/(?:reply with|say|respond with|suggest|recommend)[:"]?\s*([^\.]+)/i);
            if (replyMatch) {
              extractedReply = replyMatch[1].trim();
            } else {
              // Generate a simple acknowledgment if we can't extract
              extractedReply = "Thanks for reaching out! I'll get back to you soon.";
            }
          }
          
          if (extractedReply.length > 0) {
            console.log(`   ✓ Extracted reply from text response: ${extractedReply.substring(0, 60)}...`);
            return {
              shouldReply: true,
              replyText: extractedReply,
            };
          }
        }
        
        // Default to skip if we can't determine
        console.warn("   ⚠️ Could not determine decision from text, defaulting to skip");
      }
    }

    throw new Error("No function call or valid response from Gemini");
  } catch (error) {
    console.error("Error generating reply:", error);
    // Default to not replying if there's an error
    return {
      shouldReply: false,
      replyText: "",
    };
  }
}

async function main() {
  // === Configuration ===
  const maxMessages = parseInt(process.env.MAX_MESSAGES ?? "20");
  
  // === Get optional message from command line args or env ===
  const providedMessage = process.argv[2] || process.env.TARGET_MESSAGE || null;
  
  console.log(`🎯 Mode: Filtering conversations where they sent the last message (waiting for our reply)`);
  console.log(`📅 Processing up to ${maxMessages} conversations`);
  if (providedMessage) {
    console.log(`💬 Provided message: ${providedMessage.substring(0, 60)}...`);
  } else {
    console.log(`🤖 No message provided - will check if it's our turn and generate reply`);
  }

  // === Initialize SessionManager (supports both LOCAL and BROWSERBASE) ===
  const sessionManager = new SessionManager({
    sessionName: process.env.SESSION_NAME || "linkedin",
    headless: process.env.HEADLESS === "true",
  });

  const mode = sessionManager.getMode();
  console.log(`🚀 Starting in ${mode} mode...`);

  // === Initialize Stagehand with persistent session ===
  const stagehandSession = await sessionManager.initializeStagehand({
    model: "google/gemini-3-flash-preview",
    verbose: false,
  });

  const stagehand = stagehandSession.stagehand;
  const page = stagehandSession.page;

  console.log("🤖 Stagehand session initialized");

  // Navigate to LinkedIn messages
  await page.goto("https://www.linkedin.com/messaging/", {
    waitUntil: "domcontentloaded",
  });
  console.log("➡️ Navigated to LinkedIn messages");

  // Wait for messages to load
  await new Promise((resolve) => setTimeout(resolve, 5000));

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
    systemPrompt: `You are a simple UI interaction agent. Follow instructions exactly:
- Click buttons when told
- Type text when provided
- Scroll when instructed
- Wait when asked to wait
Do nothing else.`,
  });

  console.log("🤖 Autonomous agent created");

  // === Modular Functions ===

  /**
   * Extract messages from the messages page
   * Only includes conversations where the message preview does NOT start with "You:" (they sent the last message, waiting for our reply)
   */
  async function extractMessages(): Promise<MessageData[]> {
    const result = await page.evaluate(() => {
      const messageList: MessageData[] = [];
      const debugLogs: string[] = []; // Collect debug logs to return

      // Find all conversation items - try multiple selectors
      const conversationSelectors = [
        '[data-testid="conversation-item"]',
        'div[role="listitem"]',
        'li[role="presentation"]',
        '.msg-conversation-listitem',
        'li[class*="conversation"]',
        'div[class*="conversation"]',
        'a[href*="/messaging/thread/"]',
      ];

      let conversations: Element[] = [];
      for (const selector of conversationSelectors) {
        conversations = Array.from(document.querySelectorAll(selector));
        if (conversations.length > 0) {
          break;
        }
      }

      // If no conversations found with those selectors, try finding any clickable message items
      if (conversations.length === 0) {
        conversations = Array.from(
          document.querySelectorAll('div[role="button"], a[href*="/messaging/"]')
        );
      }

      // Process conversations and track their original index in the sidebar
      for (let sidebarIndex = 0; sidebarIndex < conversations.length; sidebarIndex++) {
        const conv = conversations[sidebarIndex];
        // Extract sender name (First Name Last Name)
        const nameSelectors = [
          '[data-testid="conversation-sender-name"]',
          '.msg-conversation-card__participant-names',
          'span[dir="ltr"]',
          'strong',
        ];

        let senderName = '';
        for (const selector of nameSelectors) {
          const nameEl = conv.querySelector(selector);
          if (nameEl) {
            senderName = (nameEl.textContent || '').trim();
            if (senderName.length > 0) break;
          }
        }

        // Extract message preview text - look for text that does NOT start with "You:"
        // Format: "First Name Last Name" followed by timestamp, then "You: [message]" or "[Name]: [message]"
        // We want conversations where they sent the last message (NOT "You:")
        let messageText = '';
        let startsWithYou = false;
        const allText = conv.textContent || '';
        const lines = allText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        // DEBUG: Log all lines for this conversation
        if (senderName === 'Santiago Pinto') {
          debugLogs.push(`[DEBUG Santiago] All lines: ${JSON.stringify(lines)}`);
        }
        
        // Look for the message preview line
        for (const line of lines) {
          // DEBUG: Log what we're checking
          if (senderName === 'Santiago Pinto') {
            debugLogs.push(`[DEBUG Santiago] Checking line: "${line}"`);
          }
          // Skip if it's the sender name
          if (line === senderName) {
            if (senderName === 'Santiago Pinto') debugLogs.push(`[DEBUG Santiago] Skipping: sender name match`);
            continue;
          }
          
          // PRIORITY: Check for "You:" FIRST before any other checks
          const lowerLine = line.toLowerCase().trim();
          if (lowerLine.startsWith('you:') || 
              lowerLine.startsWith('you sent') ||
              lowerLine.includes('you:') ||
              /^you\s+(sent|replied|wrote)/i.test(line)) {
            if (senderName === 'Santiago Pinto') debugLogs.push(`[DEBUG Santiago] FOUND "You:" pattern! Line: "${line}"`);
            startsWithYou = true;
            messageText = line.trim();
            break; // Found "You:", stop looking
          }
          
          // Skip if it's a timestamp pattern (e.g., "11:23 PM", "2h ago")
          if (/^\d{1,2}:\d{2}\s*(AM|PM|am|pm)?$/i.test(line) || 
              /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}/i.test(line) ||
              line.includes('ago') || line.includes('Today') || line.includes('Yesterday')) {
            if (senderName === 'Santiago Pinto') debugLogs.push(`[DEBUG Santiago] Skipping: timestamp`);
            continue;
          }
          // Skip if it's too short or looks like UI text or status indicators
          if (line.length < 5 || 
              line === 'Active conversation' || 
              line === 'Press return' ||
              line.includes('Press return') ||
              line.includes('Open the options') ||
              line.includes('Status is reachable') ||
              line.includes('Status is offline') ||
              line.includes('Status is online') ||
              line.includes('Status:') ||
              line.toLowerCase().includes('status') ||
              line.includes('Jump to') ||
              line.includes('Compose') ||
              line.includes('Search messages') ||
              line.includes('#OPEN_TO_WORK') ||
              line.includes('Active now') ||
              line.includes('Recently active')) {
            if (senderName === 'Santiago Pinto') debugLogs.push(`[DEBUG Santiago] Skipping: UI text or status`);
            continue;
          }
          // If it doesn't start with "You:" and looks like a message, it's from them
          // But make sure it's not a status indicator
          if (line.length > 5 && !messageText && !lowerLine.includes('status')) {
            if (senderName === 'Santiago Pinto') debugLogs.push(`[DEBUG Santiago] Setting messageText to: "${line}" (no "You:" found yet)`);
            messageText = line.trim();
          }
        }

        // Fallback: If we didn't find a clear message, try searching all text directly
        if (!messageText) {
          // Check for "You:" or "You sent" patterns first (multiple variations)
          const youPatterns = [
            /You:\s*(.+?)(?:\n|$)/i,
            /You\s+sent:\s*(.+?)(?:\n|$)/i,
            /You\s+replied:\s*(.+?)(?:\n|$)/i,
            /You\s+wrote:\s*(.+?)(?:\n|$)/i,
          ];
          
          let youMatch = null;
          for (const pattern of youPatterns) {
            youMatch = allText.match(pattern);
            if (youMatch) break;
          }
          
          if (youMatch) {
            startsWithYou = true;
            messageText = `You: ${youMatch[1].trim()}`;
          } else {
            // Look for sender name pattern (they sent the message)
            // But exclude if it's a status message
            const namePattern = new RegExp(senderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*(.+?)(?:\\n|$)', 'i');
            const nameMatch = allText.match(namePattern);
            if (nameMatch && nameMatch[1] && !nameMatch[1].toLowerCase().includes('status')) {
              messageText = `${senderName}: ${nameMatch[1].trim()}`;
            }
          }
        }

        // DEBUG: Log final decision for Santiago
        if (senderName === 'Santiago Pinto') {
          debugLogs.push(`[DEBUG Santiago] Final decision:`);
          debugLogs.push(`  - messageText: "${messageText}"`);
          debugLogs.push(`  - startsWithYou: ${startsWithYou}`);
          debugLogs.push(`  - messageText starts with "You:": ${messageText.trim().startsWith('You:')}`);
        }
        
        // Only process if message preview does NOT start with "You:" or contain "You sent" (meaning they sent the last message)
        // We want to reply to conversations where they messaged us, not where we messaged them
        // Also skip if messageText is a status indicator
        const messageTextLower = messageText.toLowerCase();
        const isStatusMessage = messageTextLower.includes('status') || 
                               messageTextLower.includes('offline') || 
                               messageTextLower.includes('online') ||
                               messageTextLower.includes('active now') ||
                               messageTextLower.includes('recently active');
        
        if (messageText && !startsWithYou && !messageText.trim().startsWith('You:') && !isStatusMessage) {
          if (senderName === 'Santiago Pinto') debugLogs.push(`[DEBUG Santiago] WILL BE ADDED (should be skipped!)`);
          // Extract conversation ID from href if available
          const linkEl = conv.querySelector('a[href*="/messaging/thread/"]');
          let conversationId: string | undefined;
          if (linkEl) {
            const href = linkEl.getAttribute('href') || '';
            const match = href.match(/\/messaging\/thread\/([^\/]+)/);
            if (match) {
              conversationId = match[1];
            }
          }

          messageList.push({
            senderName,
            messageText: messageText.trim(), // Keep the message preview
            conversationId,
            sidebarIndex: sidebarIndex + 1, // 1-based index for agent (e.g., "conversation number 1")
          });
        }
      }

      return { messageList, debugLogs };
    });
    
    // Print debug logs if any
    if (result.debugLogs && result.debugLogs.length > 0) {
      console.log('\n[DEBUG OUTPUT]:');
      result.debugLogs.forEach((log: string) => console.log(log));
      console.log('');
    }
    
    const messageList = result.messageList || [];

    console.log(`   ✓ Found ${messageList.length} conversations where they sent the last message (waiting for our reply)`);
    if (messageList.length > 0) {
        console.log(`   📋 Conversations: ${messageList.map((c: MessageData) => c.senderName).join(', ')}`);
    }

    return messageList || [];
  }

  /**
   * Take a screenshot of the conversation and convert to base64
   */
  async function takeConversationScreenshot(): Promise<string> {
    const screenshot = await page.screenshot({ type: 'png' });
    return screenshot.toString('base64');
  }

  /**
   * Open a conversation and take a screenshot for analysis
   * Returns screenshot data if conversation is open, null otherwise
   */
  async function openConversationAndScreenshot(
    conversationIndex: number,
    expectedSenderName: string
  ): Promise<{ screenshot: string; senderName: string } | null> {
    try {
      // Click on the conversation in the left sidebar to open it
      // Find conversation by name instead of index to avoid position mismatches
      console.log(`   🤖 Clicking on conversation with ${expectedSenderName} in sidebar...`);
      await agent.execute({
        instruction: `Find and click on the conversation in the messages list on the left sidebar that is with ${expectedSenderName}. Look for their name in the conversation list. Click on that conversation. Wait 3 seconds for the conversation to open.`,
        maxSteps: 5,
        highlightCursor: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Verify we're in the right place by clicking/focusing the message input box
      console.log(`   ✓ Verifying conversation view by focusing message input...`);
      try {
        await agent.execute({
          instruction: `Click on the message input field that says "Write a message" or "Type a message" or similar. This is the text box where you type messages. Just click it to focus it, don't type anything yet. Wait 1 second.`,
          maxSteps: 3,
          highlightCursor: true,
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log(`   ✓ Message input field focused - ready to send reply`);
      } catch (error) {
        console.log(`   ⚠️ Could not find message input field, but continuing anyway...`);
      }

      // Take screenshot of the conversation
      console.log(`   📸 Taking screenshot of conversation...`);
      const screenshot = await takeConversationScreenshot();
      console.log(`   ✓ Screenshot captured`);

      return {
        screenshot,
        senderName: expectedSenderName,
      };
    } catch (error) {
      console.error(`   ❌ Error opening/screenshotting conversation ${conversationIndex}:`, error);
      return null;
    }
  }

  /**
   * Send a reply to the currently open conversation
   */
  async function sendReply(replyText: string): Promise<void> {
    await agent.execute({
      instruction: `Type exactly: "${replyText}" into the message input field. Click the Send button ONCE. After clicking Send, wait 3 seconds and verify the message appears in the conversation above and the input field is empty. Do NOT click Send multiple times - if the message appears in the conversation, it was sent successfully.`,
      maxSteps: 5,
      highlightCursor: true,
    });
    // Additional wait to ensure message is fully sent
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  /**
   * Go back to messages list (only needed for error recovery)
   * Simply navigate directly to avoid agent confusion with buttons
   */
  async function goBackToList(): Promise<void> {
    console.log(`   🔙 Navigating back to messages list...`);
    // Navigate directly - simpler and more reliable than trying to find buttons
    await page.goto("https://www.linkedin.com/messaging/", {
      waitUntil: "domcontentloaded",
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log(`   ✓ Returned to messages list`);
  }

  // === Main Processing Loop ===
  let processedMessages = 0;
  const processedConversationIds = new Set<string>();

  try {
    // Process conversations in batches: extract visible -> process -> scroll -> repeat
    let scrollAttempts = 0;
    const maxScrollAttempts = 1; // Always scroll 4 times to reveal more conversations

    console.log("\n🔄 Starting batch processing: Extract visible → Process → Scroll → Repeat\n");

    while (processedMessages < maxMessages && scrollAttempts < maxScrollAttempts) {
      // Step 1: Extract currently visible conversations
      console.log(`\n📊 Batch ${scrollAttempts + 1}: Extracting visible conversations...`);
      let visibleConversations = await extractMessages();
      
      // Filter out already processed conversations
      const newConversations = visibleConversations.filter((conv: MessageData) => {
        const convId = conv.conversationId || `${conv.senderName}-${conv.messageText.substring(0, 20)}`;
        return !processedConversationIds.has(convId);
      });

      console.log(`   📋 Found ${visibleConversations.length} total visible, ${newConversations.length} new conversations`);

      // Step 2: Process all new visible conversations
      if (newConversations.length > 0) {
        console.log(`\n   🔄 Processing ${newConversations.length} new visible conversations...`);
        
        for (let i = 0; i < newConversations.length && processedMessages < maxMessages; i++) {
          const conversationToProcess = newConversations[i];
          const convId = conversationToProcess.conversationId || `${conversationToProcess.senderName}-${conversationToProcess.messageText.substring(0, 20)}`;
          
          // Double-check it's not processed (race condition protection)
          if (processedConversationIds.has(convId)) {
            continue;
          }

          console.log(`\n   📌 Processing message ${processedMessages + 1}/${maxMessages}...`);
          console.log(`      📨 Conversation with: ${conversationToProcess.senderName}`);
          console.log(`      💬 Last message: ${conversationToProcess.messageText.substring(0, 60)}...`);

          // Keep-alive: ping page every 20 seconds during processing
          let keepAliveInterval: NodeJS.Timeout | null = null;
          keepAliveInterval = setInterval(async () => {
            try {
              await page.title();
            } catch (e) {
              // Ignore errors
            }
          }, 20000);

          try {
            // Open conversation and take screenshot for analysis
            console.log("      🤖 Opening conversation...");
            const screenshotData = await openConversationAndScreenshot(
              0, // Index not used - we find by name
              conversationToProcess.senderName
            );
            
            if (!screenshotData) {
              console.log("      ⚠️ Could not open conversation. Skipping.");
              processedConversationIds.add(convId);
              continue;
            }

            // Step 3: Generate reply
            let replyText: string | null = null;
            
            if (providedMessage) {
              replyText = providedMessage;
              console.log(`      💬 Using provided message: ${replyText.substring(0, 60)}...`);
            } else {
              // Try to extract messages from conversation view first
              console.log("      📝 Extracting conversation history...");
              const nameParts = screenshotData.senderName.trim().split(/\s+/);
              const senderFirstName = nameParts[0] || screenshotData.senderName;
              const senderLastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
              const conversationHistory = await extractMessagesFromConversationView(
                stagehand,
                senderFirstName,
                senderLastName,
                10
              );
              
              if (conversationHistory.length > 0) {
                console.log(`      ✓ Extracted ${conversationHistory.length} messages`);
                try {
                  const replyDecision = await generateReplyFromHistory(
                    conversationHistory,
                    screenshotData.senderName,
                    10
                  );
                  
                  if (replyDecision.shouldReply && replyDecision.replyText) {
                    replyText = replyDecision.replyText;
                    console.log(`      💬 Generated reply: ${replyText.substring(0, 60)}...`);
                  }
                } catch (error) {
                  console.warn(`      ⚠️ Error generating reply, falling back to screenshot...`);
                }
              }
              
              // Fallback to screenshot analysis
              if (!replyText) {
                console.log("      🧠 Using screenshot analysis...");
                const replyDecision = await generateReplyFromScreenshot(
                  screenshotData.screenshot,
                  screenshotData.senderName
                );
                
                if (replyDecision.shouldReply && replyDecision.replyText) {
                  replyText = replyDecision.replyText;
                  console.log(`      💬 Generated reply: ${replyText.substring(0, 60)}...`);
                }
              }
            }
            
            // Step 4: Send reply if we have one
            if (replyText) {
              console.log("      🤖 Sending reply...");
              await sendReply(replyText);
              console.log("      ✅ Reply sent");
            } else {
              console.log("      ⏭️  No reply to send");
            }

            // Mark as processed
            processedConversationIds.add(convId);
            processedMessages++;
            console.log(`      ✅ Message ${processedMessages} processed`);

          } catch (error) {
            console.error(`      ❌ Error processing: ${error}`);
            processedConversationIds.add(convId);
          } finally {
            if (keepAliveInterval) clearInterval(keepAliveInterval);
          }
        }
      }

      // Step 3: Always scroll down to reveal more conversations (scroll exactly 4 times)
      console.log(`\n   📜 Scrolling sidebar (${scrollAttempts + 1}/${maxScrollAttempts}) to reveal more conversations...`);
      try {
        await stagehand.act(`Scroll down in the conversation list on the left sidebar. Look for the scrollable list of conversations/messages on the left side of the screen. Scroll down by about one page height (80% of the visible area) to reveal more conversations below.`);
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for new conversations to load
        console.log(`   ✓ Scrolled down (${scrollAttempts + 1}/${maxScrollAttempts})`);
      } catch (error) {
        console.log(`   ⚠️ Scroll ${scrollAttempts + 1} failed: ${error}`);
        // Continue to next scroll attempt even if one fails
      }
      scrollAttempts++;
      
      // Only break if we've processed enough messages or completed all scrolls
      if (processedMessages >= maxMessages) {
        console.log(`\n   ✅ Processed maximum messages (${maxMessages}). Finished.`);
        break;
      }
      if (scrollAttempts >= maxScrollAttempts) {
        console.log(`\n   ✅ Completed all ${maxScrollAttempts} scroll attempts. Finished scrolling.`);
        break;
      }
    }

    console.log("\n✅ All messages processed successfully");
    console.log(`📊 Summary: ${processedMessages} messages processed`);

  } catch (error) {
    console.error(`❌ Error during message processing: ${error}`);
    throw error;
  }

  // === Cleanup ===
  await sessionManager.cleanup(stagehandSession);

  console.log("🛑 Session cleaned up");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
