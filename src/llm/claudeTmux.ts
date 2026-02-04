/**
 * Claude integration via tmux (Gastown-style)
 * 
 * Runs Claude interactively in a tmux session and communicates via send-keys/capture-pane.
 * Uses OAuth (Pro subscription) - no API keys needed.
 * 
 * SETUP REQUIREMENTS:
 * 1. tmux must be installed
 * 2. Claude CLI must be installed: npm install -g @anthropic-ai/claude-code
 * 3. Run `claude setup-token` once in your terminal to get OAuth token
 * 4. Set CLAUDE_CODE_OAUTH_TOKEN env var with the token
 * 5. ~/.claude.json must exist (created during first claude run)
 */

import { execSync } from 'child_process';

const SESSION_NAME = 'cold-agent-claude';

// Mutex to ensure only one request uses the tmux session at a time
let sessionLock: Promise<void> = Promise.resolve();
let lockResolve: (() => void) | null = null;

async function acquireLock(): Promise<void> {
  // Wait for any existing lock to release
  await sessionLock;
  // Create new lock
  sessionLock = new Promise(resolve => {
    lockResolve = resolve;
  });
}

function releaseLock(): void {
  if (lockResolve) {
    lockResolve();
    lockResolve = null;
  }
}

export interface ClaudeTmuxOptions {
  timeoutMs?: number;
  workDir?: string;
}

/**
 * Check if tmux is available
 */
function hasTmux(): boolean {
  try {
    execSync('tmux -V', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Claude session exists
 */
function hasSession(): boolean {
  try {
    execSync(`tmux has-session -t =${SESSION_NAME} 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Claude (node) is running in the session
 */
function isClaudeRunning(): boolean {
  try {
    const cmd = execSync(`tmux list-panes -t ${SESSION_NAME} -F '#{pane_current_command}'`, { 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    // Claude shows as node, claude, or version number like 2.1.29
    // Also check for bash which may be the parent process
    if (cmd === 'node' || cmd === 'claude' || /^\d+\.\d+\.\d+$/.test(cmd)) {
      return true;
    }
    // If it's bash, check if Claude is actually running by looking at pane content
    if (cmd === 'bash' || cmd === 'zsh') {
      const content = capturePane(20);
      return content.includes('Claude Code') || content.includes('Welcome back');
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if Claude is at the prompt (ready for input)
 */
function isAtPrompt(): boolean {
  try {
    const content = capturePane(20);
    // Look for the prompt indicator - Claude shows ❯ when ready
    // Also check for "Welcome back" which means it's at the initial prompt
    const hasPrompt = content.includes('❯');
    const isResponding = content.includes('⏺');
    const isWelcome = content.includes('Welcome back') || content.includes('Welcome to Claude');
    return (hasPrompt && !isResponding) || isWelcome;
  } catch {
    return false;
  }
}

/**
 * Build the startup command with OAuth token
 */
function buildStartupCommand(): string {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (token) {
    return `bash -c 'export CLAUDE_CODE_OAUTH_TOKEN="${token}" && claude --dangerously-skip-permissions'`;
  }
  return 'claude --dangerously-skip-permissions';
}

/**
 * Start a new Claude session in tmux
 */
async function startSession(workDir?: string): Promise<void> {
  const cwd = workDir || process.cwd();
  
  // Kill existing session if it exists
  if (hasSession()) {
    try {
      execSync(`tmux kill-session -t ${SESSION_NAME}`, { stdio: 'pipe' });
    } catch {}
  }
  
  // Start new session with Claude
  const cmd = buildStartupCommand();
  execSync(`tmux new-session -d -s ${SESSION_NAME} -c "${cwd}" "${cmd}"`, { stdio: 'pipe' });
  
  // Wait for Claude to start and be ready (up to 15 seconds)
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (isClaudeRunning()) {
      // Wait for prompt to appear
      await sleep(2000);
      if (isAtPrompt()) {
        return;
      }
    }
    await sleep(500);
  }
  
  throw new Error('Claude failed to start in tmux session. Make sure ~/.claude.json exists and CLAUDE_CODE_OAUTH_TOKEN is set.');
}

/**
 * Send a prompt to Claude via tmux send-keys
 */
async function sendPrompt(prompt: string): Promise<void> {
  // Use tmux send-keys with literal mode (-l) for proper escaping
  // Write prompt to temp file to avoid shell escaping issues
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  
  const tempFile = path.join(os.tmpdir(), `claude-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tempFile, prompt, 'utf8');
  
  try {
    // Load from file to avoid escaping issues
    execSync(`tmux load-buffer "${tempFile}"`, { stdio: 'pipe' });
    execSync(`tmux paste-buffer -t ${SESSION_NAME}`, { stdio: 'pipe' });
    await sleep(500); // Wait for paste
    execSync(`tmux send-keys -t ${SESSION_NAME} Enter`, { stdio: 'pipe' });
  } finally {
    try { fs.unlinkSync(tempFile); } catch {}
  }
}

/**
 * Capture the current pane content
 * Uses -J to join wrapped lines (prevents JSON from being split)
 */
function capturePane(lines: number = 200): string {
  try {
    // -J joins wrapped lines, -p prints to stdout
    return execSync(`tmux capture-pane -p -J -t ${SESSION_NAME} -S -${lines}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch {
    return '';
  }
}

/**
 * Wait for Claude to finish responding and extract the response
 */
async function waitForResponse(timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastContent = '';
  let stableCount = 0;
  
  // Wait a moment for Claude to start processing
  await sleep(1000);
  
  while (Date.now() < deadline) {
    const content = capturePane(100);
    
    // Check if Claude is at prompt (ready for next input)
    // The prompt shows ❯ at the start of a line with no pending response
    const lines = content.split('\n');
    const lastNonEmptyLines = lines.filter(l => l.trim()).slice(-5);
    const lastLine = lastNonEmptyLines[lastNonEmptyLines.length - 1] || '';
    
    // Claude shows ⏺ while responding, ❯ when ready
    const isResponding = content.includes('⏺');
    const atPrompt = lastLine.includes('❯') && !isResponding;
    
    if (content === lastContent && !isResponding) {
      stableCount++;
      if (stableCount >= 3 && atPrompt) {
        return extractResponse(content);
      }
    } else {
      stableCount = 0;
      lastContent = content;
    }
    
    await sleep(500);
  }
  
  // Timeout - return whatever we captured
  return extractResponse(capturePane(100));
}

/**
 * Extract Claude's response from the captured pane content
 */
function extractResponse(content: string): string {
  const lines = content.split('\n');
  const responseLines: string[] = [];
  let foundResponse = false;
  let inJsonBlock = false;
  
  for (const line of lines) {
    // Claude's response starts with ⏺
    if (line.includes('⏺')) {
      foundResponse = true;
      // Extract just the response part after ⏺
      const responseStart = line.indexOf('⏺');
      const response = line.slice(responseStart + 1).trim();
      if (response) {
        // Check if this starts a JSON block
        if (response.startsWith('{') || response.startsWith('[')) {
          inJsonBlock = true;
        }
        responseLines.push(response);
      }
      continue;
    }
    
    // Stop at the next prompt or timer
    if (foundResponse && (line.includes('❯') || line.includes('✻ Brewed'))) {
      break;
    }
    
    // Collect continuation lines of the response
    if (foundResponse && line.trim() && !line.includes('───')) {
      responseLines.push(line.trim());
    }
  }
  
  // Join lines - if it's JSON, join without newlines to fix wrapping
  let result = responseLines.join(' ').trim();
  
  // Clean up extra spaces that tmux wrapping introduces
  result = result.replace(/\s+/g, ' ');
  
  // If the response contains JSON, try to extract just the JSON part
  const jsonMatch = result.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (jsonMatch) {
    return jsonMatch[0];
  }
  
  return result;
}

/**
 * Call Claude via tmux (Gastown-style)
 * 
 * This is the main entry point. It:
 * 1. Ensures a Claude tmux session is running
 * 2. Sends the prompt
 * 3. Waits for and returns the response
 */
export async function callClaudeTmux(prompt: string, options: ClaudeTmuxOptions = {}): Promise<string> {
  const { timeoutMs = 90_000, workDir } = options;
  
  if (!hasTmux()) {
    throw new Error('tmux is not installed. Install with: brew install tmux');
  }
  
  // Acquire lock - only one request can use the tmux session at a time
  await acquireLock();
  
  try {
    // Ensure session is running and ready
    if (!hasSession() || !isClaudeRunning()) {
      await startSession(workDir);
    } else if (!isAtPrompt()) {
      // Session exists but Claude isn't ready - wait or restart
      await sleep(2000);
      if (!isAtPrompt()) {
        await startSession(workDir);
      }
    }
    
    // Send the prompt
    await sendPrompt(prompt);
    
    // Wait for and return the response
    const response = await waitForResponse(timeoutMs);
    
    if (!response) {
      throw new Error('No response from Claude. Check tmux session: tmux attach -t cold-agent-claude');
    }
    
    return response;
  } finally {
    // Always release the lock
    releaseLock();
  }
}

/**
 * Kill the Claude tmux session
 */
export function killSession(): void {
  try {
    execSync(`tmux kill-session -t ${SESSION_NAME}`, { stdio: 'pipe' });
  } catch {}
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
