import type { RunReport, StepLog } from '../types.js';

type RenderFormat = 'html' | 'github-issue-markdown';

export function renderRunReportHtml(args: {
  baseUrl: string; // e.g. http://localhost:3000
  report: RunReport;
  steps: StepLog[];
  format?: RenderFormat;
}): string {
  const format: RenderFormat = args.format ?? 'html';

  if (format === 'github-issue-markdown') {
    return renderGitHubIssueMarkdown(args.baseUrl, args.report, args.steps);
  }

  return renderHtml(args.baseUrl, args.report, args.steps);
}

function renderGitHubIssueMarkdown(baseUrl: string, report: RunReport, steps: StepLog[]): string {
  const runId = report.runId;
  const reportUrl = `${baseUrl}/runs/${encodeURIComponent(runId)}/report`;
  const stepsUrl = `${baseUrl}/runs/${encodeURIComponent(runId)}/artifacts/steps.json`;
  const traceUrl = report.artifacts.traceZip ? `${baseUrl}/runs/${encodeURIComponent(runId)}/artifacts/trace.zip` : null;
  const videoUrl = report.artifacts.video ? `${baseUrl}/runs/${encodeURIComponent(runId)}/artifacts/video.webm` : null;

  const lines: string[] = [];
  lines.push(`## Cold Agent report`);
  lines.push('');
  lines.push(`- **Run**: \`${runId}\``);
  lines.push(`- **Status**: **${report.status}**`);
  lines.push(`- **Goal**: ${report.goal}`);
  lines.push(`- **Base URL**: ${report.baseUrl}`);
  if (report.summary?.reason) lines.push(`- **Reason**: ${report.summary.reason}`);
  lines.push('');
  lines.push(`### Evidence`);
  lines.push(`- **HTML report**: ${reportUrl}`);
  lines.push(`- **Steps JSON**: ${stepsUrl}`);
  if (traceUrl) lines.push(`- **Trace**: ${traceUrl}`);
  if (videoUrl) lines.push(`- **Video**: ${videoUrl}`);
  lines.push('');

  if (report.findings?.length) {
    lines.push('### Findings (auto-generated)');
    for (const f of report.findings) {
      const screenshot = `${baseUrl}/runs/${encodeURIComponent(runId)}/artifacts/${f.evidence.screenshot}`;
      lines.push(`- **[${f.severity}] ${f.title}** (${f.type})`);
      lines.push(`  - ${f.details}`);
      lines.push(`  - Evidence: step ${f.evidence.step} screenshot ${screenshot}`);
    }
    lines.push('');
  }

  lines.push('### Repro (run Cold Agent)');
  lines.push('```bash');
  lines.push(`curl -X POST ${baseUrl}/runs \\`);
  lines.push('  -H "Content-Type: application/json" \\');
  lines.push(`  -d '${JSON.stringify({ baseUrl: report.baseUrl, goal: report.goal })}'`);
  lines.push('```');
  lines.push('');

  if (steps.length) {
    lines.push('### Steps');
    lines.push('');
    for (const step of steps) {
      const shot = `${baseUrl}/runs/${encodeURIComponent(runId)}/artifacts/${step.evidence.screenshot}`;
      lines.push(`- **Step ${step.i}**: \`${formatAction(step.action)}\` → \`${step.url}\` (progress: ${step.result.progress})`);
      if (step.result.notes) lines.push(`  - Notes: ${step.result.notes}`);
      lines.push(`  - Screenshot: ${shot}`);
      if (step.errors.console?.length) lines.push(`  - Console: ${step.errors.console.slice(0, 3).join(' | ')}${step.errors.console.length > 3 ? ' | …' : ''}`);
      if (step.errors.network?.length) lines.push(`  - Network: ${step.errors.network.slice(0, 3).join(' | ')}${step.errors.network.length > 3 ? ' | …' : ''}`);
      if (step.errors.exception) lines.push(`  - Exception: ${step.errors.exception}`);
    }
  } else {
    lines.push('### Steps');
    lines.push('');
    lines.push('_No steps captured yet (run may still be pending/running)._');
  }

  return lines.join('\n');
}

function renderHtml(baseUrl: string, report: RunReport, steps: StepLog[]): string {
  const runId = report.runId;
  const artifactsBase = `${baseUrl}/runs/${encodeURIComponent(runId)}/artifacts`;
  const reportPageUrl = `${baseUrl}/runs/${encodeURIComponent(runId)}/report`;
  const statusClass = report.status === 'success'
    ? 'success'
    : report.status === 'fail'
      ? 'fail'
      : report.status === 'partial'
        ? 'partial'
        : 'neutral';

  const esc = escapeHtml;

  const findingsHtml = (report.findings ?? []).map(f => {
    const screenshotUrl = `${artifactsBase}/${f.evidence.screenshot}`;
    const stepAnchor = `#step-${encodeURIComponent(String(f.evidence.step))}`;
    return `
      <div class="card">
        <div class="row">
          <span class="badge ${esc(f.severity)}">${esc(f.severity)}</span>
          <span class="muted">${esc(f.type)}</span>
        </div>
        <div class="title">${esc(f.title)}</div>
        <div class="muted">${esc(f.details)}</div>
        <div class="row">
          <a href="${screenshotUrl}" target="_blank" rel="noreferrer">screenshot</a>
          <a href="${stepAnchor}">jump to step ${esc(String(f.evidence.step))}</a>
        </div>
      </div>
    `;
  }).join('');

  const metrics = report.metrics;
  const metricsHtml = metrics ? `
    <div class="grid">
      ${metric('steps', metrics.steps)}
      ${metric('pageTransitions', metrics.pageTransitions)}
      ${metric('backtracks', metrics.backtracks)}
      ${metric('stuckEvents', metrics.stuckEvents)}
      ${metric('searchUsed', metrics.searchUsed)}
      ${metric('consoleErrors', metrics.consoleErrors)}
      ${metric('failedRequests', metrics.failedRequests)}
      ${metric('durationMs', metrics.durationMs)}
    </div>
  ` : `<div class="muted">No metrics yet.</div>`;

  const videoTag = report.artifacts.video
    ? `<video controls preload="metadata" src="${artifactsBase}/video.webm" style="width:100%; max-width: 900px; border-radius: 12px; border: 1px solid #222;"></video>`
    : `<div class="muted">No video artifact.</div>`;

  const traceLink = report.artifacts.traceZip
    ? `<a class="btn" href="${artifactsBase}/trace.zip">Download trace.zip</a>`
    : '';

  const stepsJsonLink = `<a class="btn" href="${artifactsBase}/steps.json">Download steps.json</a>`;

  const stepsHtml = steps.map(step => {
    const screenshotUrl = `${artifactsBase}/${step.evidence.screenshot}`;
    const actionText = formatAction(step.action);
    const progressClass = step.result.progress === 'major' ? 'p-major' : step.result.progress === 'some' ? 'p-some' : 'p-none';
    const consoleErr = step.errors.console?.length ? `<div class="err"><b>Console</b>: ${esc(step.errors.console.slice(0, 3).join(' | '))}${step.errors.console.length > 3 ? ' | …' : ''}</div>` : '';
    const netErr = step.errors.network?.length ? `<div class="err"><b>Network</b>: ${esc(step.errors.network.slice(0, 3).join(' | '))}${step.errors.network.length > 3 ? ' | …' : ''}</div>` : '';
    const excErr = step.errors.exception ? `<div class="err"><b>Exception</b>: ${esc(step.errors.exception)}</div>` : '';
    const stepId = `step-${String(step.i)}`;
    const stepPermalink = `${reportPageUrl}#${stepId}`;

    return `
      <div class="step" id="${esc(stepId)}">
        <div class="stepHeader">
          <div class="stepTitle">Step ${esc(String(step.i))}: <code>${esc(actionText)}</code></div>
          <span class="badge ${progressClass}">${esc(step.result.progress)}</span>
        </div>
        <div class="muted"><a href="${esc(step.url)}" target="_blank" rel="noreferrer">${esc(step.url)}</a></div>
        <div class="muted">${esc(step.result.notes)}</div>
        <div class="row" style="margin-top: 6px;">
          <a href="#${esc(stepId)}">permalink</a>
          <button class="btn btnSmall" type="button" onclick="copyText('${esc(stepPermalink)}')">copy link</button>
        </div>
        ${consoleErr}${netErr}${excErr}
        <div class="row">
          <a href="${screenshotUrl}" target="_blank" rel="noreferrer">Open screenshot</a>
          <img class="thumb" src="${screenshotUrl}" alt="Step ${esc(String(step.i))} screenshot" loading="lazy" />
        </div>
      </div>
    `;
  }).join('');

  const issueHelp = `
    <div class="card">
      <div class="title">Create a GitHub issue</div>
      <div class="muted">Requires server env: <code>GITHUB_REPO</code> and <code>GITHUB_TOKEN</code>.</div>
      <div class="row" style="margin-top: 10px;">
        <label class="muted" for="issueTitle">Title</label>
        <input id="issueTitle" class="input" style="min-width: 320px;" value="${esc(`[cold-agent] ${report.status.toUpperCase()}: ${report.goal}`)}" />
      </div>
      <div class="row" style="margin-top: 10px;">
        <label class="muted" for="issueLabels">Labels (comma-separated)</label>
        <input id="issueLabels" class="input" style="min-width: 320px;" value="ux, bug" />
      </div>
      <div class="row" style="margin-top: 10px;">
        <button id="createIssueBtn" class="btn" type="button" onclick="createGitHubIssue()">Create issue</button>
        <span id="issueStatus" class="muted"></span>
      </div>
    </div>
  `;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cold Agent Report ${esc(runId)}</title>
    <style>
      :root {
        --bg: #0b0c10;
        --panel: #11131a;
        --text: #e8eaf0;
        --muted: #a6adc8;
        --border: #222632;
        --success: #2ecc71;
        --fail: #e74c3c;
        --partial: #f39c12;
      }
      body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
      a { color: #9bd3ff; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .container { max-width: 1100px; margin: 0 auto; padding: 24px; }
      .header { display: flex; gap: 16px; align-items: baseline; justify-content: space-between; flex-wrap: wrap; }
      .hgroup { display: flex; flex-direction: column; gap: 6px; }
      .title { font-weight: 700; font-size: 20px; }
      .muted { color: var(--muted); }
      .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
      .badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--border); background: #0f1118; font-size: 12px; }
      .badge.success { border-color: rgba(46,204,113,.35); color: var(--success); }
      .badge.fail { border-color: rgba(231,76,60,.35); color: var(--fail); }
      .badge.partial { border-color: rgba(243,156,18,.35); color: var(--partial); }
      .badge.neutral { border-color: var(--border); color: var(--muted); }
      .badge.high { border-color: rgba(231,76,60,.35); color: var(--fail); }
      .badge.med { border-color: rgba(243,156,18,.35); color: var(--partial); }
      .badge.low { border-color: rgba(155,211,255,.35); color: #9bd3ff; }
      .badge.p-major { border-color: rgba(46,204,113,.35); color: var(--success); }
      .badge.p-some { border-color: rgba(243,156,18,.35); color: var(--partial); }
      .badge.p-none { border-color: rgba(166,173,200,.25); color: var(--muted); }
      .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 16px; }
      .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
      @media (max-width: 900px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      .metric { background: #0f1118; border: 1px solid var(--border); border-radius: 12px; padding: 10px; }
      .metric .k { color: var(--muted); font-size: 12px; }
      .metric .v { font-weight: 700; font-size: 16px; margin-top: 4px; }
      .card { background: #0f1118; border: 1px solid var(--border); border-radius: 12px; padding: 12px; }
      .section { margin-top: 18px; }
      .btn { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 12px; border: 1px solid var(--border); background: #0f1118; color: var(--text); }
      .btn:hover { background: #131622; text-decoration: none; }
      .btnSmall { padding: 6px 10px; border-radius: 10px; font-size: 12px; cursor: pointer; }
      .input { background: #0f1118; border: 1px solid var(--border); color: var(--text); border-radius: 10px; padding: 8px 10px; }
      .steps { display: flex; flex-direction: column; gap: 12px; }
      .step { background: #0f1118; border: 1px solid var(--border); border-radius: 12px; padding: 12px; }
      .stepHeader { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
      .thumb { width: 220px; max-width: 100%; border-radius: 10px; border: 1px solid var(--border); margin-left: 8px; }
      .err { margin-top: 6px; color: #ffb4ab; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="hgroup">
          <div class="title">Cold Agent Report</div>
          <div class="muted">Run <code>${esc(runId)}</code></div>
        </div>
        <span class="badge ${esc(statusClass)}">${esc(report.status)}</span>
      </div>

      <div class="panel section">
        <div class="row">
          <span class="muted">Goal:</span> <span>${esc(report.goal)}</span>
        </div>
        <div class="row">
          <span class="muted">Base URL:</span> <a href="${esc(report.baseUrl)}" target="_blank" rel="noreferrer">${esc(report.baseUrl)}</a>
        </div>
        <div class="row">
          <span class="muted">Reason:</span> <span>${esc(report.summary?.reason ?? '(none)')}</span>
        </div>
        <div class="row" style="margin-top: 10px;">
          ${stepsJsonLink}
          ${traceLink}
          <a class="btn" href="${esc(`${baseUrl}/runs/${encodeURIComponent(runId)}`)}">View report JSON</a>
        </div>
      </div>

      <div class="panel section">
        <div class="title">Video</div>
        <div style="margin-top: 10px;">${videoTag}</div>
      </div>

      <div class="panel section">
        <div class="title">Metrics</div>
        <div style="margin-top: 10px;">${metricsHtml}</div>
      </div>

      <div class="panel section">
        <div class="title">Findings</div>
        <div style="margin-top: 10px; display: grid; grid-template-columns: 1fr; gap: 10px;">
          ${findingsHtml || '<div class="muted">No findings.</div>'}
        </div>
      </div>

      <div class="panel section">
        <div class="title">Steps</div>
        <div class="muted" style="margin-top: 6px;">Each step shows the chosen action, perceived progress, and evidence.</div>
        <div class="steps" style="margin-top: 10px;">
          ${stepsHtml || '<div class="muted">No steps captured yet.</div>'}
        </div>
      </div>

      <div class="section">
        ${issueHelp}
      </div>
    </div>
    <script>
      function setIssueStatus(text) {
        var el = document.getElementById('issueStatus');
        if (el) el.textContent = text || '';
      }

      async function copyText(text) {
        try {
          await navigator.clipboard.writeText(text);
          setIssueStatus('Copied link to clipboard.');
          setTimeout(() => setIssueStatus(''), 2000);
        } catch (e) {
          setIssueStatus('Copy failed (browser blocked clipboard).');
        }
      }

      async function createGitHubIssue() {
        var btn = document.getElementById('createIssueBtn');
        var titleEl = document.getElementById('issueTitle');
        var labelsEl = document.getElementById('issueLabels');

        var title = titleEl && titleEl.value ? titleEl.value : '';
        var labels = labelsEl && labelsEl.value
          ? labelsEl.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
          : undefined;

        if (btn) btn.disabled = true;
        setIssueStatus('Creating issue…');

        try {
          var resp = await fetch('/runs/${esc(runId)}/issues/github', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title, labels: labels })
          });

          var text = await resp.text();
          if (!resp.ok) throw new Error(text);

          var data = JSON.parse(text);
          setIssueStatus('Created: ' + data.url);
          // Make it clickable
          var el = document.getElementById('issueStatus');
          if (el) {
            el.innerHTML = 'Created: <a href="' + data.url + '" target="_blank" rel="noreferrer">' + data.url + '</a>';
          }
        } catch (e) {
          setIssueStatus('Failed to create issue. Check server logs/env vars.');
        } finally {
          if (btn) btn.disabled = false;
        }
      }
    </script>
  </body>
</html>`;
}

function metric(key: string, value: unknown): string {
  return `<div class="metric"><div class="k">${escapeHtml(key)}</div><div class="v">${escapeHtml(String(value))}</div></div>`;
}

function formatAction(action: any): string {
  if (!action || typeof action !== 'object') return 'unknown()';
  switch (action.type) {
    case 'click':
      return `click("${String(action.target ?? '')}")`;
    case 'fill':
      return `fill("${String(action.target ?? '')}", "${String(action.value ?? '')}")`;
    case 'select':
      return `select("${String(action.target ?? '')}", "${String(action.option ?? '')}")`;
    case 'scroll':
      return `scroll(${String(action.direction ?? 'down')})`;
    case 'back':
      return 'back()';
    case 'wait':
      return `wait(${String(action.ms ?? 0)}ms)`;
    case 'search':
      return `search("${String(action.query ?? '<missing query>')}")`;
    case 'openHelp':
      return 'openHelp()';
    case 'done':
      return `done("${String(action.reason ?? 'Task completed')}")`;
    default:
      return `${String(action.type ?? 'unknown')}()`;
  }
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

