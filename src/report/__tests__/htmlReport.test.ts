import { describe, expect, test } from 'vitest';
import { renderRunReportHtml } from '../htmlReport.js';
import type { RunReport, StepLog } from '../../types.js';

function makeReport(runId: string): RunReport {
  return {
    runId,
    status: 'partial',
    goal: 'Find campgrounds near Yosemite',
    baseUrl: 'https://example.com',
    startedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    endedAt: new Date('2026-01-01T00:01:00.000Z').toISOString(),
    summary: {
      outcome: 'partial',
      reason: 'Time budget exhausted (6 minutes)',
      completionEvidence: [],
    },
    findings: [
      {
        type: 'discoverability',
        severity: 'high',
        title: 'Navigation difficulty',
        details: 'Agent got stuck.',
        evidence: { step: 0, screenshot: 'screens/step000.png' },
      },
    ],
    artifacts: {
      stepsJson: 'artifacts/steps.json',
      screenshotsDir: 'artifacts/screens/',
      video: 'artifacts/video.webm',
      traceZip: 'artifacts/trace.zip',
    },
    metrics: {
      steps: 1,
      pageTransitions: 0,
      backtracks: 0,
      searchUsed: true,
      stuckEvents: 0,
      consoleErrors: 0,
      failedRequests: 0,
      durationMs: 1000,
    },
  };
}

function makeSteps(): StepLog[] {
  return [
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
        navLinks: ['Search'],
        interactiveElements: [],
        text: 'Page: Home',
        hasSearchBox: true,
        hasHelpLink: false,
      },
      action: { type: 'search', query: undefined as any },
      result: { ok: true, notes: 'Executed search', progress: 'none' },
      evidence: { screenshot: 'screens/step000.png' },
      errors: { console: [], network: [], exception: null },
    },
  ];
}

describe('renderRunReportHtml', () => {
  test('renders HTML report with step anchors and issue panel', () => {
    const runId = '20260131_testhtml';
    const html = renderRunReportHtml({
      baseUrl: 'http://localhost:3000',
      report: makeReport(runId),
      steps: makeSteps(),
    });

    expect(html).toContain('Cold Agent Report');
    expect(html).toContain(`Run <code>${runId}</code>`);
    expect(html).toContain('id="step-0"');
    expect(html).toContain('#step-0');
    expect(html).toContain('Create a GitHub issue');
    expect(html).toContain('/runs/20260131_testhtml/issues/github');
    // ensure undefined search is shown as missing query in the rendered action string
    expect(html).toContain('search(&quot;&lt;missing query&gt;&quot;)');
  });

  test('renders GitHub issue markdown with evidence and steps', () => {
    const runId = '20260131_testmd';
    const md = renderRunReportHtml({
      baseUrl: 'http://localhost:3000',
      report: makeReport(runId),
      steps: makeSteps(),
      format: 'github-issue-markdown',
    });

    expect(md).toContain('## Cold Agent report');
    expect(md).toContain(`**Run**: \`${runId}\``);
    expect(md).toContain('### Evidence');
    expect(md).toContain(`/runs/${runId}/report`);
    expect(md).toContain(`/runs/${runId}/artifacts/steps.json`);
    expect(md).toContain('### Steps');
    expect(md).toContain('Step 0');
    expect(md).toContain('screens/step000.png');
  });
});

