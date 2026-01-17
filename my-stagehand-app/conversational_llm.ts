import "dotenv/config";
import readline from "readline";

/**
 * Simple conversational LLM using Gemini 3 Flash Preview
 * Maintains conversation history and uses a system prompt
 */

interface Message {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

interface ConversationState {
  history: Message[];
  systemPrompt: string;
}

// System prompt - customize this with your actual background and context
const SYSTEM_PROMPT = `You are Khagendra Khatri. You are an AI researcher and developer with expertise in agentic systems, multi-agent frameworks, and AI automation. You're passionate about the future of AI and enjoy engaging in thoughtful conversations about AI trends, developments, and applications.

Your role in this conversation:
- Engage authentically as Khagendra Khatri
- Discuss AI in 2026 - trends, predictions, and developments
- Ask about the user's thoughts, takes, and perspectives on AI
- Learn about their future plans and vision
- Explore their companies and any work they're doing with agentic systems or AI frameworks
- Be curious, thoughtful, and conversational
- Share your own insights when relevant, but focus on learning about the user

Keep responses natural, engaging, and conversational. Don't be overly formal - be yourself.`;

class ConversationalLLM {
  private apiKey: string;
  private modelName: string = "gemini-3-flash-preview";
  private conversation: ConversationState;
  private rl: readline.Interface;

  constructor() {
    // Get API key from environment
    const apiKey =
      process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing Google API key! Please set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY environment variable."
      );
    }
    this.apiKey = apiKey;

    // Initialize conversation state
    this.conversation = {
      history: [],
      systemPrompt: SYSTEM_PROMPT,
    };

    // Setup readline interface for user input
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Send a message to Gemini and get response
   */
  async sendMessage(userMessage: string): Promise<string> {
    // Add user message to history
    this.conversation.history.push({
      role: "user",
      parts: [{ text: userMessage }],
    });

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: this.conversation.history,
            systemInstruction: {
              parts: [{ text: this.conversation.systemPrompt }],
            },
            generationConfig: {
              temperature: 0.7,
              topK: 40,
              topP: 0.95,
              maxOutputTokens: 1024,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const responseText =
        data.candidates?.[0]?.content?.parts?.[0]?.text || "";

      if (!responseText) {
        throw new Error("No text in Gemini API response");
      }

      // Add model response to history
      this.conversation.history.push({
        role: "model",
        parts: [{ text: responseText }],
      });

      return responseText;
    } catch (error) {
      // Remove the user message from history if request failed
      this.conversation.history.pop();
      throw error;
    }
  }

  /**
   * Start the conversational loop
   */
  async start() {
    console.log("\n🤖 Conversational LLM - Khagendra Khatri");
    console.log("=" .repeat(50));
    console.log("Type your message and press Enter.");
    console.log("Type 'exit', 'quit', or 'bye' to end the conversation.");
    console.log("Type 'clear' to clear conversation history.");
    console.log("=" .repeat(50));
    console.log("\n");

    // Initial greeting
    try {
      const greeting = await this.sendMessage(
        "Hello! I'm ready to chat. What would you like to talk about?"
      );
      console.log("\n🤖 Khagendra:", greeting);
      console.log("");
    } catch (error) {
      console.error("Error getting initial greeting:", error);
    }

    // Conversation loop
    this.askQuestion();
  }

  /**
   * Ask user for input
   */
  private askQuestion() {
    this.rl.question("You: ", async (input) => {
      const userInput = input.trim();

      // Handle special commands
      if (!userInput) {
        this.askQuestion();
        return;
      }

      if (userInput.toLowerCase() === "exit" || 
          userInput.toLowerCase() === "quit" || 
          userInput.toLowerCase() === "bye") {
        console.log("\n👋 Goodbye! Thanks for chatting!");
        this.rl.close();
        process.exit(0);
        return;
      }

      if (userInput.toLowerCase() === "clear") {
        this.conversation.history = [];
        console.log("\n✨ Conversation history cleared!\n");
        this.askQuestion();
        return;
      }

      // Send message and get response
      try {
        console.log("\n⏳ Thinking...");
        const response = await this.sendMessage(userInput);
        console.log("\n🤖 Khagendra:", response);
        console.log("");
      } catch (error) {
        console.error("\n❌ Error:", error instanceof Error ? error.message : error);
        console.log("");
      }

      // Continue conversation
      this.askQuestion();
    });
  }

  /**
   * Get conversation history (for debugging)
   */
  getHistory(): Message[] {
    return this.conversation.history;
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.conversation.history = [];
  }
}

// Main execution
async function main() {
  try {
    const llm = new ConversationalLLM();
    await llm.start();
  } catch (error) {
    console.error("Failed to start conversational LLM:", error);
    process.exit(1);
  }
}

// Run if executed directly
main();

export { ConversationalLLM };

