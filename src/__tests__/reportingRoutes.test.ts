import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';

// Ensure src/server.ts doesn't auto-listen when imported
process.env.NODE_ENV = 'test';

import app from '../server.js';

const RUN_ID = `20260131_routes_${Math.random().toString(16).slice(2, 8)}`;

async function writeFixtureRun(): Promise<void> {
  const runDir = path.join(process.cwd(), 'runs', RUN_ID);
  const artifactsDir = path.join(runDir, 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.mkdir(path.join(artifactsDir, 'screens'), { recursive: true });

  const report = {
    runId: RUN_ID,
    status: 'fail',
    goal: 'Find the contact email',
    baseUrl: 'https://example.com',
    startedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    endedAt: new Date('2026-01-01T00:01:00.000Z').toISOString(),
    summary: { outcome: 'fail', reason: 'Discoverability block', completionEvidence: [] },
    metrics: {
      steps: 1,
      pageTransitions: 0,
      backtracks: 0,
      searchUsed: false,
      stuckEvents: 0,
      consoleErrors: 0,
      failedRequests: 0,
      durationMs: 1000,
    },
    findings: [
      {
        type: 'discoverability',
        severity: 'high',
        title: 'Could not find contact',
        details: 'Agent got stuck.',
        evidence: { step: 0, screenshot: 'screens/step000.png' },
      },
    ],
    artifacts: {
      traceZip: 'artifacts/trace.zip',
      video: 'artifacts/video.webm',
      stepsJson: 'artifacts/steps.json',
      screenshotsDir: 'artifacts/screens/',
    },
  };

  const steps = [
    {
      i: 0,
      timestamp: new Date('2026-01-01T00:00:10.000Z').toISOString(),
      url: 'https://example.com/',
      pageTitle: 'Home',
      snapshot: {
        type: 'a11y',
        url: 'https://example.com/',
        title: 'Home',
        headings: ['Home'],
        navLinks: ['Contact'],
        interactiveElements: [],
        text: 'Page: Home',
        hasSearchBox: false,
        hasHelpLink: false,
      },
      action: { type: 'click', target: 'Contact' },
      result: { ok: true, notes: 'Executed click', progress: 'none' },
      evidence: { screenshot: 'screens/step000.png' },
      errors: { console: [], network: [], exception: null },
    },
  ];

  await fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(artifactsDir, 'steps.json'), JSON.stringify(steps, null, 2));
}

async function rmFixtureRun(): Promise<void> {
  const runDir = path.join(process.cwd(), 'runs', RUN_ID);
  await fs.rm(runDir, { recursive: true, force: true });
}

describe('reporting routes', () => {
  let server: any;
  let baseUrl = '';

  beforeAll(async () => {
    await writeFixtureRun();

    server = app.listen(0);
    await new Promise<void>((resolve) => server.on('listening', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await rmFixtureRun();
  });

  test('GET /runs/:runId/report returns HTML with step anchors', async () => {
    const resp = await fetch(`${baseUrl}/runs/${RUN_ID}/report`);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain(`Run <code>${RUN_ID}</code>`);
    expect(html).toContain('id="step-0"');
    expect(html).toContain('#step-0');
    expect(html).toContain('Create a GitHub issue');
  });

  test('POST /runs/:runId/issues/github creates issue using mocked GitHub API', async () => {
    process.env.GITHUB_REPO = 'owner/repo';
    process.env.GITHUB_TOKEN = 'test-token';

    const clientFetch = globalThis.fetch;
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ number: 123, html_url: 'https://github.com/owner/repo/issues/123', title: 't' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    });

    // Override global fetch so the server's outbound call to GitHub is mocked.
    (globalThis as any).fetch = mockFetch;

    try {
      // Use the original fetch for the client -> server request so we don't intercept it.
      const resp = await clientFetch(`${baseUrl}/runs/${RUN_ID}/issues/github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test issue', labels: ['ux'] }),
      });
      expect(resp.status).toBe(200);
      const data = await resp.json() as any;
      expect(data.url).toContain('github.com/owner/repo/issues/123');

      // Verify our server attempted to call GitHub API
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0] as any[];
      expect(String(url)).toContain('https://api.github.com/repos/owner/repo/issues');
      expect(opts.method).toBe('POST');
    } finally {
      (globalThis as any).fetch = clientFetch;
    }
  });
});

