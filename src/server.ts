import express, { type Request, type Response, type NextFunction } from 'express';
import * as path from 'path';
import { PersonaQuestionGenRequestSchema, RunBatchCreateRequestSchema, RunCreateRequestSchema } from './types.js';
import { createRunOrchestrator } from './run/runOrchestrator.js';
import { renderRunReportHtml } from './report/htmlReport.js';
import { createGitHubIssue } from './integrations/github.js';
import * as fs from 'fs/promises';
import { generatePersonaQuestions } from './persona/generateQuestions.js';

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json());

// Create orchestrator
const orchestrator = createRunOrchestrator();

// Serve static artifacts
app.use('/runs/:runId/artifacts', (req: Request, res: Response, next: NextFunction) => {
  const runId = req.params.runId as string;
  const artifactsPath = path.join(process.cwd(), 'runs', runId, 'artifacts');
  express.static(artifactsPath)(req, res, next);
});

// POST /runs - Start a new run
app.post('/runs', async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate request body
    const parseResult = RunCreateRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parseResult.error.issues,
      });
      return;
    }

    const runConfig = parseResult.data;

    // Start the run
    const runId = await orchestrator.startRun(runConfig);

    res.status(202).json({
      runId,
      status: 'pending',
      message: 'Run started',
      links: {
        status: `/runs/${runId}`,
        artifacts: `/runs/${runId}/artifacts/`,
      },
    });
  } catch (error) {
    console.error('Error starting run:', error);
    res.status(500).json({
      error: 'Failed to start run',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// POST /runs/batch - Start multiple runs (missions) at once
app.post('/runs/batch', async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = RunBatchCreateRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.issues });
      return;
    }

    const runIds: string[] = [];
    for (const runConfig of parseResult.data.runs) {
      // startRun is async but returns immediately (run itself executes later)
      // We keep this sequential to avoid overwhelming the orchestrator with enqueues at once.
      const runId = await orchestrator.startRun(runConfig);
      runIds.push(runId);
    }

    res.status(202).json({ runIds });
  } catch (error) {
    console.error('Error starting batch runs:', error);
    res.status(500).json({
      error: 'Failed to start batch runs',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// POST /personas/questions - Generate hypothetical questions (missions) for a persona on a given baseUrl
app.post('/personas/questions', async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = PersonaQuestionGenRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.issues });
      return;
    }

    const out = await generatePersonaQuestions(parseResult.data);
    res.json(out);
  } catch (error) {
    console.error('Error generating persona questions:', error);
    res.status(500).json({
      error: 'Failed to generate persona questions',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// POST /personas/runs - Generate persona questions, then start a run per question (in parallel, via orchestrator queue)
app.post('/personas/runs', async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = PersonaQuestionGenRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.issues });
      return;
    }

    const { baseUrl, persona, count, focus, siteDescription } = parseResult.data;
    const questions = await generatePersonaQuestions({ baseUrl, persona, count, focus, siteDescription });

    // Allow callers to pass run defaults; keep it simple: accept optional budgets/options/auth at the top-level
    const auth = req.body?.auth;
    const budgets = req.body?.budgets;
    const options = req.body?.options;
    // Whether to embed persona context in each goal (default: true)
    const embedPersona = req.body?.embedPersona !== false;

    // Build persona context string for embedding in goals
    const personaContext = embedPersona
      ? `[Persona: ${persona.name || persona.description}${persona.interests?.length ? ` | Interests: ${persona.interests.join(', ')}` : ''}] `
      : '';

    const runIds: string[] = [];
    for (const goal of questions.questions) {
      // Embed persona context so agent knows who they're acting as
      const fullGoal = personaContext + goal;
      const runConfig: any = { baseUrl, goal: fullGoal };
      if (auth) runConfig.auth = auth;
      if (budgets) runConfig.budgets = budgets;
      if (options) runConfig.options = options;
      const validated = RunCreateRequestSchema.safeParse(runConfig);
      if (!validated.success) {
        res.status(400).json({ error: 'Invalid run defaults (auth/budgets/options)', details: validated.error.issues });
        return;
      }
      runIds.push(await orchestrator.startRun(validated.data));
    }

    res.status(202).json({ 
      persona: { description: persona.description, interests: persona.interests },
      siteDescription,
      questions: questions.questions, 
      runIds 
    });
  } catch (error) {
    console.error('Error starting persona runs:', error);
    res.status(500).json({
      error: 'Failed to start persona runs',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// GET /runs/:runId - Get run status/report
app.get('/runs/:runId', async (req: Request, res: Response): Promise<void> => {
  try {
    const runId = req.params.runId as string;
    const report = await orchestrator.getRunReport(runId);

    if (!report) {
      res.status(404).json({
        error: 'Run not found',
        runId,
      });
      return;
    }

    res.json(report);
  } catch (error) {
    console.error('Error getting run:', error);
    res.status(500).json({
      error: 'Failed to get run',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// GET /runs/:runId/report - Human-friendly HTML report
app.get('/runs/:runId/report', async (req: Request, res: Response): Promise<void> => {
  try {
    const runId = req.params.runId as string;
    const report = await orchestrator.getRunReport(runId);
    if (!report) {
      res.status(404).send('Run not found');
      return;
    }

    const stepsPath = path.join(process.cwd(), 'runs', runId, 'artifacts', 'steps.json');
    let steps: any[] = [];
    try {
      const stepsRaw = await fs.readFile(stepsPath, 'utf-8');
      steps = JSON.parse(stepsRaw);
    } catch {
      // Steps may not exist yet for pending/running runs
      steps = [];
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const html = renderRunReportHtml({ baseUrl, report, steps });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('Error rendering report:', error);
    res.status(500).send(error instanceof Error ? error.message : String(error));
  }
});

// POST /runs/:runId/issues/github - Create a GitHub issue with repro + evidence
app.post('/runs/:runId/issues/github', async (req: Request, res: Response): Promise<void> => {
  try {
    const runId = req.params.runId as string;
    const report = await orchestrator.getRunReport(runId);
    if (!report || !report.summary) {
      res.status(404).json({ error: 'Run report not found or not complete yet', runId });
      return;
    }

    const stepsPath = path.join(process.cwd(), 'runs', runId, 'artifacts', 'steps.json');
    let steps: any[] = [];
    try {
      const stepsRaw = await fs.readFile(stepsPath, 'utf-8');
      steps = JSON.parse(stepsRaw);
    } catch {
      steps = [];
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const defaultTitle = `[cold-agent] ${report.status.toUpperCase()}: ${report.goal}`;

    const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : defaultTitle;
    const labels = Array.isArray(req.body?.labels) ? req.body.labels.filter((x: any) => typeof x === 'string') : undefined;

    const body = renderRunReportHtml({
      baseUrl,
      report,
      steps,
      format: 'github-issue-markdown',
    });

    const issue = await createGitHubIssue({ title, body, labels });
    res.json(issue);
  } catch (error) {
    console.error('Error creating GitHub issue:', error);
    res.status(500).json({
      error: 'Failed to create GitHub issue',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// GET /runs - List all runs
app.get('/runs', async (_req: Request, res: Response): Promise<void> => {
  try {
    const runs = await orchestrator.getAllRuns();
    res.json({
      runs,
      count: runs.length,
    });
  } catch (error) {
    console.error('Error listing runs:', error);
    res.status(500).json({
      error: 'Failed to list runs',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// Start server
if (process.env.NODE_ENV !== 'test') {
app.listen(PORT, () => {
  console.log(`Cold Agent server running on http://localhost:${PORT}`);
  console.log('');
  console.log('Endpoints:');
    console.log(`  POST /runs                 - Start a new run`);
    console.log(`  POST /runs/batch           - Start multiple runs at once`);
    console.log(`  POST /personas/questions   - Generate persona missions`);
    console.log(`  POST /personas/runs        - Generate persona missions + start runs`);
    console.log(`  GET  /runs                 - List all runs`);
    console.log(`  GET  /runs/:runId          - Get run report (JSON)`);
    console.log(`  GET  /runs/:runId/report   - Human-friendly run report (HTML)`);
    console.log(`  POST /runs/:runId/issues/github - Create GitHub issue from run`);
    console.log(`  GET  /health               - Health check`);
  console.log('');
  console.log('Example:');
  console.log(`  curl -X POST http://localhost:${PORT}/runs \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"baseUrl": "https://example.com", "goal": "Find the contact page"}'`);
});
}

export default app;
