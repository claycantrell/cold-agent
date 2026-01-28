import type { Page, BrowserContext } from 'playwright';
import type { StepErrors } from '../types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface EvidenceCollector {
  consoleMessages: string[];
  networkErrors: string[];
  pageExceptions: string[];

  startCapture(page: Page): void;
  stopCapture(page: Page): void;
  takeScreenshot(page: Page, stepIndex: number): Promise<string>;
  getStepErrors(): StepErrors;
  clearStepErrors(): void;
}

export function createEvidenceCollector(artifactsDir: string): EvidenceCollector {
  const screenshotsDir = path.join(artifactsDir, 'screens');

  const consoleMessages: string[] = [];
  const networkErrors: string[] = [];
  const pageExceptions: string[] = [];

  // Step-level error buffers (cleared after each step)
  let stepConsoleErrors: string[] = [];
  let stepNetworkErrors: string[] = [];
  let stepException: string | null = null;

  let consoleHandler: ((msg: any) => void) | null = null;
  let errorHandler: ((error: Error) => void) | null = null;
  let responseHandler: ((response: any) => void) | null = null;

  return {
    consoleMessages,
    networkErrors,
    pageExceptions,

    startCapture(page: Page): void {
      // Console messages
      consoleHandler = (msg) => {
        const type = msg.type();
        const text = msg.text();

        if (type === 'error' || type === 'warning') {
          const entry = `[${type}] ${text}`;
          consoleMessages.push(entry);
          stepConsoleErrors.push(entry);
        }
      };
      page.on('console', consoleHandler);

      // Page errors (exceptions)
      errorHandler = (error: Error) => {
        const entry = `${error.name}: ${error.message}`;
        pageExceptions.push(entry);
        stepException = entry;
      };
      page.on('pageerror', errorHandler);

      // Network errors (4xx/5xx responses for same-origin)
      responseHandler = async (response) => {
        try {
          const status = response.status();
          const url = response.url();

          // Only track errors (4xx, 5xx)
          if (status >= 400) {
            // Check if same origin
            const pageUrl = page.url();
            const pageOrigin = new URL(pageUrl).origin;
            const responseOrigin = new URL(url).origin;

            if (pageOrigin === responseOrigin) {
              const entry = `${status} ${response.request().method()} ${url}`;
              networkErrors.push(entry);
              stepNetworkErrors.push(entry);
            }
          }
        } catch {
          // Ignore parsing errors
        }
      };
      page.on('response', responseHandler);
    },

    stopCapture(page: Page): void {
      if (consoleHandler) {
        page.off('console', consoleHandler);
        consoleHandler = null;
      }
      if (errorHandler) {
        page.off('pageerror', errorHandler);
        errorHandler = null;
      }
      if (responseHandler) {
        page.off('response', responseHandler);
        responseHandler = null;
      }
    },

    async takeScreenshot(page: Page, stepIndex: number): Promise<string> {
      await fs.mkdir(screenshotsDir, { recursive: true });

      const filename = `step${stepIndex.toString().padStart(3, '0')}.png`;
      const filepath = path.join(screenshotsDir, filename);

      await page.screenshot({
        path: filepath,
        fullPage: false, // viewport only for consistent sizing
      });

      return `screens/${filename}`;
    },

    getStepErrors(): StepErrors {
      return {
        console: [...stepConsoleErrors],
        network: [...stepNetworkErrors],
        exception: stepException,
      };
    },

    clearStepErrors(): void {
      stepConsoleErrors = [];
      stepNetworkErrors = [];
      stepException = null;
    },
  };
}

export async function startTrace(context: BrowserContext, artifactsDir: string): Promise<void> {
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: false, // Don't include source code
  });
}

export async function stopTrace(context: BrowserContext, artifactsDir: string): Promise<string> {
  const tracePath = path.join(artifactsDir, 'trace.zip');
  await context.tracing.stop({ path: tracePath });
  return 'trace.zip';
}

export async function saveStepsLog(steps: any[], artifactsDir: string): Promise<void> {
  const stepsPath = path.join(artifactsDir, 'steps.json');
  await fs.writeFile(stepsPath, JSON.stringify(steps, null, 2));
}

export async function appendStepLog(step: any, artifactsDir: string): Promise<void> {
  const stepsPath = path.join(artifactsDir, 'steps.json');

  let steps: any[] = [];
  try {
    const existing = await fs.readFile(stepsPath, 'utf-8');
    steps = JSON.parse(existing);
  } catch {
    // File doesn't exist yet, start fresh
  }

  steps.push(step);
  await fs.writeFile(stepsPath, JSON.stringify(steps, null, 2));
}
