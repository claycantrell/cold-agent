# Cold Agent

A "cold start" web agent runner that explores web applications like a human user with no prior knowledge, attempting to complete goals and producing evidence-rich reports.

## Features

- **Cold start navigation**: Agent explores using only what's visible on screen (a11y snapshots)
- **Goal-driven exploration**: Provide a goal and optional success hints
- **Evidence capture**: Screenshots, video recordings, Playwright traces
- **Help ladder escalation**: Automatic fallback to search and help when stuck
- **UX findings**: Automatic detection of discoverability issues, bugs, and navigation problems
- **Destructive action protection**: Blocks delete/remove actions unless explicitly in goal

## How It Works

Cold Agent uses **Claude Code CLI** for AI-powered decision making, which means it uses your Claude Pro/Max subscription credits - no separate API key needed. The agent:

1. Captures a compact accessibility (a11y) snapshot of the current page
2. Sends the snapshot to Claude via CLI with the goal and history context
3. Claude decides the next action (click, fill, search, etc.)
4. Playwright executes the action and captures evidence
5. Repeats until the goal is achieved or budget is exhausted

## Quick Start

### Prerequisites

- Node.js 20+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated with your Claude Pro/Max subscription

### Installation

```bash
npm install
```

This will also install Chromium for Playwright.

### Running the Server

```bash
# Development mode with hot reload
npm run dev

# Or build and run
npm run build
npm start
```

The server starts on `http://localhost:3000` by default.

## API Usage

### Start a Run

```bash
curl -X POST http://localhost:3000/runs \
  -H "Content-Type: application/json" \
  -d '{
    "baseUrl": "https://example.com",
    "goal": "Find the contact page and locate the email address"
  }'
```

Response:
```json
{
  "runId": "20260127_abc12345",
  "status": "pending",
  "message": "Run started",
  "links": {
    "status": "/runs/20260127_abc12345",
    "artifacts": "/runs/20260127_abc12345/artifacts/"
  }
}
```

### Full Configuration Example

```bash
curl -X POST http://localhost:3000/runs \
  -H "Content-Type: application/json" \
  -d '{
    "baseUrl": "https://yourapp.example",
    "goal": "Set up a waste stream and log a waste entry for that stream",
    "auth": {
      "type": "password",
      "loginUrl": "https://yourapp.example/login",
      "username": "test@example.com",
      "password": "secret"
    },
    "budgets": {
      "maxSteps": 40,
      "maxMinutes": 6
    },
    "options": {
      "headless": true,
      "viewport": { "width": 1280, "height": 800 },
      "recordVideo": true,
      "recordTrace": true,
      "networkAllowlist": ["yourapp.example", "cdn.yourapp.example"],
      "successHints": {
        "mustSeeText": ["Waste Stream", "Entry saved"],
        "mustEndOnUrlIncludes": ["/waste", "/streams"]
      }
    }
  }'
```

### Get Run Status/Report

```bash
curl http://localhost:3000/runs/20260127_abc12345
```

### List All Runs

```bash
curl http://localhost:3000/runs
```

## Run Report Structure

```json
{
  "runId": "20260127_abc12345",
  "status": "success",
  "goal": "Find the contact page",
  "baseUrl": "https://example.com",
  "startedAt": "2026-01-27T10:00:00.000Z",
  "endedAt": "2026-01-27T10:02:30.000Z",
  "summary": {
    "outcome": "success",
    "reason": "Found contact page with email",
    "completionEvidence": ["step:5", "step:8"]
  },
  "metrics": {
    "steps": 8,
    "pageTransitions": 3,
    "backtracks": 1,
    "searchUsed": false,
    "stuckEvents": 0,
    "consoleErrors": 0,
    "failedRequests": 0,
    "durationMs": 150000
  },
  "findings": [
    {
      "type": "discoverability",
      "severity": "med",
      "title": "Contact link not prominent",
      "details": "Agent had to scroll to find contact link in footer",
      "evidence": { "step": 4, "screenshot": "screens/step004.png" }
    }
  ],
  "artifacts": {
    "traceZip": "artifacts/trace.zip",
    "video": "artifacts/video.webm",
    "stepsJson": "artifacts/steps.json",
    "screenshotsDir": "artifacts/screens/"
  }
}
```

## Architecture

```
src/
├── server.ts              # Express API server
├── types.ts               # TypeScript interfaces and schemas
└── run/
    ├── runOrchestrator.ts # Manages Playwright sessions and runs
    ├── agentLoop.ts       # Core decision-action loop
    ├── snapshot.ts        # Builds compact a11y snapshots
    ├── evidence.ts        # Captures screenshots, video, traces
    └── evaluator.ts       # Post-run analysis and findings
```

## Agent Behavior

### Action Set

The agent can only perform these actions:
- `click(target)` - Click buttons/links
- `fill(target, value)` - Fill text fields
- `select(target, option)` - Select dropdown options
- `scroll(direction)` - Scroll up/down
- `back()` - Go to previous page
- `wait(ms)` - Wait briefly
- `search(query)` - Use in-app search
- `openHelp()` - Open help documentation
- `done(reason, evidenceSteps)` - Declare goal complete

### Help Ladder

When the agent gets stuck:
- **Phase 0** (steps 0-5): Normal exploration
- **Phase 1** (steps 6-9): Try search with goal-related terms
- **Phase 2** (steps 10-13): Open help if available
- **Step 14+**: Stop with "discoverability block" failure

### Progress Detection

Progress is marked as:
- **Major**: URL path changed, new page title/heading appeared
- **Some**: Modal opened/closed, form validation appeared
- **None**: Same page with no meaningful changes

## Findings Types

| Type | Description |
|------|-------------|
| `discoverability` | Feature was hard to find |
| `copy` | Confusing or unclear labels |
| `validation` | Form validation issues |
| `bug` | Console errors or failed requests |
| `performance` | Slow page loads |

## Safety Features

- **Destructive action blocklist**: Won't click "delete", "remove", etc. unless goal explicitly requires it
- **Rate limiting**: 300-700ms delay between actions
- **Network allowlist**: Can restrict navigation to approved domains

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |

## Technical Notes

### Claude CLI Integration

The agent uses Claude Code CLI (`claude` command) with prompts piped via stdin. Prompts are phrased as "analysis questions" (e.g., "I'm testing a web application and need to decide the next UI action") rather than role-playing directives to work smoothly with Claude Code's prompt handling.

### Response Format Handling

Claude may return actions in various formats. The parser handles:
- Flat format: `{"action": {"type": "click", "target": "btn_1"}}`
- Nested format: `{"action": {"click": {"target": "btn_1"}}}`
- Shorthand format: `{"action": {"click": "btn_1"}}`
- Property aliases: `name` for `type`, `text` for `value`, etc.

## Development

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Type check
npm run build
```

## License

MIT
