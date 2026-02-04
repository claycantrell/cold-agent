import { z } from 'zod';
import type { Persona, PersonaQuestionGenRequest, PersonaQuestionGenResponse } from '../types.js';
import { PersonaQuestionGenResponseSchema } from '../types.js';
import { callClaudeCli } from '../llm/claudeCli.js';
import { callAnthropic } from '../llm/anthropicSdk.js';
import { callClaudeTmux } from '../llm/claudeTmux.js';

const RawClaudeResponseSchema = z.object({
  questions: z.array(z.string()).default([]),
});

// Priority: 1) API key → SDK, 2) CLI pipe mode with OAuth, 3) tmux (Gastown-style fallback)
function getDefaultClaude(): (prompt: string) => Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) {
    return (prompt: string) => callAnthropic(prompt);
  }
  // Prefer CLI pipe mode (faster) when OAuth token is set
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return (prompt: string) => callClaudeCli(prompt, { outputFormat: 'text' });
  }
  // Fall back to tmux if USE_TMUX is explicitly enabled
  if (process.env.USE_TMUX === '1') {
    return (prompt: string) => callClaudeTmux(prompt);
  }
  // Default to CLI pipe mode
  return (prompt: string) => callClaudeCli(prompt, { outputFormat: 'text' });
}

export async function generatePersonaQuestions(
  req: PersonaQuestionGenRequest,
  deps?: { callClaude?: (prompt: string) => Promise<string> }
): Promise<PersonaQuestionGenResponse> {
  const callClaude = deps?.callClaude ?? getDefaultClaude();
  const prompt = buildPrompt(req.baseUrl, req.persona, req.count, req.focus, req.siteDescription);

  const text = await callClaude(prompt);
  const parsed = parseQuestionsFromClaude(text);

  // Trim and de-duplicate while preserving order
  const seen = new Set<string>();
  const questions = parsed.questions
    .map(q => q.trim())
    .filter(q => q.length > 0)
    .filter(q => {
      const key = q.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, req.count);

  const final = PersonaQuestionGenResponseSchema.safeParse({ questions });
  if (!final.success) {
    throw new Error(`Failed to validate generated questions: ${final.error.message}`);
  }
  return final.data;
}

function buildPrompt(baseUrl: string, persona: Persona, count: number, focus?: string, siteDescription?: string): string {
  const lines: string[] = [];
  lines.push(`You are helping generate test missions for a web exploration agent.`);
  lines.push(`The agent will start at: ${baseUrl}`);
  if (siteDescription) {
    lines.push(`Site/Product: ${siteDescription}`);
    lines.push(`IMPORTANT: Use the site description above. Do NOT look up or guess what this site does.`);
  }
  lines.push('');
  lines.push(`Persona:`);
  if (persona.name) lines.push(`- Name: ${persona.name}`);
  lines.push(`- Description: ${persona.description}`);
  if (persona.interests?.length) lines.push(`- Interests: ${persona.interests.join(', ')}`);
  if (focus) lines.push(`- Focus: ${focus}`);
  lines.push('');
  lines.push(`Task: produce ${count} distinct, specific, realistic questions/goals this persona might ask about the product.`);
  lines.push('');
  lines.push(`Constraints:`);
  lines.push(`- Each item must be a single-sentence goal that can be attempted via the UI (click/fill/search/scroll).`);
  lines.push(`- Avoid destructive actions (delete/remove/cancel) unless explicitly framed as "learn how" without executing it.`);
  lines.push(`- Do not mention internal implementation details. No API-level tasks. No "check the database".`);
  lines.push(`- Prefer tasks that end with an observable outcome (a page, a setting, a specific piece of information).`);
  lines.push('');
  lines.push(`Return STRICT JSON only, no markdown:`);
  lines.push(`{"questions": ["...", "..."]}`);

  return lines.join('\n');
}

export function parseQuestionsFromClaude(text: string): PersonaQuestionGenResponse {
  if (!text || text.trim() === '') {
    throw new Error('Empty response from Claude');
  }

  // Strip markdown code blocks if present
  const cleanText = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON found in response: ${cleanText.slice(0, 300)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Invalid JSON in response: ${jsonMatch[0].slice(0, 200)}... Error: ${e}`);
  }

  const normalized = RawClaudeResponseSchema.safeParse(raw);
  if (!normalized.success) {
    throw new Error(`Invalid question response shape: ${normalized.error.message}`);
  }

  const validated = PersonaQuestionGenResponseSchema.safeParse(normalized.data);
  if (!validated.success) {
    throw new Error(`Question response failed validation: ${validated.error.message}`);
  }
  return validated.data;
}

