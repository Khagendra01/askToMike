import "dotenv/config";
import http from "http";
import url from "url";

/**
 * Decision-making tool that analyzes LinkedIn post content
 * and determines if we should comment and what to comment
 */
export interface PostData {
  postText: string;
  mediaUrls?: string[];
  videoUrls?: string[];
}

export interface DecisionResult {
  shouldComment: boolean;
  commentText: string;
}

/**
 * Analyzes post content using LLM to decide if we should comment
 * Uses Gemini API via fetch
 */
async function analyzePostAndDecide(
  postData: PostData,
  modelName: string = "gemini-2.0-flash-exp"
): Promise<DecisionResult> {
  const apiKey =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing Google API key! Please set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY"
    );
  }

  // Build context about the post
  let context = `Post Text: ${postData.postText}\n\n`;
  
  if (postData.mediaUrls && postData.mediaUrls.length > 0) {
    context += `Images (${postData.mediaUrls.length}): ${postData.mediaUrls.join(", ")}\n\n`;
  }
  
  if (postData.videoUrls && postData.videoUrls.length > 0) {
    context += `Videos (${postData.videoUrls.length}): ${postData.videoUrls.join(", ")}\n\n`;
  }

  const prompt = `You are analyzing a LinkedIn post to decide if it's worth commenting on.

${context}

Analyze this post and determine:
1. Is this post interesting, valuable, or engaging enough to warrant a thoughtful comment?
2. If yes, what would be an appropriate, genuine, and valuable comment to add?

IMPORTANT: Keep comments SHORT and CONCISE. Aim for 1-2 sentences maximum (under 100 characters preferred). LinkedIn users prefer brief, punchy comments over long paragraphs.

Consider:
- Is the post asking a question or inviting discussion?
- Is it sharing valuable insights or information?
- Would a comment add value to the conversation?
- Is the post spam, promotional, or low-quality? (skip these)
- Would your comment be authentic and helpful?
- Keep it brief - one thoughtful sentence is better than a paragraph

Respond ONLY in valid JSON format (no markdown, no code blocks):
{
  "shouldComment": true/false,
  "commentText": "your short, concise comment here (1-2 sentences max)" or "" if shouldComment is false
}`;

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
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("No text in Gemini API response");
    }

    // Parse JSON from response (handle markdown code blocks if present)
    let jsonText = text.trim();
    if (jsonText.includes("```json")) {
      jsonText = jsonText.split("```json")[1].split("```")[0].trim();
    } else if (jsonText.includes("```")) {
      jsonText = jsonText.split("```")[1].split("```")[0].trim();
    }

    const decision = JSON.parse(jsonText) as DecisionResult;

    // Validate response
    if (
      typeof decision.shouldComment !== "boolean" ||
      typeof decision.commentText !== "string"
    ) {
      throw new Error("Invalid response format from LLM");
    }

    return decision;
  } catch (error) {
    console.error("Error analyzing post:", error);
    // Default to not commenting if there's an error
    return {
      shouldComment: false,
      commentText: "",
    };
  }
}

/**
 * HTTP server to expose the decision tool
 * The agent can call this endpoint via HTTP requests
 */
function startToolServer(port: number = 3001) {
  const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const parsedUrl = url.parse(req.url || "", true);
    if (parsedUrl.pathname !== "/decide") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    try {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", async () => {
        const postData = JSON.parse(body) as PostData;
        const decision = await analyzePostAndDecide(postData);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(decision));
      });
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Internal server error",
          message: error instanceof Error ? error.message : String(error),
        })
      );
    }
  });

  // Listen on all interfaces (0.0.0.0) to be accessible from the internet via Duck DNS
  server.listen(port, "0.0.0.0", () => {
    console.log(`🔧 Decision tool server running on http://0.0.0.0:${port}/decide`);
    console.log(`   Accessible via: http://localhost:${port}/decide (local)`);
    console.log(`   Or via your Duck DNS domain on port ${port}`);
  });

  return server;
}

// Export functions
export { analyzePostAndDecide, startToolServer };

// If run directly (not imported), start the server
// This works when file is executed with: tsx comment_decision_tool.ts
const filePath = process.argv[1] || '';
const isRunDirectly = filePath.includes('comment_decision_tool');

if (isRunDirectly) {
  const port = parseInt(process.env.TOOL_SERVER_PORT || "5000");
  const server = startToolServer(port);
  console.log("Press Ctrl+C to stop the server");
  
  // Keep the process alive and handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    server.close(() => {
      console.log('✓ Server stopped');
      process.exit(0);
    });
  });
  
  process.on('SIGTERM', () => {
    server.close(() => {
      process.exit(0);
    });
  });
}

