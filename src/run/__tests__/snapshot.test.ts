import { describe, it, expect } from 'vitest';
import { getPageKey, findElementByRef, findElementByText, findSearchBox, findHelpLink } from '../snapshot.js';
import type { PageSnapshot, InteractiveElement } from '../../types.js';

function createMockSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    type: 'a11y',
    url: 'https://example.com/dashboard',
    title: 'Dashboard',
    headings: ['Dashboard', 'Recent Activity'],
    navLinks: ['Home', 'Settings', 'Help'],
    interactiveElements: [
      { ref: 'btn_1', role: 'button', name: 'Create New' },
      { ref: 'lnk_2', role: 'link', name: 'Settings' },
      { ref: 'txt_3', role: 'textbox', name: 'Search', value: '' },
      { ref: 'lnk_4', role: 'link', name: 'Help Center' },
    ],
    text: 'Mock snapshot text',
    hasSearchBox: true,
    hasHelpLink: true,
    ...overrides,
  };
}

describe('getPageKey', () => {
  it('creates key from URL path and primary heading', () => {
    const snapshot = createMockSnapshot();
    const key = getPageKey(snapshot);
    expect(key).toBe('/dashboard::Dashboard');
  });

  it('handles missing heading', () => {
    const snapshot = createMockSnapshot({ headings: [] });
    const key = getPageKey(snapshot);
    expect(key).toBe('/dashboard::');
  });
});

describe('findElementByRef', () => {
  it('finds element by ref ID', () => {
    const snapshot = createMockSnapshot();
    const element = findElementByRef(snapshot, 'btn_1');
    expect(element).toBeDefined();
    expect(element?.name).toBe('Create New');
  });

  it('returns undefined for non-existent ref', () => {
    const snapshot = createMockSnapshot();
    const element = findElementByRef(snapshot, 'btn_999');
    expect(element).toBeUndefined();
  });
});

describe('findElementByText', () => {
  it('finds element by partial text match', () => {
    const snapshot = createMockSnapshot();
    const element = findElementByText(snapshot, 'Settings');
    expect(element).toBeDefined();
    expect(element?.ref).toBe('lnk_2');
  });

  it('is case-insensitive', () => {
    const snapshot = createMockSnapshot();
    const element = findElementByText(snapshot, 'settings');
    expect(element).toBeDefined();
  });
});

describe('findSearchBox', () => {
  it('finds search textbox', () => {
    const snapshot = createMockSnapshot();
    const element = findSearchBox(snapshot);
    expect(element).toBeDefined();
    expect(element?.ref).toBe('txt_3');
  });

  it('returns undefined when no search box', () => {
    const snapshot = createMockSnapshot({
      interactiveElements: [
        { ref: 'btn_1', role: 'button', name: 'Submit' },
      ],
    });
    const element = findSearchBox(snapshot);
    expect(element).toBeUndefined();
  });
});

describe('findHelpLink', () => {
  it('finds help link', () => {
    const snapshot = createMockSnapshot();
    const element = findHelpLink(snapshot);
    expect(element).toBeDefined();
    expect(element?.name).toBe('Help Center');
  });
});
