import { Request, Response } from 'express';
import pool, { query } from '../config/db';
import { logger } from '../utils/logger';
import { uploadSlots } from '../services/imageService';
import { requestMetrics } from '../services/requestMetrics';
import { clientErrorMetrics } from '../services/clientErrorMetrics';
import { buildId } from '../routes/health';

type PoolCounts = { totalCount: number; idleCount: number; waitingCount: number };

/**
 * A snapshot of this process for the admin: what build it runs, request
 * counts and latency per route and browser error reports over the last hour,
 * database pool use and the upload queue. Everything is read from memory,
 * so the route is cheap enough to poll. Commit, version and schema are
 * admin-only; the public health routes report only the opaque build id.
 */
export const metricsSnapshot = ({
  db = pool as PoolCounts,
  uploads = uploadSlots,
  requests = requestMetrics,
  clientErrors = clientErrorMetrics,
  env = process.env,
  uptimeSeconds = process.uptime(),
  memory = process.memoryUsage(),
}: {
  db?: PoolCounts;
  uploads?: { running: number; queued: number; limit: number };
  requests?: { summarize: typeof requestMetrics.summarize };
  clientErrors?: { summarize: typeof clientErrorMetrics.summarize };
  env?: NodeJS.ProcessEnv;
  uptimeSeconds?: number;
  memory?: NodeJS.MemoryUsage;
} = {}) => ({
  build: { id: buildId(), commit: env.GIT_SHA || null, version: env.APP_VERSION || null },
  uptimeSeconds: Math.round(uptimeSeconds),
  memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed },
  db: { total: db.totalCount, idle: db.idleCount, waiting: db.waitingCount },
  uploads: { running: uploads.running, queued: uploads.queued, limit: uploads.limit },
  requests: requests.summarize(),
  clientErrors: clientErrors.summarize(),
});

/**
 * The newest migration recorded in _migrations. A database the runner has
 * never touched has no _migrations table, which reads as none applied.
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

export const getMetrics = async (_req: Request, res: Response) => {
  // The snapshot is still useful with the database down, so a failed lookup
  // reports the schema as unknown instead of failing the route.
  let migration: string | null = null;
  try {
    migration = await latestMigration();
  } catch (err) {
    logger.warn('metrics could not read _migrations', { err });
  }
  res.json({ success: true, data: { ...metricsSnapshot(), migration } });
};
