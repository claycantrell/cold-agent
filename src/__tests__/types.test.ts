import { describe, it, expect } from 'vitest';
import { RunCreateRequestSchema } from '../types.js';

describe('RunCreateRequestSchema', () => {
  it('validates minimal request', () => {
    const request = {
      baseUrl: 'https://example.com',
      goal: 'Find the contact page',
    };

    const result = RunCreateRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.budgets.maxSteps).toBe(40);
      expect(result.data.budgets.maxMinutes).toBe(6);
      expect(result.data.options.headless).toBe(true);
    }
  });

  it('validates full request', () => {
    const request = {
      baseUrl: 'https://example.com',
      goal: 'Complete user registration',
      auth: {
        type: 'password',
        loginUrl: 'https://example.com/login',
        username: 'test@example.com',
        password: 'secret123',
      },
      budgets: {
        maxSteps: 50,
        maxMinutes: 10,
      },
      options: {
        headless: false,
        viewport: { width: 1920, height: 1080 },
        recordVideo: true,
        recordTrace: true,
        networkAllowlist: ['example.com'],
        successHints: {
          mustSeeText: ['Welcome', 'Dashboard'],
          mustEndOnUrlIncludes: ['/dashboard'],
        },
      },
    };

    const result = RunCreateRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.auth?.type).toBe('password');
      expect(result.data.options.successHints?.mustSeeText).toContain('Welcome');
    }
  });

  it('rejects invalid baseUrl', () => {
    const request = {
      baseUrl: 'not-a-url',
      goal: 'Test',
    };

    const result = RunCreateRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });

  it('rejects empty goal', () => {
    const request = {
      baseUrl: 'https://example.com',
      goal: '',
    };

    const result = RunCreateRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });

  it('rejects negative budgets', () => {
    const request = {
      baseUrl: 'https://example.com',
      goal: 'Test',
      budgets: {
        maxSteps: -1,
        maxMinutes: 5,
      },
    };

    const result = RunCreateRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });
});
