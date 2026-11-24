import { Request, Response } from 'express';
import pool from '../config/db';
import { uploadSlots } from '../services/imageService';
import { requestMetrics } from '../services/requestMetrics';
import { buildId } from '../routes/health';

type PoolCounts = { totalCount: number; idleCount: number; waitingCount: number };

/**
 * A snapshot of this process for the admin: what build it runs, request
 * counts and latency per route over the last hour, database pool use and the
 * upload queue. Everything is read from memory, so the route is cheap enough
 * to poll. Commit and version are admin-only; the public health routes
 * report only the opaque build id.
 */
export const metricsSnapshot = ({
  db = pool as PoolCounts,
  uploads = uploadSlots,
  requests = requestMetrics,
  env = process.env,
  uptimeSeconds = process.uptime(),
  memory = process.memoryUsage(),
}: {
  db?: PoolCounts;
  uploads?: { running: number; queued: number; limit: number };
  requests?: { summarize: typeof requestMetrics.summarize };
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
});

export const getMetrics = (_req: Request, res: Response) => {
  res.json({ success: true, data: metricsSnapshot() });
};
