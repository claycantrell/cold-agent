import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    // Uses ANTHROPIC_API_KEY env var automatically
    client = new Anthropic();
  }
  return client;
}

export interface AnthropicOptions {
  timeoutMs?: number;
  model?: string;
  maxTokens?: number;
}

export async function callAnthropic(prompt: string, options: AnthropicOptions = {}): Promise<string> {
  const {
    model = 'claude-sonnet-4-20250514',
    maxTokens = 4096,
    timeoutMs = 90_000,
  } = options;

  const anthropic = getClient();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // Extract text from response
    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }
    return textBlock.text;
  } catch (error: unknown) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Anthropic API timed out after ${timeoutMs / 1000} seconds`);
    }
    throw error;
  }
}
