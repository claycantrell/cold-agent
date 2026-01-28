import type { Page } from 'playwright';
import type { InteractiveElement, PageSnapshot } from '../types.js';

const MAX_INTERACTIVE_ELEMENTS = 50;
const MAX_NAV_LINKS = 15;
const MAX_HEADINGS = 10;

interface A11yNode {
  role: string;
  name: string;
  value?: string;
  disabled?: boolean;
  focused?: boolean;
  children?: A11yNode[];
}

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'combobox',
  'listbox',
  'option',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'searchbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
]);

const NAV_ROLES = new Set(['navigation', 'menubar', 'menu']);
const HEADING_ROLES = new Set(['heading']);

export async function buildSnapshot(page: Page): Promise<PageSnapshot> {
  const url = page.url();
  const title = await page.title();

  const headings: string[] = [];
  const navLinks: string[] = [];
  const interactiveElements: InteractiveElement[] = [];
  let hasSearchBox = false;
  let hasHelpLink = false;
  let refCounter = 0;

  function generateRef(role: string): string {
    refCounter++;
    const prefix = role.slice(0, 3).toLowerCase();
    return `${prefix}_${refCounter}`;
  }

  // Try accessibility tree first, fall back to DOM queries
  let a11ySnapshot: A11yNode | null = null;
  try {
    const accessibility = (page as any).accessibility;
    if (accessibility && typeof accessibility.snapshot === 'function') {
      a11ySnapshot = await accessibility.snapshot({ interestingOnly: true });
    }
  } catch (e) {
    // Accessibility API not available or failed
  }

  if (a11ySnapshot) {
    // Process accessibility tree
    function processNode(node: A11yNode, inNav: boolean = false): void {
      if (!node) return;

      const role = node.role?.toLowerCase() || '';
      const name = node.name?.trim() || '';

      // Collect headings
      if (HEADING_ROLES.has(role) && name && headings.length < MAX_HEADINGS) {
        headings.push(name);
      }

      // Track if we're in a navigation region
      const isNavRegion = inNav || NAV_ROLES.has(role);

      // Collect nav links
      if (isNavRegion && role === 'link' && name && navLinks.length < MAX_NAV_LINKS) {
        navLinks.push(name);
      }

      // Collect interactive elements
      if (INTERACTIVE_ROLES.has(role) && name && interactiveElements.length < MAX_INTERACTIVE_ELEMENTS) {
        const element: InteractiveElement = {
          ref: generateRef(role),
          role,
          name,
        };

        if (node.value !== undefined) {
          element.value = node.value;
        }
        if (node.disabled) {
          element.disabled = true;
        }
        if (node.focused) {
          element.focused = true;
        }

        interactiveElements.push(element);

        // Check for search box
        if (role === 'searchbox' ||
            (role === 'textbox' && /search/i.test(name))) {
          hasSearchBox = true;
        }

        // Check for help link
        if (role === 'link' && /\bhelp\b/i.test(name)) {
          hasHelpLink = true;
        }
      }

      // Recurse into children
      if (node.children) {
        for (const child of node.children) {
          processNode(child, isNavRegion);
        }
      }
    }

    processNode(a11ySnapshot);
  } else {
    // Fallback: Build snapshot from DOM queries
    await buildSnapshotFromDOM(page, headings, navLinks, interactiveElements, generateRef);

    // Check for search box and help link in DOM-based elements
    for (const el of interactiveElements) {
      if (el.role === 'searchbox' || (el.role === 'textbox' && /search/i.test(el.name))) {
        hasSearchBox = true;
      }
      if (el.role === 'link' && /\bhelp\b/i.test(el.name)) {
        hasHelpLink = true;
      }
    }
  }

  // Build compact text representation
  const text = buildCompactText(url, title, headings, navLinks, interactiveElements);

  return {
    type: 'a11y',
    url,
    title,
    headings,
    navLinks,
    interactiveElements,
    text,
    hasSearchBox,
    hasHelpLink,
  };
}

async function buildSnapshotFromDOM(
  page: Page,
  headings: string[],
  navLinks: string[],
  interactiveElements: InteractiveElement[],
  generateRef: (role: string) => string
): Promise<void> {
  // Get headings
  const headingTexts = await page.locator('h1, h2').allTextContents();
  for (const text of headingTexts.slice(0, MAX_HEADINGS)) {
    const trimmed = text.trim();
    if (trimmed) {
      headings.push(trimmed);
    }
  }

  // Get nav links
  const navLinkElements = await page.locator('nav a, header a').all();
  for (const el of navLinkElements.slice(0, MAX_NAV_LINKS)) {
    const text = await el.textContent();
    if (text?.trim()) {
      navLinks.push(text.trim());
    }
  }

  // Get buttons
  const buttons = await page.locator('button:visible, [role="button"]:visible').all();
  for (const btn of buttons) {
    if (interactiveElements.length >= MAX_INTERACTIVE_ELEMENTS) break;
    const name = await btn.textContent() || await btn.getAttribute('aria-label') || '';
    if (name.trim()) {
      interactiveElements.push({
        ref: generateRef('button'),
        role: 'button',
        name: name.trim().slice(0, 100),
      });
    }
  }

  // Get links
  const links = await page.locator('a:visible').all();
  for (const link of links) {
    if (interactiveElements.length >= MAX_INTERACTIVE_ELEMENTS) break;
    const name = await link.textContent() || await link.getAttribute('aria-label') || '';
    if (name.trim() && name.trim().length > 1) {
      interactiveElements.push({
        ref: generateRef('link'),
        role: 'link',
        name: name.trim().slice(0, 100),
      });
    }
  }

  // Get text inputs
  const inputs = await page.locator('input:visible[type="text"], input:visible[type="search"], input:visible[type="email"], input:visible:not([type]), textarea:visible').all();
  for (const input of inputs) {
    if (interactiveElements.length >= MAX_INTERACTIVE_ELEMENTS) break;
    const placeholder = await input.getAttribute('placeholder') || '';
    const ariaLabel = await input.getAttribute('aria-label') || '';
    const label = await input.evaluate((el) => {
      const id = (el as any).id;
      if (id) {
        const labelEl = (el as any).ownerDocument.querySelector(`label[for="${id}"]`);
        if (labelEl) return labelEl.textContent || '';
      }
      return '';
    });
    const name = ariaLabel || label || placeholder || 'text input';
    const type = await input.getAttribute('type') || 'text';
    const value = await input.inputValue().catch(() => '');

    interactiveElements.push({
      ref: generateRef('textbox'),
      role: type === 'search' ? 'searchbox' : 'textbox',
      name: name.trim().slice(0, 100),
      value: value || undefined,
    });
  }

  // Get selects
  const selects = await page.locator('select:visible').all();
  for (const select of selects) {
    if (interactiveElements.length >= MAX_INTERACTIVE_ELEMENTS) break;
    const ariaLabel = await select.getAttribute('aria-label') || '';
    const label = await select.evaluate((el) => {
      const id = (el as any).id;
      if (id) {
        const labelEl = (el as any).ownerDocument.querySelector(`label[for="${id}"]`);
        if (labelEl) return labelEl.textContent || '';
      }
      return '';
    });
    const name = ariaLabel || label || 'dropdown';

    interactiveElements.push({
      ref: generateRef('combobox'),
      role: 'combobox',
      name: name.trim().slice(0, 100),
    });
  }
}

function buildCompactText(
  url: string,
  title: string,
  headings: string[],
  navLinks: string[],
  elements: InteractiveElement[]
): string {
  const lines: string[] = [];

  lines.push(`Page: ${title}`);
  lines.push(`URL: ${url}`);

  if (headings.length > 0) {
    lines.push(`\nHeadings: ${headings.join(' > ')}`);
  }

  if (navLinks.length > 0) {
    lines.push(`\nNav: ${navLinks.join(', ')}`);
  }

  if (elements.length > 0) {
    lines.push(`\nInteractive elements (${elements.length}):`);
    for (const el of elements) {
      let desc = `[${el.ref}] ${el.role}: "${el.name}"`;
      if (el.value) {
        desc += ` (value: "${el.value}")`;
      }
      if (el.disabled) {
        desc += ' [disabled]';
      }
      if (el.focused) {
        desc += ' [focused]';
      }
      lines.push(desc);
    }
  }

  return lines.join('\n');
}

export function getPageKey(snapshot: PageSnapshot): string {
  // Create a stable key for detecting loops (url path + primary heading)
  const urlPath = new URL(snapshot.url).pathname;
  const primaryHeading = snapshot.headings[0] || '';
  return `${urlPath}::${primaryHeading}`;
}

export function findElementByRef(
  snapshot: PageSnapshot,
  ref: string
): InteractiveElement | undefined {
  return snapshot.interactiveElements.find(el => el.ref === ref);
}

export function findElementByText(
  snapshot: PageSnapshot,
  text: string
): InteractiveElement | undefined {
  const lowerText = text.toLowerCase();
  return snapshot.interactiveElements.find(
    el => el.name.toLowerCase().includes(lowerText)
  );
}

export function findSearchBox(snapshot: PageSnapshot): InteractiveElement | undefined {
  return snapshot.interactiveElements.find(
    el => el.role === 'searchbox' ||
         (el.role === 'textbox' && /search/i.test(el.name))
  );
}

export function findHelpLink(snapshot: PageSnapshot): InteractiveElement | undefined {
  return snapshot.interactiveElements.find(
    el => el.role === 'link' && /\bhelp\b/i.test(el.name)
  );
}
