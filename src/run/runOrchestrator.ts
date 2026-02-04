import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { RunCreateRequest, RunReport, RunState, StepLog } from '../types.js';
import { createEvidenceCollector, startTrace, stopTrace, saveStepsLog } from './evidence.js';
import { runAgentLoop } from './agentLoop.js';
import { evaluateRun } from './evaluator.js';

const RUNS_DIR = 'runs';
const MAX_CONCURRENT_RUNS = Math.max(1, Number(process.env.MAX_CONCURRENT_RUNS || 2));

export interface RunOrchestrator {
  startRun(request: RunCreateRequest): Promise<string>;
  getRunReport(runId: string): Promise<RunReport | null>;
  getAllRuns(): Promise<RunReport[]>;
}

// In-memory store for active runs
const activeRuns = new Map<string, RunState>();
const pendingQueue: RunState[] = [];
let runningCount = 0;

export function createRunOrchestrator(): RunOrchestrator {
  return {
    async startRun(request: RunCreateRequest): Promise<string> {
      const runId = generateRunId();
      const artifactsDir = path.join(RUNS_DIR, runId, 'artifacts');

      // Create artifacts directory
      await fs.mkdir(artifactsDir, { recursive: true });

      // Initialize run state
      const runState: RunState = {
        runId,
        config: request,
        status: 'pending',
        startedAt: new Date(),
        steps: [],
        ladderState: {
          phase: 0,
          stepsWithoutProgress: 0,
          searchTermsUsed: [],
          helpOpened: false,
        },
        visitedPages: new Map(),
        artifactsDir,
      };

      activeRuns.set(runId, runState);

      // Enqueue run asynchronously (global concurrency limit)
      enqueueRun(runState);

      return runId;
    },

    async getRunReport(runId: string): Promise<RunReport | null> {
      // Check active runs first
      const activeRun = activeRuns.get(runId);
      if (activeRun?.report) {
        return activeRun.report;
      }

      // Check if run is still in progress
      if (activeRun && activeRun.status === 'running') {
        return {
          runId,
          status: 'running',
          goal: activeRun.config.goal,
          baseUrl: activeRun.config.baseUrl,
          startedAt: activeRun.startedAt.toISOString(),
          findings: [],
          artifacts: {
            stepsJson: 'artifacts/steps.json',
            screenshotsDir: 'artifacts/screens/',
          },
        };
      }

      // Try to load from disk
      try {
        const reportPath = path.join(RUNS_DIR, runId, 'report.json');
        const reportData = await fs.readFile(reportPath, 'utf-8');
        return JSON.parse(reportData);
      } catch {
        return null;
      }
    },

    async getAllRuns(): Promise<RunReport[]> {
      const reports: RunReport[] = [];

      try {
        const runDirs = await fs.readdir(RUNS_DIR);
        for (const dir of runDirs) {
          try {
            const reportPath = path.join(RUNS_DIR, dir, 'report.json');
            const reportData = await fs.readFile(reportPath, 'utf-8');
            reports.push(JSON.parse(reportData));
          } catch {
            // Skip directories without reports
          }
        }
      } catch {
        // Runs directory doesn't exist yet
      }

      return reports.sort((a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
    },
  };
}

function enqueueRun(runState: RunState): void {
  pendingQueue.push(runState);
  void processQueue();
}

async function processQueue(): Promise<void> {
  while (runningCount < MAX_CONCURRENT_RUNS && pendingQueue.length > 0) {
    const next = pendingQueue.shift()!;
    runningCount++;
    executeRun(next)
      .catch((error) => {
        console.error(`Run ${next.runId} failed:`, error);
        next.status = 'fail';
        next.endedAt = new Date();
        next.report = {
          runId: next.runId,
          status: 'fail',
          goal: next.config.goal,
          baseUrl: next.config.baseUrl,
          startedAt: next.startedAt.toISOString(),
          endedAt: new Date().toISOString(),
          findings: [],
          artifacts: {
            stepsJson: 'artifacts/steps.json',
            screenshotsDir: 'artifacts/screens/',
          },
          error: error instanceof Error ? error.message : String(error),
        };
      })
      .finally(() => {
        runningCount--;
        void processQueue();
      });
  }
}

async function executeRun(runState: RunState): Promise<void> {
  const { config, runId, artifactsDir } = runState;
  const options = config.options;

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    runState.status = 'running';

    // Launch browser
    browser = await chromium.launch({
      headless: options.headless,
    });

    // Create context with video recording if enabled
    const contextOptions: any = {
      viewport: options.viewport,
    };

    if (options.recordVideo) {
      contextOptions.recordVideo = {
        dir: path.join(artifactsDir, 'videos'),
        size: options.viewport,
      };
    }

    context = await browser.newContext(contextOptions);

    // Start tracing if enabled
    if (options.recordTrace) {
      await startTrace(context, artifactsDir);
    }

    // Create page
    page = await context.newPage();

    // Set up network allowlist if provided
    if (options.networkAllowlist?.length) {
      await page.route('**/*', (route) => {
        const url = route.request().url();
        try {
          const hostname = new URL(url).hostname;
          const isAllowed = options.networkAllowlist!.some(
            allowed => hostname === allowed || hostname.endsWith(`.${allowed}`)
          );
          if (isAllowed) {
            route.continue();
          } else {
            route.abort('blockedbyclient');
          }
        } catch {
          route.continue();
        }
      });
    }

    // Set up evidence collector
    const evidence = createEvidenceCollector(artifactsDir);
    evidence.startCapture(page);

    // Handle authentication if provided
    if (config.auth) {
      await handleAuthentication(page, config.auth);
    } else {
      // Navigate to base URL - use 'load' instead of 'networkidle' to avoid timeouts on sites with continuous network activity
      await page.goto(config.baseUrl, { waitUntil: 'load', timeout: 30000 });
      // Give the page a moment to settle
      await page.waitForTimeout(2000);
    }

    // Run agent loop
    const result = await runAgentLoop(page, evidence, {
      goal: config.goal,
      maxSteps: config.budgets.maxSteps,
      maxMinutes: config.budgets.maxMinutes,
      successHints: options.successHints,
      artifactsDir,
      onStep: (step) => {
        runState.steps.push(step);
      },
    });

    // Stop evidence capture
    evidence.stopCapture(page);

    // Stop tracing
    let traceZip: string | undefined;
    if (options.recordTrace && context) {
      traceZip = await stopTrace(context, artifactsDir);
    }

    // Get video path
    let videoPath: string | undefined;
    if (options.recordVideo && page) {
      const video = page.video();
      if (video) {
        const originalPath = await video.path();
        const videoFilename = 'video.webm';
        const destPath = path.join(artifactsDir, videoFilename);
        await fs.rename(originalPath, destPath);
        videoPath = videoFilename;
      }
    }

    // Save final steps log
    await saveStepsLog(result.steps, artifactsDir);

    // Evaluate run and generate report
    const report = evaluateRun(runId, config, result, {
      traceZip,
      video: videoPath,
    });

    // Save report
    const reportPath = path.join(RUNS_DIR, runId, 'report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    runState.status = report.status;
    runState.endedAt = new Date();
    runState.report = report;

  } finally {
    // Cleanup
    if (page) {
      await page.close().catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function handleAuthentication(
  page: Page,
  auth: NonNullable<RunCreateRequest['auth']>
): Promise<void> {
  if (auth.type !== 'password') {
    throw new Error(`Unsupported auth type: ${auth.type}`);
  }

  // Navigate to login page
  await page.goto(auth.loginUrl, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Try common login form patterns
  const usernameSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[id="email"]',
    'input[id="username"]',
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
  ];

  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[id="password"]',
    'input[autocomplete="current-password"]',
  ];

  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Log in")',
    'button:has-text("Login")',
    'button:has-text("Sign in")',
    'button:has-text("Submit")',
  ];

  // Find and fill username
  let usernameFilled = false;
  for (const selector of usernameSelectors) {
    const input = page.locator(selector).first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill(auth.username);
      usernameFilled = true;
      break;
    }
  }

  if (!usernameFilled) {
    throw new Error('Could not find username/email input field');
  }

  // Find and fill password
  let passwordFilled = false;
  for (const selector of passwordSelectors) {
    const input = page.locator(selector).first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill(auth.password);
      passwordFilled = true;
      break;
    }
  }

  if (!passwordFilled) {
    throw new Error('Could not find password input field');
  }

  // Find and click submit
  let submitted = false;
  for (const selector of submitSelectors) {
    const button = page.locator(selector).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      submitted = true;
      break;
    }
  }

  if (!submitted) {
    // Try pressing Enter as fallback
    await page.keyboard.press('Enter');
  }

  // Wait for navigation after login
  await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

function generateRunId(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const uuid = uuidv4().slice(0, 8);
  return `${dateStr}_${uuid}`;
}
