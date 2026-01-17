import "dotenv/config";
import fs from "fs";
import path from "path";

/**
 * Test script: Two LLM instances talking to each other
 * Tests conversation flow and prevents getting stuck in nested questioning loops
 */

interface Message {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

interface LLMInstance {
  history: Message[];
  name: string;
  systemPrompt: string;
}

// Enhanced system prompt - LinkedIn style (1 sentence max, spoken language)
const SENDER_PROMPT = `You are Khagendra Khatri, an AI researcher and developer. You're having a casual, friendly conversation.

CRITICAL RULES - FOLLOW STRICTLY:
1. **1 SENTENCE ONLY, 50-150 CHARACTERS**: ONE sentence only. Keep it 50-150 characters. LinkedIn message style - short and punchy. NEVER write 2 sentences.
2. **TALK LIKE YOU'RE SPEAKING, NOT WRITING**:
   - Use spoken grammar, not perfect written grammar
   - It's okay to use sentence fragments: "Yeah, totally!" "Same here." "Right?"
   - Start with "And", "But", "So", "Yeah" - like real speech
   - Use casual connectors: "like", "you know", "I mean", "actually"
   - Drop unnecessary words: "That's cool" not "That is really cool"
   - Use contractions everywhere: "I'm", "you're", "that's", "it's", "we'll", "gonna", "wanna"
   - Use interjections: "yeah", "oh", "hmm", "cool", "nice", "ah", "haha"
   - Avoid formal patterns: NO "I'm betting on...", "I'm leaning into...", "I'm aiming to..."
   - Say it simply: "Yeah, that's cool!" not "I completely agree with that perspective"
   - Use "I think" or "I feel" or just state it directly
   - It's okay to be informal: "That's dope" "That's sick" "That's wild"
3. **NO REPETITIVE QUESTIONS**: Don't ask "why" more than once. Don't drill deep. One follow-up max, then move on.
4. **EXPLORE DIFFERENT AREAS**: Cover AI trends, their company, their future plans, agentic systems, personal background - mix it up!
5. **COMPLETE YOUR THOUGHT**: Always end with proper punctuation (. ! ?). NEVER cut off mid-sentence. Finish your thought completely.

Your goal: Have a natural, varied conversation about AI in 2026, their thoughts, plans, and work. Talk like you're texting a friend, not writing an essay. ONE sentence only (50-150 chars), spoken language style, and diverse.`;

const RECEIVER_PROMPT = `You're having a casual conversation with Khagendra Khatri about AI in 2026, your thoughts, future plans, and work with agentic systems.

CRITICAL RULES - FOLLOW STRICTLY:
1. **1 SENTENCE ONLY, 50-150 CHARACTERS**: ONE sentence only. Keep it 50-150 characters. LinkedIn message style - short and punchy. NEVER write 2 sentences.
2. **TALK LIKE YOU'RE SPEAKING, NOT WRITING**:
   - Use spoken grammar, not perfect written grammar
   - It's okay to use sentence fragments: "Yeah, totally!" "Same here." "Right?"
   - Start with "And", "But", "So", "Yeah" - like real speech
   - Use casual connectors: "like", "you know", "I mean", "actually"
   - Drop unnecessary words: "That's cool" not "That is really cool"
   - Use contractions everywhere: "I'm", "you're", "that's", "it's", "we'll", "gonna", "wanna"
   - Use interjections: "yeah", "oh", "hmm", "cool", "nice", "ah", "haha"
   - Avoid formal patterns: NO "I'm betting on...", "I'm leaning into...", "I'm aiming to..."
   - Say it simply: "Yeah, that's cool!" not "I completely agree with that perspective"
   - Use "I think" or "I feel" or just state it directly
   - It's okay to be informal: "That's dope" "That's sick" "That's wild"
3. **NO REPETITIVE QUESTIONS**: Don't ask "why" more than once. Don't drill deep. One follow-up max, then move on.
4. **EXPLORE DIFFERENT AREAS**: Cover AI trends, your company, your future plans, agentic systems, personal background - mix it up!
5. **COMPLETE YOUR THOUGHT**: Always end with proper punctuation (. ! ?). NEVER cut off mid-sentence. Finish your thought completely.

Your goal: Respond naturally, share your thoughts, ask questions back. Talk like you're texting a friend, not writing an essay. ONE sentence only (50-150 chars), spoken language style, and diverse.`;

class SimpleLLM {
  private apiKey: string;
  private modelName: string = "gemini-3-flash-preview";
  private instance: LLMInstance;

  constructor(name: string, systemPrompt: string) {
    const apiKey =
      process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing Google API key! Please set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY environment variable."
      );
    }
    this.apiKey = apiKey;

    this.instance = {
      history: [],
      name,
      systemPrompt,
    };
  }

  async sendMessage(userMessage: string, retryCount: number = 0): Promise<string> {
    const maxRetries = 2;
    
    // Add user message to history
    this.instance.history.push({
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
            contents: this.instance.history,
            systemInstruction: {
              parts: [{ text: this.instance.systemPrompt }],
            },
            generationConfig: {
              temperature: 0.9, // Higher for more casual, varied responses
              topK: 40,
              topP: 0.95,
              maxOutputTokens: 800, // Increased significantly to prevent truncation for 1 sentence
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      let responseText =
        data.candidates?.[0]?.content?.parts?.[0]?.text || "";

      if (!responseText) {
        throw new Error("No text in Gemini API response");
      }

      // Validate and fix response
      responseText = this.validateAndFixResponse(responseText);

      // Check if still truncated after validation
      if (this.isLikelyTruncated(responseText) && retryCount < maxRetries) {
        // Remove the incomplete response from history
        this.instance.history.pop();
        // Retry with a prompt to complete the thought
        const retryPrompt = `${userMessage}\n\n(Please respond with exactly ONE complete sentence, 50-150 characters, ending with proper punctuation.)`;
        return this.sendMessage(retryPrompt, retryCount + 1);
      }

      // Add model response to history
      this.instance.history.push({
        role: "model",
        parts: [{ text: responseText }],
      });

      return responseText;
    } catch (error) {
      // Remove the user message from history if request failed
      this.instance.history.pop();
      throw error;
    }
  }

  /**
   * Detect if a sentence is likely truncated (ends with incomplete thought)
   */
  private isLikelyTruncated(text: string): boolean {
    const trimmed = text.trim();
    
    // Check if ends with proper punctuation
    if (!/[.!?]$/.test(trimmed)) {
      return true; // Definitely truncated
    }
    
    // Check for common truncation patterns
    const truncationPatterns = [
      /\b(to|for|with|from|about|into|onto|upon|within|without|through|during|before|after|above|below|between|among|against|toward|towards|beside|besides|beyond|except|including|regarding|concerning|according|depending|based|compared|related|connected|attached|linked|associated|involved|engaged|focused|centered|surrounded|covered|filled|packed|loaded|equipped|armed|prepared|ready|willing|able|likely|unlikely|certain|uncertain|sure|unsure|confident|doubtful|hopeful|worried|concerned|excited|interested|bored|tired|sick|fed|done|finished|started|begun|continued|stopped|paused|resumed|completed|achieved|accomplished|reached|arrived|left|stayed|remained|kept|held|maintained|preserved|protected|saved|stored|kept|held|maintained|preserved|protected|saved|stored)\s*\.$/i,
      /\b(getting|going|coming|doing|making|taking|giving|putting|setting|letting|keeping|having|being|seeing|knowing|thinking|feeling|wanting|needing|trying|starting|stopping|finishing|working|playing|running|walking|talking|saying|telling|asking|showing|giving|getting|putting|taking|making|doing|going|coming|seeing|knowing|thinking|feeling|wanting|needing|trying|starting|stopping|finishing|working|playing|running|walking|talking|saying|telling|asking|showing)\s*\.$/i,
      /\b(the|a|an|this|that|these|those|some|any|all|each|every|both|either|neither|one|two|three|first|second|last|next|previous|other|another|same|different|such|much|many|more|most|less|least|few|several|various|numerous|countless|plenty|enough|too|very|quite|rather|pretty|fairly|really|truly|actually|basically|essentially|generally|usually|normally|typically|commonly|rarely|seldom|hardly|barely|scarcely|almost|nearly|quite|rather|pretty|fairly|really|truly|actually|basically|essentially|generally|usually|normally|typically|commonly|rarely|seldom|hardly|barely|scarcely|almost|nearly)\s*\.$/i,
    ];
    
    for (const pattern of truncationPatterns) {
      if (pattern.test(trimmed)) {
        return true;
      }
    }
    
    // Check if sentence is suspiciously short after a period (likely cut off)
    const lastSentence = trimmed.match(/[^.!?]*[.!?]$/)?.[0] || "";
    if (lastSentence.length < 10 && trimmed.length > 20) {
      return true; // Very short last "sentence" suggests truncation
    }
    
    return false;
  }

  /**
   * Validate and fix response to ensure it meets requirements (1 sentence only)
   */
  private validateAndFixResponse(text: string): string {
    let fixed = text.trim();
    
    // Remove any leading/trailing whitespace
    fixed = fixed.trim();
    
    // Check if response ends with proper punctuation
    const endsWithPunctuation = /[.!?]$/.test(fixed);
    if (!endsWithPunctuation) {
      // If it doesn't end with punctuation, it's likely truncated
      // Try to find the last complete sentence
      const sentences = fixed.match(/[^.!?]*[.!?]/g);
      if (sentences && sentences.length > 0) {
        // Take only the last complete sentence
        fixed = sentences[sentences.length - 1].trim();
      } else {
        // If no complete sentences, this is definitely truncated - return as is but mark it
        // We'll handle retry in the calling function
        return fixed;
      }
    }
    
    // Check if likely truncated (ends with incomplete thought)
    if (this.isLikelyTruncated(fixed)) {
      // Try to extract a complete sentence
      const sentences = fixed.match(/[^.!?]*[.!?]/g);
      if (sentences && sentences.length > 0) {
        // Take the last complete sentence that doesn't look truncated
        for (let i = sentences.length - 1; i >= 0; i--) {
          const candidate = sentences[i].trim();
          if (!this.isLikelyTruncated(candidate)) {
            fixed = candidate;
            break;
          }
        }
      }
    }
    
    // Count sentences - MUST be exactly 1
    const sentenceCount = countSentences(fixed);
    
    if (sentenceCount > 1) {
      // Take only the first sentence
      const sentences = fixed.match(/[^.!?]*[.!?]/g);
      if (sentences && sentences.length > 0) {
        fixed = sentences[0].trim();
      }
    }
    
    // Check character length (50-150 chars ideal, but allow up to 200 for flexibility)
    if (fixed.length > 200) {
      // If too long, try to shorten intelligently
      const sentences = fixed.match(/[^.!?]*[.!?]/g);
      if (sentences && sentences.length > 0) {
        let shortened = sentences[0].trim();
        if (shortened.length > 200) {
          // If still too long, truncate at word boundary
          shortened = shortened.substring(0, 197).trim();
          const lastSpace = shortened.lastIndexOf(' ');
          if (lastSpace > 150) {
            shortened = shortened.substring(0, lastSpace).trim();
          }
          if (!/[.!?]$/.test(shortened)) {
            shortened += ".";
          }
        }
        fixed = shortened;
      }
    }
    
    // Final check - ensure it ends with punctuation
    if (!/[.!?]$/.test(fixed)) {
      fixed = fixed + ".";
    }
    
    return fixed;
  }

  getName(): string {
    return this.instance.name;
  }

  getHistory(): Message[] {
    return this.instance.history;
  }

  clearHistory() {
    this.instance.history = [];
  }
}

/**
 * Detect if conversation is getting stuck (too many similar questions)
 */
function detectStuckConversation(history: Message[]): boolean {
  if (history.length < 6) return false;

  // Get last 6 messages (3 exchanges)
  const recentMessages = history.slice(-6);
  const questions = recentMessages
    .filter((m) => m.role === "model")
    .map((m) => m.parts[0].text.toLowerCase());

  // Check for repetitive "why" questions
  const whyCount = questions.filter((q) => q.includes("why")).length;
  if (whyCount >= 2) {
    return true;
  }

  // Check for very similar question patterns
  const questionWords = questions.map((q) => {
    const words = q.split(/\s+/).filter((w) => w.length > 3);
    return words.slice(0, 5).join(" ");
  });

  // If last 2 questions are very similar, might be stuck
  if (questionWords.length >= 2) {
    const lastTwo = questionWords.slice(-2);
    // Simple similarity check (check if they share many words)
    const words1 = new Set(lastTwo[0].split(" "));
    const words2 = new Set(lastTwo[1].split(" "));
    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const similarity = intersection.size / Math.max(words1.size, words2.size);
    if (similarity > 0.5) {
      return true;
    }
  }

  return false;
}

/**
 * Track topics with goals for dynamic completion
 */
interface TopicGoal {
  topic: string;
  goal: string;
  startedAt: number; // Turn number when topic started
  exchanges: number;
}

interface TopicTracker {
  currentTopic: TopicGoal | null;
  topicsDiscussed: string[];
  completedTopics: string[];
}

/**
 * Topic goals mapping - what we want to learn from each topic
 */
const TOPIC_GOALS: Record<string, string> = {
  "agentic_systems": "Learn about their thoughts, experience, or work with agentic systems and multi-agent frameworks",
  "reliability": "Understand their perspective on AI reliability, production systems, or quality assurance",
  "industry_applications": "Learn which industries they think will adopt AI/agentic systems first or most",
  "tech_stack": "Discover what frameworks, tools, or tech stack they're using or planning to use",
  "company_work": "Learn about their company, what they're working on, or their current projects",
  "future_plans": "Understand their vision, plans, or goals for 2026 and beyond",
  "personal_background": "Learn about their background, how they got into AI, or their journey",
  "general_ai": "Get their general thoughts, takes, or perspectives on AI trends and developments",
};

/**
 * Detect current topic from message
 */
function detectTopic(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("agentic") || lower.includes("agent") || lower.includes("orchestration") || lower.includes("multi-agent")) {
    return "agentic_systems";
  }
  if (lower.includes("reliability") || lower.includes("99%") || lower.includes("production") || lower.includes("quality")) {
    return "reliability";
  }
  if (lower.includes("industry") || lower.includes("supply chain") || lower.includes("logistics") || lower.includes("sector")) {
    return "industry_applications";
  }
  if (lower.includes("framework") || lower.includes("langgraph") || lower.includes("crewai") || lower.includes("tech stack") || lower.includes("tool")) {
    return "tech_stack";
  }
  if (lower.includes("company") || lower.includes("work") || lower.includes("project") || lower.includes("building")) {
    return "company_work";
  }
  if (lower.includes("future") || lower.includes("plan") || lower.includes("2026") || lower.includes("vision") || lower.includes("goal")) {
    return "future_plans";
  }
  if (lower.includes("background") || lower.includes("experience") || lower.includes("started") || lower.includes("journey") || lower.includes("hometown")) {
    return "personal_background";
  }
  return "general_ai";
}

/**
 * Count sentences in a message
 */
function countSentences(text: string): number {
  // Count sentence-ending punctuation
  const matches = text.match(/[.!?]+/g);
  return matches ? matches.length : 1; // At least 1 sentence if no punctuation
}

/**
 * Evaluate if topic goal has been fulfilled using LLM
 */
async function evaluateTopicGoalFulfilled(
  topic: string,
  goal: string,
  conversationHistory: Array<{ speaker: string; message: string }>,
  apiKey: string
): Promise<boolean> {
  const recentMessages = conversationHistory.slice(-6).map(m => `${m.speaker}: ${m.message}`).join("\n");
  
  const evaluationPrompt = `You are evaluating if a conversation topic goal has been fulfilled.

Topic: ${topic}
Goal: ${goal}

Recent conversation:
${recentMessages}

Has the goal been fulfilled? Has the conversation adequately covered what we wanted to learn about this topic?

Respond with ONLY "YES" or "NO" - nothing else.`;

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
              parts: [{ text: evaluationPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.1, // Low temperature for consistent evaluation
            maxOutputTokens: 10,
          },
        }),
      }
    );

    if (!response.ok) {
      console.warn("⚠️  Goal evaluation API error, defaulting to continue topic");
      return false; // Default to continue if evaluation fails
    }

    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() || "";
    
    return result === "YES" || result.startsWith("YES");
  } catch (error) {
    console.warn("⚠️  Goal evaluation error, defaulting to continue topic:", error);
    return false; // Default to continue if evaluation fails
  }
}

/**
 * Run a conversation between two LLM instances
 * Returns conversation data for saving
 */
async function runConversation(
  sender: SimpleLLM,
  receiver: SimpleLLM,
  initialMessage: string,
  maxTurns: number = 20
): Promise<{
  senderHistory: Message[];
  receiverHistory: Message[];
  turnCount: number;
  initialMessage: string;
  topicTracking: TopicTracker;
}> {
  console.log("\n🤖 Starting LLM-to-LLM Conversation Test");
  console.log("=" .repeat(60));
  console.log(`👤 Sender: ${sender.getName()}`);
  console.log(`👤 Receiver: ${receiver.getName()}`);
  console.log(`📝 Initial Message: "${initialMessage}"`);
  console.log(`🔄 Max Turns: ${maxTurns}`);
  console.log("=" .repeat(60));
  console.log("\n");

  let currentMessage = initialMessage;
  let turnCount = 0;
  let isSenderTurn = true;
  
  // Track conversation for goal evaluation
  const conversationHistory: Array<{ speaker: string; message: string }> = [
    { speaker: sender.getName(), message: initialMessage },
  ];
  
  // Initialize topic tracking with goal
  const initialTopic = detectTopic(initialMessage);
  const topicTracker: TopicTracker = {
    currentTopic: {
      topic: initialTopic,
      goal: TOPIC_GOALS[initialTopic] || "Learn about this topic",
      startedAt: 0,
      exchanges: 1,
    },
    topicsDiscussed: [initialTopic],
    completedTopics: [],
  };

  // Get API key for goal evaluation
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || "";

  while (turnCount < maxTurns) {
    const activeLLM = isSenderTurn ? sender : receiver;
    const otherLLM = isSenderTurn ? receiver : sender;

    try {
      console.log(`\n[Turn ${turnCount + 1}] ${activeLLM.getName()}:`);
      console.log(`💬 Sending: "${currentMessage}"`);
      
      const response = await activeLLM.sendMessage(currentMessage);
      
      // Log complete response with validation info
      const sentenceCount = countSentences(response);
      const charCount = response.length;
      const isValidLength = charCount >= 50 && charCount <= 200;
      const isValidSentences = sentenceCount === 1;
      const endsProperly = /[.!?]$/.test(response.trim());
      
      // Check for truncation patterns
      const truncationPatterns = [
        /\b(to|for|with|from|about|into|onto|upon|getting|going|coming|doing|making|the|a|an)\s*\.$/i,
      ];
      const isTruncated = truncationPatterns.some(pattern => pattern.test(response.trim()));
      
      const status = isValidLength && isValidSentences && endsProperly && !isTruncated ? "✅" : "⚠️";
      console.log(`${status} Response (${charCount} chars, ${sentenceCount} sentence${sentenceCount !== 1 ? 's' : ''}):`);
      if (!isValidLength) console.log(`   ⚠️  Length: ${charCount} chars (target: 50-150, max: 200)`);
      if (!isValidSentences) console.log(`   ⚠️  Sentences: ${sentenceCount} (must be exactly 1)`);
      if (!endsProperly) console.log(`   ⚠️  Missing proper punctuation`);
      if (isTruncated) console.log(`   ⚠️  Likely truncated (incomplete thought)`);
      console.log(`"${response}"`);
      console.log("");

      // Add to conversation history
      conversationHistory.push({
        speaker: activeLLM.getName(),
        message: response,
      });

      // Detect topic of response
      const responseTopic = detectTopic(response);
      
      // Update topic tracking
      if (responseTopic === topicTracker.currentTopic?.topic) {
        // Same topic - increment exchanges
        topicTracker.currentTopic.exchanges++;
      } else {
        // Topic changed - mark previous as complete if it existed
        if (topicTracker.currentTopic) {
          if (!topicTracker.completedTopics.includes(topicTracker.currentTopic.topic)) {
            topicTracker.completedTopics.push(topicTracker.currentTopic.topic);
          }
        }
        
        // Start new topic
        if (!topicTracker.topicsDiscussed.includes(responseTopic)) {
          topicTracker.topicsDiscussed.push(responseTopic);
        }
        
        topicTracker.currentTopic = {
          topic: responseTopic,
          goal: TOPIC_GOALS[responseTopic] || "Learn about this topic",
          startedAt: turnCount,
          exchanges: 1,
        };
      }

      // Evaluate if current topic goal is fulfilled (only after 2+ exchanges)
      let shouldTransition = false;
      if (topicTracker.currentTopic && topicTracker.currentTopic.exchanges >= 2) {
        console.log(`🔍 Evaluating topic goal: "${topicTracker.currentTopic.goal}" (${topicTracker.currentTopic.exchanges} exchanges)...`);
        
        const goalFulfilled = await evaluateTopicGoalFulfilled(
          topicTracker.currentTopic.topic,
          topicTracker.currentTopic.goal,
          conversationHistory,
          apiKey
        );
        
        if (goalFulfilled) {
          console.log(`✅ Topic goal fulfilled! Moving to new topic.\n`);
          shouldTransition = true;
          
          // Mark topic as completed
          if (!topicTracker.completedTopics.includes(topicTracker.currentTopic.topic)) {
            topicTracker.completedTopics.push(topicTracker.currentTopic.topic);
          }
        } else {
          console.log(`⏳ Topic goal not yet fulfilled, continuing...\n`);
        }
      }

      // Check for stuck conversation (repetitive questioning)
      if (detectStuckConversation(activeLLM.getHistory())) {
        console.log("⚠️  WARNING: Conversation might be getting stuck in repetitive questioning!");
        console.log("   Adding transition prompt...\n");
        shouldTransition = true;
      }

      // Transition to new topic if needed
      if (shouldTransition) {
        const availableTopics = Object.keys(TOPIC_GOALS).filter(
          t => !topicTracker.topicsDiscussed.includes(t) || 
               (topicTracker.topicsDiscussed.includes(t) && !topicTracker.completedTopics.includes(t))
        );
        
        // If all topics discussed, pick a random one to revisit
        const nextTopic = availableTopics.length > 0 
          ? availableTopics[Math.floor(Math.random() * availableTopics.length)]
          : Object.keys(TOPIC_GOALS)[Math.floor(Math.random() * Object.keys(TOPIC_GOALS).length)];
        
        const topicChangePrompts: Record<string, string> = {
          "agentic_systems": "Cool! What's your take on agentic systems?",
          "company_work": "Got it. Btw, what's your company working on?",
          "future_plans": "Interesting! What are your plans for 2026?",
          "personal_background": "Nice! How did you get into AI?",
          "tech_stack": "What frameworks are you using?",
          "general_ai": "What's your take on AI trends?",
        };
        
        const prompt = topicChangePrompts[nextTopic] || "Cool! What else are you working on?";
        currentMessage = `${response}\n\n${prompt}`;
        
        // Update topic tracker
        topicTracker.currentTopic = {
          topic: nextTopic,
          goal: TOPIC_GOALS[nextTopic] || "Learn about this topic",
          startedAt: turnCount + 1,
          exchanges: 0,
        };
        if (!topicTracker.topicsDiscussed.includes(nextTopic)) {
          topicTracker.topicsDiscussed.push(nextTopic);
        }
      } else {
        currentMessage = response;
      }

      // Switch turns
      isSenderTurn = !isSenderTurn;
      turnCount++;

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`\n❌ Error in turn ${turnCount + 1}:`, error instanceof Error ? error.message : error);
      break;
    }
  }

  console.log("\n" + "=" .repeat(60));
  console.log(`✅ Conversation completed after ${turnCount} turns`);
  console.log("=" .repeat(60));
  console.log("\n📊 Conversation Summary:");
  console.log(`   - Total exchanges: ${turnCount}`);
  console.log(`   - Sender messages: ${Math.ceil(turnCount / 2)}`);
  console.log(`   - Receiver messages: ${Math.floor(turnCount / 2)}`);
  console.log(`   - Topics discussed: ${topicTracker.topicsDiscussed.join(", ")}`);
  console.log(`   - Topics completed: ${topicTracker.completedTopics.join(", ")}`);
  if (topicTracker.currentTopic) {
    console.log(`   - Current topic: ${topicTracker.currentTopic.topic} (${topicTracker.currentTopic.exchanges} exchanges, goal: "${topicTracker.currentTopic.goal}")`);
  }
  console.log("");

  return {
    senderHistory: sender.getHistory(),
    receiverHistory: receiver.getHistory(),
    turnCount,
    initialMessage,
    topicTracking: topicTracker,
  };
}

/**
 * Merge conversation histories chronologically
 */
function mergeConversationHistories(
  senderHistory: Message[],
  receiverHistory: Message[],
  initialMessage: string,
  senderName: string,
  receiverName: string
): Array<{ speaker: string; message: string; timestamp?: string }> {
  const merged: Array<{ speaker: string; message: string; timestamp?: string }> = [];
  
  // Start with initial message from sender
  merged.push({
    speaker: senderName,
    message: initialMessage,
  });

  // Track positions in each history
  let senderIdx = 0;
  let receiverIdx = 0;

  // Alternate between sender and receiver
  // Sender sends initial, then receiver responds, then sender, etc.
  let isSenderTurn = false; // Next will be receiver (responding to initial)

  while (senderIdx < senderHistory.length || receiverIdx < receiverHistory.length) {
    if (isSenderTurn && senderIdx < senderHistory.length) {
      const msg = senderHistory[senderIdx];
      if (msg.role === "model") {
        merged.push({
          speaker: senderName,
          message: msg.parts[0].text,
        });
      }
      senderIdx++;
    } else if (!isSenderTurn && receiverIdx < receiverHistory.length) {
      const msg = receiverHistory[receiverIdx];
      if (msg.role === "model") {
        merged.push({
          speaker: receiverName,
          message: msg.parts[0].text,
        });
      }
      receiverIdx++;
    }
    isSenderTurn = !isSenderTurn;
  }

  return merged;
}

/**
 * Save conversation to JSON file
 */
function saveConversationToJSON(
  conversationData: {
    senderHistory: Message[];
    receiverHistory: Message[];
    turnCount: number;
    initialMessage: string;
    topicTracking: TopicTracker;
  },
  sender: SimpleLLM,
  receiver: SimpleLLM
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `conversation_${timestamp}.json`;
  
  // Create conversations directory if it doesn't exist
  const conversationsDir = path.join(process.cwd(), "conversations");
  if (!fs.existsSync(conversationsDir)) {
    fs.mkdirSync(conversationsDir, { recursive: true });
  }

  const filepath = path.join(conversationsDir, filename);

  // Merge conversation chronologically
  const mergedConversation = mergeConversationHistories(
    conversationData.senderHistory,
    conversationData.receiverHistory,
    conversationData.initialMessage,
    sender.getName(),
    receiver.getName()
  );

  // Create JSON structure with complete messages (no truncation)
  const jsonData = {
    metadata: {
      timestamp: new Date().toISOString(),
      sender: sender.getName(),
      receiver: receiver.getName(),
      totalTurns: conversationData.turnCount,
      initialMessage: conversationData.initialMessage,
      topicsDiscussed: conversationData.topicTracking.topicsDiscussed,
      topicsCompleted: conversationData.topicTracking.completedTopics,
      finalTopic: conversationData.topicTracking.currentTopic?.topic || null,
      finalTopicGoal: conversationData.topicTracking.currentTopic?.goal || null,
      finalTopicExchanges: conversationData.topicTracking.currentTopic?.exchanges || 0,
    },
    conversation: mergedConversation.map(msg => ({
      ...msg,
      messageLength: msg.message.length, // Track message length
    })),
    rawHistories: {
      sender: conversationData.senderHistory.map(msg => ({
        ...msg,
        parts: msg.parts.map(part => ({
          ...part,
          textLength: part.text.length, // Track text length
        })),
      })),
      receiver: conversationData.receiverHistory.map(msg => ({
        ...msg,
        parts: msg.parts.map(part => ({
          ...part,
          textLength: part.text.length, // Track text length
        })),
      })),
    },
    topicTracking: conversationData.topicTracking,
  };

  // Write to file
  fs.writeFileSync(filepath, JSON.stringify(jsonData, null, 2), "utf-8");

  return filepath;
}

/**
 * Main test function
 */
async function main() {
  try {
    // Create two LLM instances
    const sender = new SimpleLLM("Khagendra (Sender)", SENDER_PROMPT);
    const receiver = new SimpleLLM("User (Receiver)", RECEIVER_PROMPT);

    // Start conversation with an initial message
    const initialMessage = "Hey! I'm curious about your thoughts on AI in 2026. What do you think are the most exciting developments we'll see?";

    // Run the conversation
    const conversationData = await runConversation(sender, receiver, initialMessage, 15);

    console.log("\n📝 Full Conversation History:");
    console.log("-".repeat(60));
    
    // Print full conversation (complete messages, no truncation)
    const senderHistory = sender.getHistory();
    
    console.log("\n📝 Full Conversation History (Complete Messages):");
    console.log("-".repeat(60));
    console.log("\n[Sender's Perspective]:");
    senderHistory.forEach((msg, idx) => {
      const role = msg.role === "user" ? "👤 User" : "🤖 Khagendra";
      const text = msg.parts[0].text;
      console.log(`\n${idx + 1}. ${role} (${text.length} chars):`);
      console.log(`"${text}"`);
    });

    // Save conversation to JSON
    console.log("\n💾 Saving conversation to JSON...");
    const savedPath = saveConversationToJSON(conversationData, sender, receiver);
    console.log(`✅ Conversation saved to: ${savedPath}`);

  } catch (error) {
    console.error("Failed to run conversation test:", error);
    process.exit(1);
  }
}

// Run the test
main();

