import express, { type Request, type Response, type NextFunction } from 'express';
import * as path from 'path';
import { RunCreateRequestSchema } from './types.js';
import { createRunOrchestrator } from './run/runOrchestrator.js';

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
app.listen(PORT, () => {
  console.log(`Cold Agent server running on http://localhost:${PORT}`);
  console.log('');
  console.log('Endpoints:');
  console.log(`  POST /runs          - Start a new run`);
  console.log(`  GET  /runs          - List all runs`);
  console.log(`  GET  /runs/:runId   - Get run report`);
  console.log(`  GET  /health        - Health check`);
  console.log('');
  console.log('Example:');
  console.log(`  curl -X POST http://localhost:${PORT}/runs \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"baseUrl": "https://example.com", "goal": "Find the contact page"}'`);
});

export default app;
