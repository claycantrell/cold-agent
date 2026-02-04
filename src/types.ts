import { z } from 'zod';

// ============================================================================
// Run Configuration Types
// ============================================================================

export const AuthConfigSchema = z.object({
  type: z.literal('password'),
  loginUrl: z.string().url(),
  username: z.string(),
  password: z.string(),
});

export const BudgetsSchema = z.object({
  maxSteps: z.number().int().positive().default(40),
  maxMinutes: z.number().positive().default(6),
});

export const ViewportSchema = z.object({
  width: z.number().int().positive().default(1280),
  height: z.number().int().positive().default(800),
});

export const SuccessHintsSchema = z.object({
  mustSeeText: z.array(z.string()).optional(),
  mustEndOnUrlIncludes: z.array(z.string()).optional(),
});

export const RunOptionsSchema = z.object({
  headless: z.boolean().default(true),
  viewport: ViewportSchema.default({ width: 1280, height: 800 }),
  recordVideo: z.boolean().default(true),
  recordTrace: z.boolean().default(true),
  networkAllowlist: z.array(z.string()).optional(),
  successHints: SuccessHintsSchema.optional(),
});

export const RunCreateRequestSchema = z.object({
  baseUrl: z.string().url(),
  goal: z.string().min(1),
  auth: AuthConfigSchema.optional(),
  budgets: BudgetsSchema.default({ maxSteps: 40, maxMinutes: 6 }),
  options: RunOptionsSchema.default({}),
});

export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type Budgets = z.infer<typeof BudgetsSchema>;
export type Viewport = z.infer<typeof ViewportSchema>;
export type SuccessHints = z.infer<typeof SuccessHintsSchema>;
export type RunOptions = z.infer<typeof RunOptionsSchema>;
export type RunCreateRequest = z.infer<typeof RunCreateRequestSchema>;

// ============================================================================
// Persona + Question Generation Types
// ============================================================================

export const PersonaSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(20), // free-form: who they are, context, constraints
  interests: z.array(z.string().min(2)).optional(), // systems/tools/tasks they're curious about
});

export const PersonaQuestionGenRequestSchema = z.object({
  baseUrl: z.string().url(),
  persona: PersonaSchema,
  count: z.number().int().min(1).max(20).default(6),
  // optional extra guidance to shape questions
  focus: z.string().min(1).optional(),
  // optional: describe what the site/product does (prevents LLM from guessing wrong)
  siteDescription: z.string().min(10).optional(),
});

export const PersonaQuestionGenResponseSchema = z.object({
  questions: z.array(z.string().min(5)).min(1),
});

export type Persona = z.infer<typeof PersonaSchema>;
export type PersonaQuestionGenRequest = z.infer<typeof PersonaQuestionGenRequestSchema>;
export type PersonaQuestionGenResponse = z.infer<typeof PersonaQuestionGenResponseSchema>;

// ============================================================================
// Batch Run Types
// ============================================================================

export const RunBatchCreateRequestSchema = z.object({
  runs: z.array(RunCreateRequestSchema).min(1).max(25),
});

export type RunBatchCreateRequest = z.infer<typeof RunBatchCreateRequestSchema>;

export interface RunBatchCreateResponse {
  runIds: string[];
}

// ============================================================================
// Action Types
// ============================================================================

export type ActionType = 'click' | 'fill' | 'select' | 'scroll' | 'back' | 'wait' | 'search' | 'openHelp' | 'done';

export interface ClickAction {
  type: 'click';
  target: string; // ref ID or text
}

export interface FillAction {
  type: 'fill';
  target: string; // field ref or label
  value: string;
}

export interface SelectAction {
  type: 'select';
  target: string;
  option: string;
}

export interface ScrollAction {
  type: 'scroll';
  direction: 'up' | 'down';
  amount?: 'page' | 'half' | number;
}

export interface BackAction {
  type: 'back';
}

export interface WaitAction {
  type: 'wait';
  ms: number;
}

export interface SearchAction {
  type: 'search';
  query: string;
}

export interface OpenHelpAction {
  type: 'openHelp';
}

export interface DoneAction {
  type: 'done';
  reason: string;
  evidenceSteps: number[];
}

export type AgentAction =
  | ClickAction
  | FillAction
  | SelectAction
  | ScrollAction
  | BackAction
  | WaitAction
  | SearchAction
  | OpenHelpAction
  | DoneAction;

// ============================================================================
// Snapshot Types
// ============================================================================

export interface InteractiveElement {
  ref: string;           // stable reference ID (e.g., "btn_3", "input_7")
  role: string;          // button, link, textbox, combobox, etc.
  name: string;          // accessible name
  type?: string;         // input type if applicable
  value?: string;        // current value if input
  disabled?: boolean;
  focused?: boolean;
}

export interface PageSnapshot {
  type: 'a11y';
  url: string;
  title: string;
  headings: string[];              // visible h1/h2 text
  navLinks: string[];              // navigation link labels (limited)
  interactiveElements: InteractiveElement[];
  text: string;                    // compact text representation
  hasSearchBox: boolean;
  hasHelpLink: boolean;
}

// ============================================================================
// Step Log Types
// ============================================================================

export type ProgressLevel = 'none' | 'some' | 'major';

export interface StepResult {
  ok: boolean;
  notes: string;
  newUrl?: string;
  progress: ProgressLevel;
  error?: string;
}

export interface StepErrors {
  console: string[];
  network: string[];
  exception: string | null;
}

export interface StepLog {
  i: number;
  timestamp: string;
  url: string;
  pageTitle: string;
  snapshot: PageSnapshot;
  action: AgentAction;
  result: StepResult;
  evidence: {
    screenshot: string;
  };
  errors: StepErrors;
}

// ============================================================================
// Help Ladder Types
// ============================================================================

export type HelpLadderPhase = 0 | 1 | 2;

export interface HelpLadderState {
  phase: HelpLadderPhase;
  stepsWithoutProgress: number;
  searchTermsUsed: string[];
  helpOpened: boolean;
}

// ============================================================================
// Finding Types
// ============================================================================

export type FindingType = 'discoverability' | 'copy' | 'validation' | 'bug' | 'performance';
export type Severity = 'low' | 'med' | 'high';

export interface Finding {
  type: FindingType;
  severity: Severity;
  title: string;
  details: string;
  evidence: {
    step: number;
    screenshot: string;
  };
}

// ============================================================================
// Run Report Types
// ============================================================================

export type RunStatus = 'pending' | 'running' | 'success' | 'fail' | 'partial';

export interface RunMetrics {
  steps: number;
  pageTransitions: number;
  backtracks: number;
  searchUsed: boolean;
  stuckEvents: number;
  consoleErrors: number;
  failedRequests: number;
  durationMs: number;
}

export interface RunSummary {
  outcome: 'success' | 'fail' | 'partial';
  reason: string;
  completionEvidence: string[];
}

export interface RunArtifacts {
  traceZip?: string;
  video?: string;
  stepsJson: string;
  screenshotsDir: string;
}

export interface RunReport {
  runId: string;
  status: RunStatus;
  goal: string;
  baseUrl: string;
  startedAt: string;
  endedAt?: string;
  summary?: RunSummary;
  metrics?: RunMetrics;
  findings: Finding[];
  artifacts: RunArtifacts;
  error?: string;
}

// ============================================================================
// Destructive Action Blocklist
// ============================================================================

export const DESTRUCTIVE_KEYWORDS = [
  'delete',
  'remove',
  'cancel subscription',
  'unsubscribe',
  'close account',
  'deactivate',
  'terminate',
  'destroy',
  'erase',
  'permanently',
];

// ============================================================================
// Agent Decision Context
// ============================================================================

export interface StepSummary {
  i: number;
  action: string;
  result: string;
  url: string;
}

export interface DecisionContext {
  goal: string;
  currentSnapshot: PageSnapshot;
  recentHistory: StepSummary[];  // last N steps
  ladderState: HelpLadderState;
  budgets: {
    stepsRemaining: number;
    timeRemainingMs: number;
  };
  successHints?: SuccessHints;
}

// ============================================================================
// Run State (internal)
// ============================================================================

export interface RunState {
  runId: string;
  config: RunCreateRequest;
  status: RunStatus;
  startedAt: Date;
  endedAt?: Date;
  steps: StepLog[];
  ladderState: HelpLadderState;
  visitedPages: Map<string, number>;  // url+heading -> count
  artifactsDir: string;
  report?: RunReport;
}
