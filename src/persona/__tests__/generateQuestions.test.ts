import { describe, expect, test } from 'vitest';
import { parseQuestionsFromClaude, generatePersonaQuestions } from '../generateQuestions.js';

describe('persona question generation', () => {
  test('parses strict JSON questions (with code fences)', () => {
    const text = [
      '```json',
      '{ "questions": ["Find pricing information for teams", "How do I reset my password?"] }',
      '```',
    ].join('\n');

    const parsed = parseQuestionsFromClaude(text);
    expect(parsed.questions.length).toBe(2);
    expect(parsed.questions[0]).toContain('pricing');
  });

  test('generatePersonaQuestions trims and de-dupes', async () => {
    const res = await generatePersonaQuestions(
      {
        baseUrl: 'https://example.com',
        persona: { description: 'A new admin learning how to configure accounts and permissions for a small team.' },
        count: 3,
      },
      {
        callClaude: async () =>
          JSON.stringify({
            questions: [' Find pricing ', 'find pricing', 'Locate the billing page'],
          }),
      }
    );

    expect(res.questions.length).toBe(2);
    expect(res.questions[0]).toBe('Find pricing');
  });
});

