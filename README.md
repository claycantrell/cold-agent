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

Cold Agent uses **Claude Code CLI** for AI-powered decision making, which means it can use your Claude Pro/Max subscription credits via OAuth token - no separate API key needed (though you can use an API key if preferred). The agent:

1. Captures a compact accessibility (a11y) snapshot of the current page
2. Sends the snapshot to Claude via CLI with the goal and history context
3. Claude decides the next action (click, fill, search, etc.)
4. Playwright executes the action and captures evidence
5. Repeats until the goal is achieved or budget is exhausted

## Quick Start

### Prerequisites

- Node.js 20+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed

### One-Time Claude Setup

Cold Agent uses your Claude Pro/Max subscription via OAuth token. **Run this once:**

```bash
# Install Claude CLI if you haven't
npm install -g @anthropic-ai/claude-code

# Run Claude once to create config file
claude
# Complete any first-time setup prompts, then exit with Ctrl+C

# Get a long-lived OAuth token (opens browser for auth)
claude setup-token

# Copy the token it outputs and set it:
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..."
```

Add the export to your `~/.zshrc` or `~/.bashrc` to persist it.

### Installation

```bash
npm install
```

This will also install Chromium for Playwright.

### Running the Server

```bash
# Set the OAuth token (if not in your shell profile)
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..."

# Development mode with hot reload
npm run dev

# Or build and run
npm run build
npm start
```

The server starts on `http://localhost:3000` by default.

### Troubleshooting Auth

If you see "Credit balance is too low":
1. You may have an old `ANTHROPIC_API_KEY` set - unset it: `unset ANTHROPIC_API_KEY`
2. Re-run `claude setup-token` in your terminal
3. Make sure you're logging in with your Pro/Max account

If Claude keeps asking for setup prompts:
1. Run `claude` interactively once to complete setup
2. Make sure `~/.claude.json` exists

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

### Start Multiple Runs (Batch)

If you want to kick off many missions at once:

```bash
curl -X POST http://localhost:3000/runs/batch \
  -H "Content-Type: application/json" \
  -d '{
    "runs": [
      { "baseUrl": "https://example.com", "goal": "Find pricing for teams" },
      { "baseUrl": "https://example.com", "goal": "Locate the security settings page" }
    ]
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

### View Human-Friendly HTML Report

Once a run finishes, you can open an HTML report (summary + findings + step timeline with screenshots/video):

```bash
open http://localhost:3000/runs/20260127_abc12345/report
```

The HTML report includes:
- Deep links like `#step-12` for sharing a specific point in the run
- A **Create GitHub issue** panel (if `GITHUB_REPO`/`GITHUB_TOKEN` are configured)

### List All Runs

```bash
curl http://localhost:3000/runs
```

### Create a GitHub Issue from a Run

Configure:

```bash
export GITHUB_REPO="owner/repo"
export GITHUB_TOKEN="ghp_... (PAT with repo permissions)"
```

Then:

```bash
curl -X POST http://localhost:3000/runs/20260127_abc12345/issues/github \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Signup flow is hard to discover",
    "labels": ["ux", "bug"]
  }'
```

Response:

```json
{ "number": 123, "url": "https://github.com/owner/repo/issues/123", "title": "Signup flow is hard to discover" }
```

## Personas (Generate Missions)

You can describe a persona (who they are + what they want to learn/use) and have the LLM generate multiple specific missions/questions.

### Generate Persona Questions

```bash
curl -X POST http://localhost:3000/personas/questions \
  -H "Content-Type: application/json" \
  -d '{
    "baseUrl": "https://example.com",
    "siteDescription": "Project management SaaS for enterprise teams with Gantt charts, resource allocation, and reporting",
    "count": 6,
    "persona": {
      "name": "IT Admin",
      "description": "A new IT admin responsible for onboarding employees and configuring access.",
      "interests": ["user management", "SSO", "permissions", "audit logs", "billing"]
    }
  }'
```

**Important**: Include `siteDescription` to tell the LLM what your site/product does. Without it, the LLM may guess wrong (especially for domain names similar to other products).

### Generate Persona Questions and Start Batch Runs

This generates questions and starts one agent run per question (runs execute in parallel, limited by `MAX_CONCURRENT_RUNS`):

```bash
curl -X POST http://localhost:3000/personas/runs \
  -H "Content-Type: application/json" \
  -d '{
    "baseUrl": "https://dyrt.co",
    "siteDescription": "AI-powered waste intelligence platform for analyzing invoices and tracking diversion rates",
    "count": 4,
    "persona": {
      "description": "waste facilities manager looking for software solutions",
      "interests": ["waste management software", "compost monitoring", "facility operations"]
    },
    "budgets": { "maxSteps": 25, "maxMinutes": 4 },
    "options": { "headless": true, "recordVideo": true }
  }'
```

Response:

```json
{
  "persona": { "description": "...", "interests": [...] },
  "siteDescription": "...",
  "questions": ["Find pricing info...", "Locate case studies...", "..."],
  "runIds": ["20260204_abc123", "20260204_def456", "..."]
}
```

Each agent's goal is prefixed with persona context so it knows who it's acting as:

```
[Persona: waste facilities manager | Interests: waste management, compost monitoring] Find pricing info...
```

Set `"embedPersona": false` in the request to disable this.

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
| `MAX_CONCURRENT_RUNS` | Max simultaneous Playwright runs (global queue) | 2 |
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token from `claude setup-token` (Pro/Max subscription) | (none) |
| `ANTHROPIC_API_KEY` | Alternative: use API key instead of OAuth (uses API credits) | (none) |
| `USE_TMUX` | Set to `1` to use tmux interactive mode instead of pipe mode | `0` |
| `GITHUB_REPO` | GitHub repo to create issues in (`owner/repo`) | (none) |
| `GITHUB_TOKEN` | GitHub token (PAT) used for issue creation | (none) |

**Claude Mode Priority**:
1. If `ANTHROPIC_API_KEY` is set → uses Anthropic SDK (API credits, fastest)
2. If `CLAUDE_CODE_OAUTH_TOKEN` is set → uses CLI pipe mode (`claude -p`, Pro/Max subscription, **recommended**)
3. If `USE_TMUX=1` → uses tmux interactive mode (slower, useful for debugging)

## Technical Notes

### Claude Integration

Cold Agent supports three modes for calling Claude:

**1. CLI Pipe Mode (Recommended)**

Uses `claude -p` with your Pro/Max subscription via OAuth token. This is the fastest non-API option (~7-8 seconds per step).

```bash
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..."
npm run dev
```

**2. Anthropic SDK**

Uses the Anthropic API directly. Fastest option but uses API credits instead of subscription.

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
npm run dev
```

**3. tmux Interactive Mode (Legacy)**

Runs Claude in a tmux session (like [Gastown](https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04)). Slower (~30-60 seconds per step) but useful for debugging.

```bash
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..."
export USE_TMUX=1
npm run dev

# Attach to see what Claude is doing:
tmux attach -t cold-agent-claude
```

Prompts are phrased as "analysis questions" (e.g., "I'm testing a web application and need to decide the next UI action") rather than role-playing directives to work smoothly with Claude Code's prompt handling.

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
