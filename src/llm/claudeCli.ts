import { spawn } from 'child_process';

export interface ClaudeCliOptions {
  timeoutMs?: number;
  outputFormat?: 'text' | 'json';
}

export async function callClaudeCli(prompt: string, options: ClaudeCliOptions = {}): Promise<string> {
  const TIMEOUT_MS = options.timeoutMs ?? 90_000;
  const outputFormat = options.outputFormat ?? 'text';

  const { writeFileSync, unlinkSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');

  // Write prompt to temp file to avoid shell argument limits
  const tempFile = join(tmpdir(), `claude-prompt-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  writeFileSync(tempFile, prompt, 'utf8');

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      try { unlinkSync(tempFile); } catch {}
    };

    // Use -p (print mode) for non-interactive use, and --dangerously-skip-permissions to avoid prompts
    const child = spawn('sh', ['-c', `cat "${tempFile}" | claude -p --dangerously-skip-permissions --output-format ${outputFormat}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      cleanup();
      reject(new Error(`Claude CLI timed out after ${TIMEOUT_MS / 1000} seconds`));
    }, TIMEOUT_MS);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      cleanup();
      if (timedOut) return;

      if (code === 0) {
        resolve(stdout.trim());
      } else {
        // Claude CLI sometimes prints errors to stdout, so include both
        const errorOutput = (stderr + '\n' + stdout).trim().slice(0, 2000);
        reject(new Error(`Claude CLI exited with code ${code}: ${errorOutput}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
    });
  });
}

