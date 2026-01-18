import "dotenv/config";
import { createClient } from "redis";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";

const execAsync = promisify(exec);

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379");
const REDIS_DB = parseInt(process.env.REDIS_DB || "0");
const REDIS_USERNAME = process.env.REDIS_USERNAME || undefined; // Optional, for Redis Cloud
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined; // Optional, for Redis Cloud
// Redis Cloud typically requires TLS - enable by default for non-localhost connections
const REDIS_TLS = process.env.REDIS_TLS !== "false" && (process.env.REDIS_TLS === "true" || REDIS_HOST !== "localhost");
const REDIS_CONNECT_TIMEOUT = parseInt(process.env.REDIS_CONNECT_TIMEOUT || "10000");
const REDIS_QUEUE_NAME = "linkedin_tasks";

interface LinkedInTask {
  type: "linkedin_post";
  post_text: string;
  image_url?: string;
  transcript?: string;
  user_data: {
    name: string;
    linkedin_context_id?: string;
  };
  timestamp: number;
}

interface XTask {
  type: "x_post";
  post_text: string;
  image_url?: string;
  user_data: {
    name: string;
  };
  timestamp: number;
}

interface LinkedInMessageTask {
  type: "linkedin_message";
  full_name: string;
  message: string;
  user_data: {
    name: string;
  };
  timestamp: number;
}

type Task = LinkedInTask | XTask | LinkedInMessageTask;

/**
 * Process a LinkedIn post task by executing the linkedin_post.ts script
 * This runs the script with the post text as an environment variable
 */
async function processLinkedInPost(task: LinkedInTask): Promise<void> {
  console.log(`\n📝 Processing LinkedIn post task...`);
  console.log(`   Post text: ${task.post_text.substring(0, 100)}...`);
  console.log(`   User: ${task.user_data.name}`);
  
  if (task.image_url) {
    console.log(`   🖼️  Image included: ${task.image_url.substring(0, 100)}...`);
  }

  try {
    // Set environment variables for the linkedin_post script
    // The linkedin_post.ts script reads POST_TEXT and IMAGE_URL from env
    const env = {
      ...process.env,
      POST_TEXT: task.post_text,
      ...(task.image_url && { IMAGE_URL: task.image_url }),
    };

    // Execute the linkedin_post.ts script using tsx
    // This runs the script in a separate process with the environment variables
    const { stdout, stderr } = await execAsync("tsx linkedin_post.ts", {
      env,
      cwd: process.cwd(),
    });

    if (stdout) {
      console.log(`✅ LinkedIn post completed successfully`);
      // Only show first few lines of output to avoid clutter
      const outputLines = stdout.split("\n").slice(0, 5).join("\n");
      if (outputLines) {
        console.log(`   Output:\n${outputLines}`);
      }
    }

    if (stderr && !stderr.includes("Warning")) {
      console.warn(`⚠️  Warnings: ${stderr.substring(0, 200)}`);
    }
  } catch (error: any) {
    console.error(`❌ Error processing LinkedIn post: ${error.message}`);
    if (error.stdout) {
      console.error(`   stdout: ${error.stdout.substring(0, 500)}`);
    }
    if (error.stderr) {
      console.error(`   stderr: ${error.stderr.substring(0, 500)}`);
    }
    throw error;
  }
}

/**
 * Process a LinkedIn message task by executing the linkedin_message_dm.ts script
 * This runs the script with the full name and message as CLI arguments
 */
async function processLinkedInMessage(task: LinkedInMessageTask): Promise<void> {
  console.log(`\n📬 Processing LinkedIn message task...`);
  console.log(`   Recipient: ${task.full_name}`);
  console.log(`   Message: ${task.message.substring(0, 100)}...`);
  console.log(`   User: ${task.user_data.name}`);

  try {
    // Execute the linkedin_message_dm.ts script using tsx
    // The script expects: tsx linkedin_message_dm.ts <Full Name> <Message>
    const escapedFullName = task.full_name.replace(/"/g, '\\"');
    const escapedMessage = task.message.replace(/"/g, '\\"');
    
    const { stdout, stderr } = await execAsync(
      `tsx linkedin_message_dm.ts "${escapedFullName}" "${escapedMessage}"`,
      {
        env: process.env,
        cwd: process.cwd(),
        timeout: 120000, // 2 minute timeout for message sending
      }
    );

    if (stdout) {
      console.log(`✅ LinkedIn message sent successfully`);
      // Only show first few lines of output to avoid clutter
      const outputLines = stdout.split("\n").slice(0, 5).join("\n");
      if (outputLines) {
        console.log(`   Output:\n${outputLines}`);
      }
    }

    if (stderr && !stderr.includes("Warning")) {
      console.warn(`⚠️  Warnings: ${stderr.substring(0, 200)}`);
    }
  } catch (error: any) {
    console.error(`❌ Error processing LinkedIn message: ${error.message}`);
    if (error.stdout) {
      console.error(`   stdout: ${error.stdout.substring(0, 500)}`);
    }
    if (error.stderr) {
      console.error(`   stderr: ${error.stderr.substring(0, 500)}`);
    }
    throw error;
  }
}

/**
 * Process an X/Twitter post task by executing the x_post.ts script
 * This runs the script with the post text as an environment variable
 */
async function processXPost(task: XTask): Promise<void> {
  console.log(`\n📝 Processing X/Twitter post task...`);
  console.log(`   Post text: ${task.post_text.substring(0, 100)}...`);
  console.log(`   User: ${task.user_data.name}`);
  
  if (task.image_url) {
    console.log(`   🖼️  Image included: ${task.image_url.substring(0, 100)}...`);
  }

  try {
    // Set environment variables for the x_post script
    // The x_post.ts script reads POST_TEXT and IMAGE_URL from env
    const env = {
      ...process.env,
      POST_TEXT: task.post_text,
      ...(task.image_url && { IMAGE_URL: task.image_url }),
    };

    // Execute the x_post.ts script using tsx
    // This runs the script in a separate process with the environment variables
    const { stdout, stderr } = await execAsync("tsx x_post.ts", {
      env,
      cwd: process.cwd(),
    });

    if (stdout) {
      console.log(`✅ X/Twitter post completed successfully`);
      // Only show first few lines of output to avoid clutter
      const outputLines = stdout.split("\n").slice(0, 5).join("\n");
      if (outputLines) {
        console.log(`   Output:\n${outputLines}`);
      }
    }

    if (stderr && !stderr.includes("Warning")) {
      console.warn(`⚠️  Warnings: ${stderr.substring(0, 200)}`);
    }
  } catch (error: any) {
    console.error(`❌ Error processing X/Twitter post: ${error.message}`);
    if (error.stdout) {
      console.error(`   stdout: ${error.stdout.substring(0, 500)}`);
    }
    if (error.stderr) {
      console.error(`   stderr: ${error.stderr.substring(0, 500)}`);
    }
    throw error;
  }
}

/**
 * Main worker function that consumes tasks from Redis queue
 */
async function main() {
  console.log("🚀 Starting Redis worker for LinkedIn tasks...");
  console.log(`   Redis: ${REDIS_HOST}:${REDIS_PORT}/${REDIS_DB}`);
  console.log(`   TLS: ${REDIS_TLS ? "enabled" : "disabled"}`);
  console.log(`   Queue: ${REDIS_QUEUE_NAME}`);

  const clientConfig: any = {
    socket: {
      host: REDIS_HOST,
      port: REDIS_PORT,
      tls: REDIS_TLS ? {
        // TLS configuration for Redis Cloud
        rejectUnauthorized: false, // Accept self-signed certificates
      } : undefined,
      connectTimeout: REDIS_CONNECT_TIMEOUT,
      keepAlive: 30000, // Keep connection alive
      reconnectStrategy: (retries: number) => {
        if (retries > 10) {
          console.error("❌ Max reconnection attempts reached");
          return new Error("Max reconnection attempts reached");
        }
        // Exponential backoff: 100ms, 200ms, 400ms, etc., capped at 3s
        const delay = Math.min(100 * Math.pow(2, retries), 3000);
        console.log(`🔄 Reconnecting in ${delay}ms... (attempt ${retries + 1})`);
        return delay;
      },
    },
    database: REDIS_DB,
  };

  // Add authentication if provided (for Redis Cloud)
  if (REDIS_USERNAME) {
    clientConfig.username = REDIS_USERNAME;
  }
  if (REDIS_PASSWORD) {
    clientConfig.password = REDIS_PASSWORD;
  }

  const client = createClient(clientConfig);

  // Handle Redis connection events
  client.on("error", (err: Error) => {
    console.error("❌ Redis Client Error:", err);
  });

  client.on("connect", () => {
    console.log("✅ Connected to Redis");
  });

  client.on("ready", () => {
    console.log("✅ Redis client ready");
  });

  // Connect to Redis
  await client.connect();
  console.log("✅ Redis worker connected and ready");

  // Main processing loop
  console.log(`\n⏳ Waiting for tasks in queue: ${REDIS_QUEUE_NAME}...`);
  console.log("   (Press Ctrl+C to stop)\n");

  while (true) {
    try {
      // Blocking pop from the queue (waits up to 5 seconds for a task)
      // Using brPop with correct Redis v4 API
      const result = await client.brPop(
        REDIS_QUEUE_NAME,
        5
      );

      if (result) {
        const taskData = result.element;
        console.log(`\n📥 Received task from queue`);

        try {
          // Parse the task JSON
          const task: Task = JSON.parse(taskData);
          console.log(`   Task type: ${task.type}`);
          console.log(`   Timestamp: ${new Date(task.timestamp * 1000).toISOString()}`);
          if ('image_url' in task && task.image_url) {
            console.log(`   🖼️  Image URL provided: ${task.image_url.substring(0, 80)}...`);
          }

          // Process the task based on type
          if (task.type === "linkedin_post") {
            await processLinkedInPost(task as LinkedInTask);
          } else if (task.type === "x_post") {
            await processXPost(task as XTask);
          } else if (task.type === "linkedin_message") {
            await processLinkedInMessage(task as LinkedInMessageTask);
          } else {
            console.warn(`⚠️  Unknown task type: ${(task as any).type}`);
          }
        } catch (parseError: any) {
          console.error(`❌ Error parsing task: ${parseError.message}`);
          console.error(`   Task data: ${taskData.substring(0, 200)}...`);
        }
      }
    } catch (error: any) {
      console.error(`❌ Error in worker loop: ${error.message}`);
      // Wait a bit before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n\n🛑 Shutting down Redis worker...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n\n🛑 Shutting down Redis worker...");
  process.exit(0);
});

// Start the worker
main().catch((err) => {
  console.error("❌ Fatal error in worker:", err);
  process.exit(1);
});
