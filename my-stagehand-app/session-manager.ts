import "dotenv/config";
import { Browserbase } from "@browserbasehq/sdk";
import { Stagehand } from "@browserbasehq/stagehand";
import { chromium, Browser, BrowserContext, Page } from "playwright-core";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export type BrowserMode = "LOCAL" | "BROWSERBASE";

export interface SessionConfig {
  mode: BrowserMode;
  sessionName?: string; // For naming the session/profile
  headless?: boolean; // For local browser
  userDataDir?: string; // Custom userDataDir path for local browser
}

export interface SessionInfo {
  mode: BrowserMode;
  contextId?: string; // For Browserbase
  userDataDir?: string; // For local browser
  sessionId?: string; // Current Browserbase session ID
  connectUrl?: string; // Current Browserbase connect URL
}

export interface StagehandSession {
  stagehand: Stagehand;
  browser?: Browser | null; // Only for local mode
  page: any; // Stagehand returns a different Page type than Playwright
  playwrightPage?: Page; // Additional Playwright page for file uploads
  playwrightBrowser?: Browser; // Additional Playwright browser connection
  sessionInfo: SessionInfo;
}

/**
 * Session Manager that supports both LOCAL browser and BROWSERBASE cloud
 * with persistent login sessions.
 */
export class SessionManager {
  private config: SessionConfig;
  private storageDir: string;
  private sessionInfoPath: string;

  constructor(config?: Partial<SessionConfig>) {
    // Determine mode from config or environment variable
    const mode = (config?.mode || process.env.BROWSER_MODE || "BROWSERBASE").toUpperCase() as BrowserMode;
    
    this.config = {
      mode,
      sessionName: config?.sessionName || process.env.SESSION_NAME || "default",
      headless: config?.headless ?? (process.env.HEADLESS === "true"),
      userDataDir: config?.userDataDir,
    };

    // Create storage directory for session info
    this.storageDir = path.join(process.cwd(), ".sessions");
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    this.sessionInfoPath = path.join(
      this.storageDir,
      `${this.config.sessionName}-session.json`
    );
  }

  /**
   * Get the current mode
   */
  getMode(): BrowserMode {
    return this.config.mode;
  }

  /**
   * Save session information to disk
   */
  saveSessionInfo(sessionInfo: SessionInfo): void {
    fs.writeFileSync(
      this.sessionInfoPath,
      JSON.stringify(sessionInfo, null, 2)
    );
    console.log(`💾 Session info saved to: ${this.sessionInfoPath}`);
  }

  /**
   * Load session information from disk
   * Also checks for legacy linkedin-context.json format for backward compatibility
   */
  private loadSessionInfo(): SessionInfo | null {
    // Try new format first
    if (fs.existsSync(this.sessionInfoPath)) {
      try {
        const data = fs.readFileSync(this.sessionInfoPath, "utf-8");
        const sessionInfo = JSON.parse(data);
        return sessionInfo;
      } catch (error) {
        console.warn(`⚠️ Failed to load session info: ${error}`);
      }
    }

    // Fallback to legacy linkedin-context.json format (for backward compatibility)
    const legacyPath = path.join(process.cwd(), "linkedin-context.json");
    if (fs.existsSync(legacyPath)) {
      try {
        console.log("📦 Found legacy linkedin-context.json, migrating...");
        const data = fs.readFileSync(legacyPath, "utf-8");
        const legacy = JSON.parse(data);
        
        if (legacy.contextId) {
          const sessionInfo: SessionInfo = {
            mode: "BROWSERBASE",
            contextId: legacy.contextId,
          };
          
          // Save in new format
          this.saveSessionInfo(sessionInfo);
          console.log("✅ Migrated to new session format");
          
          return sessionInfo;
        }
      } catch (error) {
        console.warn(`⚠️ Failed to load legacy session info: ${error}`);
      }
    }

    return null;
  }

  /**
   * Get or create userDataDir for local browser
   */
  private getUserDataDir(): string {
    if (this.config.userDataDir) {
      return this.config.userDataDir;
    }

    const userDataDir = path.join(
      this.storageDir,
      `${this.config.sessionName}-browser-profile`
    );

    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    return userDataDir;
  }

  /**
   * Initialize a new session for login (first time setup)
   */
  async createLoginSession(): Promise<{
    page: Page;
    browser?: Browser | null;
    sessionInfo: SessionInfo;
    cleanup: () => Promise<void>;
  }> {
    if (this.config.mode === "LOCAL") {
      return this.createLocalLoginSession();
    } else {
      return this.createBrowserbaseLoginSession();
    }
  }

  /**
   * Create a local browser session for login
   */
  private async createLocalLoginSession(): Promise<{
    page: Page;
    browser: Browser | null;
    sessionInfo: SessionInfo;
    cleanup: () => Promise<void>;
  }> {
    const userDataDir = this.getUserDataDir();

    console.log(`🌐 Starting LOCAL browser session...`);
    console.log(`📁 User data directory: ${userDataDir}`);

    // Use persistent userDataDir so cookies and login state are saved
    const browserContext = await chromium.launchPersistentContext(userDataDir, {
      headless: this.config.headless ?? false,
      channel: "chrome", // Use installed Chrome
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
      ],
      viewport: { width: 1288, height: 711 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    // Get the first page from the persistent context
    const pages = browserContext.pages();
    const page = pages.length > 0 ? pages[0] : await browserContext.newPage();
    
    // Get the browser from the context
    const browser = browserContext.browser();

    const sessionInfo: SessionInfo = {
      mode: "LOCAL",
      userDataDir,
    };

    const cleanup = async () => {
      if (browser) {
        await browser.close();
      } else {
        await browserContext.close();
      }
    };

    return { page, browser: browser ?? null, sessionInfo, cleanup };
  }

  /**
   * Create a Browserbase session for login
   */
  private async createBrowserbaseLoginSession(): Promise<{
    page: Page;
    sessionInfo: SessionInfo;
    cleanup: () => Promise<void>;
  }> {
    const bb = new Browserbase({
      apiKey: process.env.BROWSERBASE_API_KEY!,
    });

    if (!process.env.BROWSERBASE_API_KEY) {
      throw new Error("BROWSERBASE_API_KEY environment variable is required for BROWSERBASE mode");
    }

    if (!process.env.BROWSERBASE_PROJECT_ID) {
      throw new Error("BROWSERBASE_PROJECT_ID environment variable is required for BROWSERBASE mode");
    }

    console.log(`☁️ Starting BROWSERBASE session...`);

    // Create a context that will persist login cookies
    const context = await bb.contexts.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
    });

    // Start a browser session using that context
    const session = await bb.sessions.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      browserSettings: {
        blockAds: true,
        viewport: {
          width: 1288,
          height: 711,
        },
        context: { id: context.id, persist: true },
      },
    });

    // Connect Playwright to the Browserbase session
    const browser = await chromium.connectOverCDP(session.connectUrl);
    const page = browser.contexts()[0].pages()[0];

    const sessionInfo: SessionInfo = {
      mode: "BROWSERBASE",
      contextId: context.id,
      sessionId: session.id,
      connectUrl: session.connectUrl,
    };

    const cleanup = async () => {
      await browser.close();
      await bb.sessions.update(session.id, {
        projectId: process.env.BROWSERBASE_PROJECT_ID!,
        status: "REQUEST_RELEASE",
      });
    };

    return { page, sessionInfo, cleanup };
  }

  /**
   * Initialize Stagehand with persistent session
   */
  async initializeStagehand(options?: {
    model?: string;
    verbose?: boolean;
  }): Promise<StagehandSession> {
    const savedSessionInfo = this.loadSessionInfo();

    if (this.config.mode === "LOCAL") {
      return this.initializeLocalStagehand(savedSessionInfo, options);
    } else {
      return this.initializeBrowserbaseStagehand(savedSessionInfo, options);
    }
  }

  /**
   * Initialize Stagehand with local browser
   */
  private async initializeLocalStagehand(
    savedSessionInfo: SessionInfo | null,
    options?: { model?: string; verbose?: boolean }
  ): Promise<StagehandSession> {
    const userDataDir = savedSessionInfo?.userDataDir || this.getUserDataDir();

    console.log(`🌐 Initializing LOCAL browser with Stagehand...`);
    console.log(`📁 Using profile: ${userDataDir}`);

    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: {
        headless: this.config.headless ?? false,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-dev-shm-usage",
        ],
        // Use persistent userDataDir to maintain login state
        userDataDir: userDataDir,
      },
      model: options?.model || "google/gemini-3-flash-preview",
      verbose: options?.verbose ? 1 : 0,
    });

    await stagehand.init();

    const page = stagehand.context.pages()[0];
    
    // Browser is managed by Stagehand internally, not directly accessible
    const browser: Browser | null = null;

    // Set viewport to recommended size for LOCAL mode
    await page.setViewportSize(1288, 711);

    const sessionInfo: SessionInfo = {
      mode: "LOCAL",
      userDataDir,
    };

    this.saveSessionInfo(sessionInfo);

    return {
      stagehand,
      browser,
      page,
      sessionInfo,
    };
  }

  /**
   * Initialize Stagehand with Browserbase
   */
  private async initializeBrowserbaseStagehand(
    savedSessionInfo: SessionInfo | null,
    options?: { model?: string; verbose?: boolean }
  ): Promise<StagehandSession> {
    if (!savedSessionInfo?.contextId) {
      throw new Error(
        `No saved Browserbase context found. Please run login-session.ts first to create a login session.`
      );
    }

    if (!process.env.BROWSERBASE_API_KEY) {
      throw new Error("BROWSERBASE_API_KEY environment variable is required");
    }

    if (!process.env.BROWSERBASE_PROJECT_ID) {
      throw new Error("BROWSERBASE_PROJECT_ID environment variable is required");
    }

    const bb = new Browserbase({
      apiKey: process.env.BROWSERBASE_API_KEY!,
    });

    console.log(`☁️ Initializing BROWSERBASE session with Stagehand...`);
    console.log(`🔑 Using context: ${savedSessionInfo.contextId}`);

    // Start a new Browserbase session with the saved login state
    const session = await bb.sessions.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      browserSettings: {
        blockAds: true,
        viewport: {
          width: 1288,
          height: 711,
        },
        context: { id: savedSessionInfo.contextId, persist: false },
      },
    });

    console.log(
      `🔗 Live session (optional view): https://browserbase.com/sessions/${session.id}`
    );

    // Initialize Stagehand using the existing session
    const stagehand = new Stagehand({
      env: "BROWSERBASE",
      browserbaseSessionID: session.id,
      model: options?.model || "google/gemini-3-flash-preview",
      verbose: options?.verbose ? 1 : 0,
    });

    await stagehand.init();

    const page = stagehand.context.pages()[0];

    // Connect Playwright to the same browser session for file uploads
    const playwrightBrowser = await chromium.connectOverCDP(session.connectUrl);
    let playwrightPage: Page;
    if (playwrightBrowser.contexts().length > 0) {
      const context = playwrightBrowser.contexts()[0];
      if (context.pages().length > 0) {
        playwrightPage = context.pages()[0];
      } else {
        playwrightPage = await context.newPage();
      }
    } else {
      const context = await playwrightBrowser.newContext();
      playwrightPage = await context.newPage();
    }

    const sessionInfo: SessionInfo = {
      mode: "BROWSERBASE",
      contextId: savedSessionInfo.contextId,
      sessionId: session.id,
      connectUrl: session.connectUrl,
    };

    this.saveSessionInfo(sessionInfo);

    return {
      stagehand,
      page,
      playwrightPage,
      playwrightBrowser,
      sessionInfo,
    };
  }

  /**
   * Cleanup and release resources
   */
  async cleanup(session: StagehandSession): Promise<void> {
    if (session.playwrightBrowser) {
      await session.playwrightBrowser.close();
    }

    if (session.browser) {
      await session.browser.close();
    }

    await session.stagehand.close();

    // Release Browserbase session if applicable
    if (session.sessionInfo.mode === "BROWSERBASE" && session.sessionInfo.sessionId) {
      const bb = new Browserbase({
        apiKey: process.env.BROWSERBASE_API_KEY!,
      });

      await bb.sessions.update(session.sessionInfo.sessionId, {
        projectId: process.env.BROWSERBASE_PROJECT_ID!,
        status: "REQUEST_RELEASE",
      });
    }
  }
}

