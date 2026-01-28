import type {
  Finding,
  FindingType,
  RunCreateRequest,
  RunMetrics,
  RunReport,
  RunSummary,
  Severity,
  StepLog,
} from '../types.js';
import type { AgentLoopResult } from './agentLoop.js';
import { getPageKey } from './snapshot.js';

interface ArtifactPaths {
  traceZip?: string;
  video?: string;
}

export function evaluateRun(
  runId: string,
  config: RunCreateRequest,
  result: AgentLoopResult,
  artifacts: ArtifactPaths
): RunReport {
  const { steps, finalStatus, reason, completionEvidence } = result;

  // Calculate metrics
  const metrics = calculateMetrics(steps);

  // Identify findings
  const findings = identifyFindings(steps, metrics);

  // Build summary
  const summary: RunSummary = {
    outcome: finalStatus,
    reason,
    completionEvidence,
  };

  return {
    runId,
    status: finalStatus,
    goal: config.goal,
    baseUrl: config.baseUrl,
    startedAt: steps[0]?.timestamp || new Date().toISOString(),
    endedAt: steps[steps.length - 1]?.timestamp || new Date().toISOString(),
    summary,
    metrics,
    findings,
    artifacts: {
      traceZip: artifacts.traceZip ? `artifacts/${artifacts.traceZip}` : undefined,
      video: artifacts.video ? `artifacts/${artifacts.video}` : undefined,
      stepsJson: 'artifacts/steps.json',
      screenshotsDir: 'artifacts/screens/',
    },
  };
}

function calculateMetrics(steps: StepLog[]): RunMetrics {
  let pageTransitions = 0;
  let backtracks = 0;
  let searchUsed = false;
  let stuckEvents = 0;
  let consoleErrors = 0;
  let failedRequests = 0;

  // Track page visits for backtrack detection
  const pageVisits: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const prevStep = i > 0 ? steps[i - 1] : null;

    // Count page transitions
    if (prevStep && step.url !== prevStep.url) {
      const prevPath = new URL(prevStep.url).pathname;
      const currPath = new URL(step.url).pathname;
      if (prevPath !== currPath) {
        pageTransitions++;
      }
    }

    // Track page key for backtrack detection
    const pageKey = getPageKey(step.snapshot);
    if (pageVisits.includes(pageKey)) {
      backtracks++;
    }
    pageVisits.push(pageKey);

    // Check for search usage
    if (step.action.type === 'search') {
      searchUsed = true;
    }

    // Count errors
    consoleErrors += step.errors.console.length;
    failedRequests += step.errors.network.length;
  }

  // Detect stuck events (same page 3+ times in sequence)
  stuckEvents = detectStuckEvents(steps);

  // Calculate duration
  const startTime = steps[0] ? new Date(steps[0].timestamp).getTime() : Date.now();
  const endTime = steps.length > 0
    ? new Date(steps[steps.length - 1].timestamp).getTime()
    : Date.now();
  const durationMs = endTime - startTime;

  return {
    steps: steps.length,
    pageTransitions,
    backtracks,
    searchUsed,
    stuckEvents,
    consoleErrors,
    failedRequests,
    durationMs,
  };
}

function detectStuckEvents(steps: StepLog[]): number {
  if (steps.length < 3) return 0;

  let stuckCount = 0;
  let consecutiveCount = 1;
  let lastPageKey = '';

  for (const step of steps) {
    const pageKey = getPageKey(step.snapshot);

    if (pageKey === lastPageKey) {
      consecutiveCount++;
      if (consecutiveCount >= 3) {
        stuckCount++;
        consecutiveCount = 0; // Reset to avoid counting same stuck event multiple times
      }
    } else {
      consecutiveCount = 1;
      lastPageKey = pageKey;
    }
  }

  return stuckCount;
}

function identifyFindings(steps: StepLog[], metrics: RunMetrics): Finding[] {
  const findings: Finding[] = [];

  // 1. Discoverability issues - agent struggled to find something
  const stuckWindows = findStuckWindows(steps);
  for (const window of stuckWindows) {
    if (window.length >= 3) {
      const firstStep = window[0];
      findings.push({
        type: 'discoverability',
        severity: window.length >= 6 ? 'high' : 'med',
        title: `Navigation difficulty at ${firstStep.pageTitle}`,
        details: `Agent spent ${window.length} steps on the same page (${firstStep.url}) without meaningful progress. Actions attempted: ${window.map(s => formatActionShort(s)).join(', ')}`,
        evidence: {
          step: firstStep.i,
          screenshot: firstStep.evidence.screenshot,
        },
      });
    }
  }

  // 2. Search pattern issues - repeated searches
  const searchSteps = steps.filter(s => s.action.type === 'search');
  if (searchSteps.length >= 2) {
    const searchTerms = searchSteps.map(s =>
      s.action.type === 'search' ? s.action.query : ''
    );
    findings.push({
      type: 'discoverability',
      severity: 'med',
      title: 'Required search to find feature',
      details: `Agent used search ${searchSteps.length} times with terms: "${searchTerms.join('", "')}"`,
      evidence: {
        step: searchSteps[0].i,
        screenshot: searchSteps[0].evidence.screenshot,
      },
    });
  }

  // 3. Backtracking issues - agent went back and forth
  if (metrics.backtracks >= 3) {
    const backtrackSteps = findBacktrackSteps(steps);
    if (backtrackSteps.length > 0) {
      findings.push({
        type: 'discoverability',
        severity: metrics.backtracks >= 5 ? 'high' : 'med',
        title: 'Excessive navigation backtracking',
        details: `Agent backtracked ${metrics.backtracks} times, suggesting unclear navigation paths.`,
        evidence: {
          step: backtrackSteps[0].i,
          screenshot: backtrackSteps[0].evidence.screenshot,
        },
      });
    }
  }

  // 4. Console errors
  const stepsWithErrors = steps.filter(s => s.errors.console.length > 0);
  if (stepsWithErrors.length > 0) {
    const allErrors = stepsWithErrors.flatMap(s => s.errors.console);
    findings.push({
      type: 'bug',
      severity: metrics.consoleErrors >= 5 ? 'high' : 'med',
      title: `Console errors detected (${metrics.consoleErrors} total)`,
      details: `Errors include: ${allErrors.slice(0, 3).join('; ')}${allErrors.length > 3 ? '...' : ''}`,
      evidence: {
        step: stepsWithErrors[0].i,
        screenshot: stepsWithErrors[0].evidence.screenshot,
      },
    });
  }

  // 5. Network failures
  const stepsWithNetworkErrors = steps.filter(s => s.errors.network.length > 0);
  if (stepsWithNetworkErrors.length > 0) {
    const allNetworkErrors = stepsWithNetworkErrors.flatMap(s => s.errors.network);
    findings.push({
      type: 'bug',
      severity: metrics.failedRequests >= 3 ? 'high' : 'low',
      title: `Failed network requests (${metrics.failedRequests} total)`,
      details: `Failed requests: ${allNetworkErrors.slice(0, 3).join('; ')}${allNetworkErrors.length > 3 ? '...' : ''}`,
      evidence: {
        step: stepsWithNetworkErrors[0].i,
        screenshot: stepsWithNetworkErrors[0].evidence.screenshot,
      },
    });
  }

  // 6. Validation issues - form errors encountered
  const validationSteps = steps.filter(s =>
    s.result.progress === 'some' &&
    s.result.notes.toLowerCase().includes('validation') ||
    s.result.notes.toLowerCase().includes('error')
  );
  if (validationSteps.length > 0) {
    findings.push({
      type: 'validation',
      severity: 'low',
      title: 'Form validation triggered',
      details: `Validation errors were encountered during the flow at ${validationSteps.length} step(s).`,
      evidence: {
        step: validationSteps[0].i,
        screenshot: validationSteps[0].evidence.screenshot,
      },
    });
  }

  // 7. Help ladder escalation
  const helpStep = steps.find(s => s.action.type === 'openHelp');
  if (helpStep) {
    findings.push({
      type: 'discoverability',
      severity: 'med',
      title: 'Agent needed to access help',
      details: 'The agent escalated to using help documentation, suggesting the feature was not easily discoverable.',
      evidence: {
        step: helpStep.i,
        screenshot: helpStep.evidence.screenshot,
      },
    });
  }

  // Sort findings by severity
  const severityOrder = { high: 0, med: 1, low: 2 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // Limit to top 7 findings
  return findings.slice(0, 7);
}

function findStuckWindows(steps: StepLog[]): StepLog[][] {
  const windows: StepLog[][] = [];
  let currentWindow: StepLog[] = [];
  let lastPageKey = '';

  for (const step of steps) {
    const pageKey = getPageKey(step.snapshot);

    if (pageKey === lastPageKey) {
      currentWindow.push(step);
    } else {
      if (currentWindow.length >= 3) {
        windows.push(currentWindow);
      }
      currentWindow = [step];
      lastPageKey = pageKey;
    }
  }

  // Don't forget the last window
  if (currentWindow.length >= 3) {
    windows.push(currentWindow);
  }

  return windows;
}

function findBacktrackSteps(steps: StepLog[]): StepLog[] {
  const backtrackSteps: StepLog[] = [];
  const seenPages = new Set<string>();

  for (const step of steps) {
    const pageKey = getPageKey(step.snapshot);
    if (seenPages.has(pageKey)) {
      backtrackSteps.push(step);
    } else {
      seenPages.add(pageKey);
    }
  }

  return backtrackSteps;
}

function formatActionShort(step: StepLog): string {
  const action = step.action;
  switch (action.type) {
    case 'click':
      return `click`;
    case 'fill':
      return `fill`;
    case 'select':
      return `select`;
    case 'scroll':
      return `scroll`;
    case 'back':
      return `back`;
    case 'wait':
      return `wait`;
    case 'search':
      return `search("${action.query}")`;
    case 'openHelp':
      return `help`;
    case 'done':
      return `done`;
  }
}
