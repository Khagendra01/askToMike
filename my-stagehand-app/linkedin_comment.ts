import "dotenv/config";
import { SessionManager } from "./session-manager.js";

// ============================
// CLI ARGS
// ============================

function parseArgs(): { keyword?: string } {
  const args = process.argv.slice(2);
  let keyword: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--keyword" || args[i] === "-k") {
      keyword = args[i + 1];
      i++;
    }
  }

  return { keyword };
}

const CLI_ARGS = parseArgs();

// ============================
// CONFIG
// ============================

const MAX_POSTS = parseInt(process.env.MAX_POSTS ?? "50");
const COMMENT_RATE = parseFloat(process.env.COMMENT_RATE ?? "0.4"); // target engagement density
const RUN_URN_BLACKLIST = new Set<string>();

// ============================
// URL HELPERS
// ============================

/**
 * Build LinkedIn URL based on whether keyword search is requested
 */
function getLinkedInUrl(keyword?: string): string {
  if (keyword) {
    const encodedKeyword = encodeURIComponent(keyword);
    return `https://www.linkedin.com/search/results/content/?keywords=${encodedKeyword}&origin=FACETED_SEARCH&sortBy=%5B%22relevance%22%5D`;
  }
  return "https://www.linkedin.com/feed/";
}

// ============================
// INVARIANT ASSERTIONS
// ============================

function assertInvariant(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`INVARIANT VIOLATION: ${message}`);
  }
}

// ============================
// DOM HELPERS
// ============================

interface PostInfo {
  node: Element;
  urn: string;
  text: string;
}

/**
 * Find first visible post (DOM position only, no scrolling)
 * Returns serializable data about the post
 */
function findFirstVisiblePost(): { urn: string; index: number } | null {
  const posts = Array.from(document.querySelectorAll('div[data-urn*="urn:li:activity:"]'));
  if (posts.length === 0) return null;

  // Find post closest to top of viewport (0-400px range)
  let targetPost: Element | null = null;
  let minTop = Infinity;
  let targetIndex = -1;
  
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const rect = post.getBoundingClientRect();
    // Accept posts that start in viewport (0-400px from top)
    if (rect.top >= 0 && rect.top < 400 && rect.bottom > 0 && rect.height > 100) {
      if (rect.top < minTop) {
        minTop = rect.top;
        targetPost = post;
        targetIndex = i;
      }
    }
  }

  if (!targetPost) return null;

  const urnAttr = targetPost.getAttribute('data-urn');
  const urn = urnAttr?.match(/urn:li:activity:\d+/)?.[0];
  if (!urn) return null;

  return { urn, index: targetIndex };
}

/**
 * Extract URN and text from post by index
 */
function extractPostData(index: number): { urn: string; text: string } | null {
  const posts = Array.from(document.querySelectorAll('div[data-urn*="urn:li:activity:"]'));
  if (index < 0 || index >= posts.length) return null;

  const post = posts[index];
  const urnAttr = post.getAttribute('data-urn');
  const urn = urnAttr?.match(/urn:li:activity:\d+/)?.[0];
  if (!urn) return null;

  // Extract text
  const textEls = post.querySelectorAll('span[dir="ltr"], div[dir="ltr"]');
  const seen = new Set<string>();
  let text = '';
  textEls.forEach((el) => {
    const t = (el.textContent || '').trim();
    if (t.length > 10 && !seen.has(t)) {
      seen.add(t);
      text += t + '\n';
    }
  });
  const authorEl = post.querySelector('[data-testid="actor-name"]');
  const author = (authorEl?.textContent || '').trim();
  if (author) {
    text = author + '\n' + text;
  }

  return { urn, text: text.trim() };
}

/**
 * Check if post at index is still attached to DOM
 */
function isPostAttached(index: number): boolean {
  const posts = Array.from(document.querySelectorAll('div[data-urn*="urn:li:activity:"]'));
  if (index < 0 || index >= posts.length) return false;
  return document.body.contains(posts[index]);
}

/**
 * Expand post text by clicking "...more" or "see more" (no retries)
 */
async function expandPostText(index: number, page: any): Promise<void> {
  await page.evaluate((postIndex: number) => {
    const posts = Array.from(document.querySelectorAll('div[data-urn*="urn:li:activity:"]'));
    if (postIndex < 0 || postIndex >= posts.length) return;
    
    const post = posts[postIndex];
    // Find expand button within the post
    const expandButtons = post.querySelectorAll('button, span, a');
    for (const btn of expandButtons) {
      const text = (btn.textContent || '').toLowerCase().trim();
      if (text.includes('see more') || text.includes('...more') || text === '...') {
        (btn as HTMLElement).click();
        return;
      }
    }
  }, index);
  
  // Small wait for expansion
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/**
 * Extract post text from post at index (after expansion)
 */
function extractPostTextExpanded(index: number): string {
  const posts = Array.from(document.querySelectorAll('div[data-urn*="urn:li:activity:"]'));
  if (index < 0 || index >= posts.length) return '';

  const post = posts[index];
  const textEls = post.querySelectorAll('span[dir="ltr"], div[dir="ltr"]');
  const seen = new Set<string>();
  let text = '';

  textEls.forEach((el) => {
    const t = (el.textContent || '').trim();
    if (t.length > 10 && !seen.has(t)) {
      seen.add(t);
      text += t + '\n';
    }
  });

  // Extract author
  const authorEl = post.querySelector('[data-testid="actor-name"]');
  const author = (authorEl?.textContent || '').trim();
  if (author) {
    text = author + '\n' + text;
  }

  return text.trim();
}

/**
 * Check if any comment box is open
 */
function anyCommentBoxOpen(): boolean {
  const commentBoxes = document.querySelectorAll(
    'div[contenteditable="true"][data-testid*="comment"], ' +
    'div[role="textbox"][aria-label*="comment" i], ' +
    'div[data-testid*="comment-box"]'
  );
  return commentBoxes.length > 0;
}

/**
 * Scroll once (controller only, agent never scrolls)
 */
async function scrollOnce(page: any): Promise<void> {
  await page.evaluate(() => {
    window.scrollBy({
      top: 400,
      behavior: 'smooth'
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

// ============================
// DECISION AGENT (Gemini - stateless)
// ============================

/**
 * Decision agent: sees ONE post only, decides comment/skip
 * Returns: true | false
 */
async function agentDecide(params: {
  urn: string;
  text: string;
  maxEngagementRate: number;
}): Promise<boolean> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing Google API key");
  }

  const modelName = "gemini-2.0-flash-exp";
  
  const prompt = `You see ONE LinkedIn post.

Decide whether to comment.

Rules:
- ALWAYS comment (return true) unless it's OBVIOUS spam/promotion
- Only skip if: contains "buy now", "limited time offer", "discount code", "promo code", or direct product sales link
- Comment on EVERYTHING else: discussions, insights, questions, personal posts, news, job posts, company updates, etc.
- Be very permissive - comment on 90%+ of posts
- Comment rate must stay under ${params.maxEngagementRate * 100}%
- Output ONLY true or false

Post text:
${params.text.substring(0, 1000)}

Respond with ONLY the word "true" or "false" (no quotes, no explanation).`;

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
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase();

    if (!text) {
      throw new Error("No text in Gemini API response");
    }

    // Parse boolean response
    return text.includes('true');
  } catch (error) {
    console.error("Decision agent error:", error);
    throw error; // Re-throw to trigger fallback
  }
}

/**
 * Fallback heuristic (fast + cheap)
 */
function heuristicDecision(text: string): boolean {
  const lowerText = text.toLowerCase();
  
  // Only skip clearly promotional/business posts
  const skipPatterns = [
    'buy now', 'limited time offer', 'act now', 'sign up now',
    'special offer', 'discount code', 'promo code', 'use code'
  ];
  
  if (skipPatterns.some(pattern => lowerText.includes(pattern))) {
    return false;
  }
  
  // Default: comment (permissive)
  return true;
}

// ============================
// COMMENT AGENT (Stagehand act/extract - uses Gemini vision)
// ============================

/**
 * Comment agent: uses Stagehand's act() method with regular Gemini model
 * This uses vision + DOM analysis to find and interact with elements
 */
async function agentComment(params: {
  urn: string;
  postIndex: number;
  text: string;
  stagehand: any;
  page: any;
}): Promise<void> {
  // Verify URN matches before commenting and get author info
  const postInfo = await params.page.evaluate((index: number) => {
    const posts = Array.from(document.querySelectorAll('div[data-urn*="urn:li:activity:"]'));
    if (index < 0 || index >= posts.length) return null;
    const post = posts[index];
    const urnAttr = post.getAttribute('data-urn');
    const urn = urnAttr?.match(/urn:li:activity:\d+/)?.[0];
    
    // Get author name for more specific targeting
    const authorEl = post.querySelector('[data-testid="actor-name"]') ||
                     post.querySelector('.feed-shared-actor__name') ||
                     post.querySelector('.update-components-actor__name');
    const author = (authorEl?.textContent || '').trim().split('\n')[0].trim();
    
    // Get first few words of post content
    const textEls = post.querySelectorAll('span[dir="ltr"]');
    let preview = '';
    for (const el of textEls) {
      const t = (el.textContent || '').trim();
      if (t.length > 20) {
        preview = t.substring(0, 50);
        break;
      }
    }
    
    return { urn, author, preview };
  }, params.postIndex);

  assertInvariant(
    postInfo?.urn === params.urn,
    `URN mismatch before commenting: expected ${params.urn}, got ${postInfo?.urn}`
  );

  // Scroll the target post to the center of the viewport for better targeting
  await params.page.evaluate((index: number) => {
    const posts = Array.from(document.querySelectorAll('div[data-urn*="urn:li:activity:"]'));
    if (index >= 0 && index < posts.length) {
      const post = posts[index];
      post.scrollIntoView({ behavior: 'instant', block: 'center' });
    }
  }, params.postIndex);
  
  // Wait for scroll to settle
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Generate comment text with screenshot
  const commentText = await generateCommentText({
    postText: params.text,
    postIndex: params.postIndex,
    page: params.page,
  });

  // Build a specific instruction using author name if available
  const authorHint = postInfo?.author ? ` by ${postInfo.author}` : '';
  const previewHint = postInfo?.preview ? ` The post starts with "${postInfo.preview.substring(0, 30)}..."` : '';

  // Use Stagehand's act() method - it uses vision to find and click elements
  // Step 1: Click the Comment button on the centered post
  console.log("      📝 Clicking Comment button...");
  await params.stagehand.act(
    `Click the Comment button on the LinkedIn post${authorHint} that is centered on the screen.${previewHint} The Comment button is in the action bar with Like, Comment, Repost, Send buttons. Do NOT click 'Start a post' at the top of the page.`
  );

  // Wait for comment box to appear
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Step 2: Type the comment in the comment input box
  console.log("      ✏️  Typing comment...");
  await params.stagehand.act(
    `Type the following text into the comment input box that just appeared: "${commentText}"`
  );

  // Wait for text to be entered
  await new Promise((resolve) => setTimeout(resolve, 800));

  // Step 3: Click the Post button to submit the comment
  console.log("      🚀 Submitting comment...");
  await params.stagehand.act(
    "Click the Post button to submit the comment. It should be a small button near the comment input box."
  );

  // Wait for comment to post
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

/**
 * Generate comment text using screenshot + text (vision model)
 * Captures screenshot of the post element which includes all images
 */
async function generateCommentText(params: {
  postText: string;
  postIndex: number;
  page: any;
}): Promise<string> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return "Great insights! Thanks for sharing.";
  }

  try {
    // Capture screenshot of the post element (includes all images)
    // Get bounding box of the post element
    const boundingBox = await params.page.evaluate((index: number) => {
      const posts = Array.from(document.querySelectorAll('div[data-urn*="urn:li:activity:"]'));
      if (index < 0 || index >= posts.length) return null;
      
      const post = posts[index];
      const rect = post.getBoundingClientRect();
      
      return {
        x: Math.max(0, rect.left),
        y: Math.max(0, rect.top),
        width: rect.width,
        height: Math.min(rect.height, window.innerHeight - Math.max(0, rect.top)),
      };
    }, params.postIndex);
    
    if (!boundingBox || boundingBox.width === 0 || boundingBox.height === 0) {
      // Fallback to text-only if post not found or invalid
      return await generateCommentTextTextOnly(params.postText, apiKey);
    }
    
    // Capture screenshot using page.screenshot with clip
    const screenshotBuffer = await params.page.screenshot({
      clip: {
        x: boundingBox.x,
        y: boundingBox.y,
        width: boundingBox.width,
        height: boundingBox.height,
      },
    });

    // Convert to base64
    const base64Image = screenshotBuffer.toString('base64');

    // Call Gemini Vision API with image + text
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
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
                  text: `Generate a short, professional LinkedIn comment (1-2 sentences max, under 100 characters) for this LinkedIn post.`,
                },
                {
                  inline_data: {
                    mime_type: "image/png",
                    data: base64Image,
                  },
                },
                {
                  text: `\n\nPost text content: ${params.postText.substring(0, 500)}\n\nGenerate a thoughtful, authentic comment that references the visual content if relevant.\n\nRespond ONLY with valid JSON: {"comment": "your comment text here"}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                comment: { type: "string" }
              },
              required: ["comment"]
            }
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const parsed = JSON.parse(jsonText);
    return parsed.comment || "Great insights! Thanks for sharing.";
  } catch (error) {
    console.error("Comment generation with screenshot failed, falling back to text-only:", error);
    // Fallback to text-only generation
    return await generateCommentTextTextOnly(params.postText, apiKey || "");
  }
}

/**
 * Fallback: Generate comment text using text only (no screenshot)
 */
async function generateCommentTextTextOnly(postText: string, apiKey: string): Promise<string> {
  if (!apiKey) {
    return "Great insights! Thanks for sharing.";
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
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
                  text: `Generate a short, professional LinkedIn comment (1-2 sentences max, under 100 characters) for this post: ${postText.substring(0, 500)}\n\nRespond ONLY with valid JSON: {"comment": "your comment text here"}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                comment: { type: "string" }
              },
              required: ["comment"]
            }
          },
        }),
      }
    );

    const data = await response.json();
    const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const parsed = JSON.parse(jsonText);
    return parsed.comment || "Great insights! Thanks for sharing.";
  } catch {
    return "Great insights! Thanks for sharing.";
  }
}

// ============================
// MAIN LOOP (controller)
// ============================

async function main() {
  // === Initialize session ===
  const sessionManager = new SessionManager({
    sessionName: process.env.SESSION_NAME || "linkedin",
    headless: process.env.HEADLESS === "true",
  });

  const mode = sessionManager.getMode();
  const keyword = CLI_ARGS.keyword;
  
  if (keyword) {
    console.log(`🚀 Starting LinkedIn comment automation in ${mode} mode with keyword search: "${keyword}"...`);
  } else {
    console.log(`🚀 Starting LinkedIn comment automation in ${mode} mode...`);
  }

  const session = await sessionManager.initializeStagehand({
    model: "google/gemini-3-flash-preview",
  });

  const page = session.page;

  // Navigate to LinkedIn feed or search results
  const targetUrl = getLinkedInUrl(keyword);
  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
  });
  
  if (keyword) {
    console.log(`➡️ Navigated to LinkedIn search results for "${keyword}"`);
  } else {
    console.log("➡️ Navigated to LinkedIn feed");
  }

  // Wait for feed to load
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // === Validate API key ===
  const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!googleApiKey) {
    throw new Error("Missing Google API key!");
  }

  // Note: Using direct Playwright actions instead of CUA agent for reliability
  // The CUA agent has compatibility issues with LinkedIn (Stagehand "no candidates" error)
  console.log("🤖 Using direct Playwright actions for commenting");

  // === Track engagement rate ===
  let commentsPosted = 0;
  let postsProcessed = 0;

  // === MAIN LOOP ===
  for (let processed = 0; processed < MAX_POSTS; processed++) {
    console.log(`\n📌 Processing post ${processed + 1}/${MAX_POSTS}...`);

    // Find visible post (DOM position only)
    const postInfo = await page.evaluate(findFirstVisiblePost);
    if (!postInfo) {
      console.log("   ⏭️  No visible post found, scrolling...");
      await scrollOnce(page);
      continue;
    }

    // INVARIANT: Check blacklist
    if (RUN_URN_BLACKLIST.has(postInfo.urn)) {
      console.log(`   ⏭️  URN ${postInfo.urn} already processed, scrolling...`);
      await scrollOnce(page);
      continue;
    }

    RUN_URN_BLACKLIST.add(postInfo.urn);

    // --- stabilize ---
    const isAttached = await page.evaluate(isPostAttached, postInfo.index);
    if (!isAttached) {
      console.log("   ⏭️  Post node detached, scrolling...");
      await scrollOnce(page);
      continue;
    }

    // Extract initial post data
    const initialData = await page.evaluate(extractPostData, postInfo.index);
    if (!initialData || !initialData.urn) {
      console.log("   ⏭️  Could not extract post data, scrolling...");
      await scrollOnce(page);
      continue;
    }

    // INVARIANT: URN must match
    assertInvariant(
      initialData.urn === postInfo.urn,
      `URN mismatch: expected ${postInfo.urn}, got ${initialData.urn}`
    );

    // Expand post text (no retries)
    try {
      await expandPostText(postInfo.index, page);
    } catch {
      // Continue even if expansion fails
    }

    // Extract text after expansion
    const expandedText = await page.evaluate(extractPostTextExpanded, postInfo.index);
    if (!expandedText || expandedText.length < 40) {
      console.log("   ⏭️  Post text too short, scrolling...");
      await scrollOnce(page);
      continue;
    }

    postsProcessed++;

    // --- decision ---
    let shouldComment = false;

    try {
      const currentRate = postsProcessed > 0 ? commentsPosted / postsProcessed : 0;
      shouldComment = await agentDecide({
        urn: postInfo.urn,
        text: expandedText,
        maxEngagementRate: COMMENT_RATE,
      });
      
      // Enforce rate limit
      if (shouldComment && currentRate >= COMMENT_RATE) {
        shouldComment = false;
        console.log(`   ⏭️  Rate limit reached (${currentRate.toFixed(2)} >= ${COMMENT_RATE}), skipping...`);
      }
    } catch {
      // Fallback heuristic
      shouldComment = heuristicDecision(expandedText);
      console.log("   ⚠️  Using fallback heuristic");
    }

    if (!shouldComment) {
      console.log("   ⏭️  Decision: SKIP");
      await scrollOnce(page);
      continue;
    }

    // --- execution ---
    // INVARIANT: No comment box should be open
    const commentBoxOpen = await page.evaluate(anyCommentBoxOpen);
    if (commentBoxOpen) {
      console.log("   ⏭️  Comment box already open (unexpected state), scrolling...");
      await scrollOnce(page);
      continue;
    }

    // INVARIANT: Verify post is still at expected index
    const currentPostInfo = await page.evaluate(findFirstVisiblePost);
    if (!currentPostInfo || currentPostInfo.urn !== postInfo.urn) {
      console.log("   ⏭️  Post changed (unexpected state), scrolling...");
      await scrollOnce(page);
      continue;
    }

    try {
      await agentComment({
        urn: postInfo.urn,
        postIndex: currentPostInfo.index,
        text: expandedText,
        stagehand: session.stagehand,
        page: page,
      });

      commentsPosted++;
      console.log(`   ✅ Comment posted (${commentsPosted}/${postsProcessed} = ${(commentsPosted/postsProcessed).toFixed(2)})`);
    } catch (error) {
      console.log(`   ❌ Comment failed: ${error}`);
      // No recovery - just continue
    }

    // Always scroll after processing
    await scrollOnce(page);
  }

  console.log("\n✅ Processing complete!");
  console.log(`📊 Summary: ${postsProcessed} posts processed, ${commentsPosted} comments posted (${(commentsPosted/postsProcessed || 0).toFixed(2)} rate)`);

  // === Cleanup ===
  await sessionManager.cleanup(session);
  console.log("🛑 Session cleaned up");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
