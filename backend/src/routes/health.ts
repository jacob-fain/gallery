import { Router, Request, Response } from 'express';
import { query } from '../config/db';

/**
 * Opaque id of the running build, set by the image build (BUILD_ID) so a
 * deploy can confirm the new release answers. It is a hash, not a version,
 * so the public route does not reveal what is running.
 */
export const buildId = (): string => process.env.BUILD_ID || 'dev';

type Probe = () => Promise<unknown>;
type ReadyResult = { ok: true } | { ok: false; reason: string };

/**
 * Database readiness with a timeout, cached briefly and shared by concurrent
 * callers, so a hung database holds at most one pool connection however
 * often the route is polled.
 */
export const createReadiness = ({
  probe,
  timeoutMs = 2000,
  cacheMs = 5000,
}: {
  probe: Probe;
  timeoutMs?: number;
  cacheMs?: number;
}) => {
  let cached: { at: number; result: ReadyResult } | null = null;
  let inFlight: Promise<ReadyResult> | null = null;

  const run = async (): Promise<ReadyResult> => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<ReadyResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: 'database timed out' }), timeoutMs);
    });
    const attempt = probe().then(
      (): ReadyResult => ({ ok: true }),
      (err): ReadyResult => {
        console.error('Readiness probe failed:', err);
        return { ok: false, reason: 'database unreachable' };
      }
    );
    try {
      return await Promise.race([attempt, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };

  return async (): Promise<ReadyResult> => {
    if (cached && Date.now() - cached.at < cacheMs) return cached.result;
    if (!inFlight) {
      inFlight = run().then((result) => {
        cached = { at: Date.now(), result };
        inFlight = null;
        return result;
      });
    }
    return inFlight;
  };
};

const checkReady = createReadiness({ probe: () => query('SELECT 1') });

const router = Router();

// Liveness: the process answers. Uptime monitoring watches this path.
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), build: buildId() });
});

// Readiness: the database answers too. Deploys wait on this route for the
// new build id before treating a release as live.
router.get('/health/ready', async (_req: Request, res: Response) => {
  const result = await checkReady();
  res.set('Cache-Control', 'no-store');
  if (result.ok) {
    res.json({ status: 'ok', build: buildId() });
  } else {
    res.status(503).json({ status: 'unavailable', reason: result.reason, build: buildId() });
  }
});

export default router;
