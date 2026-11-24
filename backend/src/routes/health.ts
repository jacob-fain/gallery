import { Router, Request, Response } from 'express';
import { query } from '../config/db';
import { isS3Configured } from '../config/s3';
import { logger } from '../utils/logger';

/**
 * Opaque id of the running build, set by the image build (BUILD_ID) so a
 * deploy can confirm the new release answers. It is a hash, not a version,
 * so the public route does not reveal what is running.
 */
export const buildId = (): string => process.env.BUILD_ID || 'dev';

/** Resolves to the newest applied migration, or null when none is recorded. */
type Probe = () => Promise<string | null>;
type ReadyResult = { ok: true; migration: string | null } | { ok: false; reason: string };

/**
 * The newest migration recorded in _migrations. Answering it also proves the
 * database is up, so it is the readiness probe. A database the runner has
 * never touched has no _migrations table, which is not an outage.
 */
export const latestMigration = async (): Promise<string | null> => {
  try {
    const { rows } = await query('SELECT filename FROM _migrations ORDER BY filename DESC LIMIT 1');
    return (rows[0]?.filename as string | undefined) ?? null;
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') return null;
    throw err;
  }
};

/**
 * Database readiness with a timeout, cached briefly. At most one probe runs
 * at a time, so a hung database holds at most one pool connection however
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
  // The probe still running, if any. A timeout only stops waiting: a hung
  // query keeps its pool connection until it settles, so no new probe starts
  // while one is unsettled, and later checks wait on the same one.
  let probing: Promise<ReadyResult> | null = null;

  const startProbe = (): Promise<ReadyResult> => {
    if (!probing) {
      probing = probe()
        .then(
          (migration): ReadyResult => ({ ok: true, migration }),
          (err): ReadyResult => {
            logger.error('readiness probe failed', { err });
            return { ok: false, reason: 'database unreachable' };
          }
        )
        .finally(() => {
          probing = null;
        });
    }
    return probing;
  };

  const check = async (): Promise<ReadyResult> => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<ReadyResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: 'database timed out' }), timeoutMs);
    });
    try {
      return await Promise.race([startProbe(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };

  return async (): Promise<ReadyResult> => {
    if (cached && Date.now() - cached.at < cacheMs) return cached.result;
    const result = await check();
    cached = { at: Date.now(), result };
    return result;
  };
};

const checkReady = createReadiness({ probe: latestMigration });

const router = Router();

// Liveness: the process answers. Uptime monitoring watches this path.
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), build: buildId() });
});

// Readiness: the database answers too. Deploys wait on this route for the
// new build id before treating a release as live, and read "build" from the
// body with a pattern, so it stays a single flat key. S3 is reported from
// configuration only: calling S3 on every poll would cost requests and tie
// readiness to AWS latency.
router.get('/health/ready', async (_req: Request, res: Response) => {
  const result = await checkReady();
  res.set('Cache-Control', 'no-store');
  const s3 = isS3Configured() ? 'configured' : 'not configured';
  if (result.ok) {
    res.json({ status: 'ok', build: buildId(), s3, migration: result.migration });
  } else {
    res.status(503).json({ status: 'unavailable', reason: result.reason, build: buildId(), s3 });
  }
});

export default router;
