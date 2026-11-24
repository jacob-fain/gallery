import { withTransaction } from '../config/db';
import { DASHBOARD_TIMEZONE } from './analyticsService';

/**
 * Raw analytics_events rows are kept this many days, then deleted. Every
 * deleted day has already been counted into analytics_daily, so the
 * dashboard reads the same numbers from the rollup.
 */
export const RETENTION_DAYS = 365;

/**
 * A day is rolled up only once it ended this long ago. Events are stamped
 * with the database clock at insert, so the margin only has to outlast an
 * insert that started before midnight and commits after it, which the 10 s
 * statement_timeout bounds.
 */
const SETTLE_MARGIN = '1 hour';

/** Days rolled up per transaction, so a first run over a large backlog stays short. */
const CHUNK_DAYS = 31;

/** Arbitrary key shared by every backend instance; only one may roll up at a time. */
export const ROLLUP_LOCK_KEY = 7_613_201;

const RUN_EVERY_MS = 6 * 60 * 60 * 1000;

export interface RollupResult {
  /** False when another instance holds the lock; nothing was changed. */
  ran: boolean;
  rolledThrough: string | null;
  deleted: number;
}

/**
 * Advances the rollup by at most CHUNK_DAYS days and deletes raw events that
 * are both past retention and already rolled up, in one transaction. The
 * rollup insert and the watermark move commit together, so a day is never
 * counted twice or skipped, and a crash mid-run changes nothing.
 */
const rollupChunk = async (now: Date): Promise<RollupResult & { done: boolean }> =>
  withTransaction(async (client) => {
    const lock = await client.query(`SELECT pg_try_advisory_xact_lock($1) AS ok`, [ROLLUP_LOCK_KEY]);
    if (!lock.rows[0].ok) return { ran: false, rolledThrough: null, deleted: 0, done: true };

    // A background job, not a request: a chunk over a busy month may need
    // longer than the pool's per-request statement_timeout.
    await client.query(`SET LOCAL statement_timeout = '120s'`);

    const { rows } = await client.query(
      `WITH state AS (
         SELECT rolled_through FROM analytics_rollup_state FOR UPDATE
       ),
       target AS (
         SELECT (($2::timestamptz - $3::interval) AT TIME ZONE $1)::date AS day
       )
       SELECT to_char(state.rolled_through, 'YYYY-MM-DD') AS rolled_through,
              to_char(COALESCE(
                state.rolled_through,
                (SELECT (MIN(created_at) AT TIME ZONE $1)::date FROM analytics_events)
              ), 'YYYY-MM-DD') AS start,
              to_char(target.day, 'YYYY-MM-DD') AS target
       FROM state, target`,
      [DASHBOARD_TIMEZONE, now, SETTLE_MARGIN]
    );
    let rolledThrough: string | null = rows[0].rolled_through;
    const start: string | null = rows[0].start;
    const target: string = rows[0].target;

    let done = true;
    if (start !== null && start < target) {
      const { rows: end } = await client.query(
        `SELECT to_char(LEAST($1::date + $2::int, $3::date), 'YYYY-MM-DD') AS day`,
        [start, CHUNK_DAYS, target]
      );
      const chunkEnd: string = end[0].day;
      await client.query(
        `INSERT INTO analytics_daily (day, event_type, gallery_id, photo_id, count)
         SELECT (created_at AT TIME ZONE $1)::date, event_type, gallery_id, photo_id, COUNT(*)
         FROM analytics_events
         WHERE created_at >= $2::date::timestamp AT TIME ZONE $1
           AND created_at < $3::date::timestamp AT TIME ZONE $1
         GROUP BY 1, 2, 3, 4`,
        [DASHBOARD_TIMEZONE, start, chunkEnd]
      );
      await client.query(`UPDATE analytics_rollup_state SET rolled_through = $1`, [chunkEnd]);
      rolledThrough = chunkEnd;
      done = chunkEnd >= target;
    }

    let deleted = 0;
    if (rolledThrough !== null) {
      // Only days before the watermark are deleted, so retention can never
      // remove an event the rollup has not counted.
      const result = await client.query(
        `DELETE FROM analytics_events
         WHERE created_at < LEAST(
           $2::date,
           (($3::timestamptz AT TIME ZONE $1)::date - $4::int)
         )::timestamp AT TIME ZONE $1`,
        [DASHBOARD_TIMEZONE, rolledThrough, now, RETENTION_DAYS]
      );
      deleted = result.rowCount ?? 0;
    }

    return { ran: true, rolledThrough, deleted, done };
  });

/**
 * Rolls up every complete day not yet rolled up, then applies retention.
 * Safe to run from several instances at once: the one that does not get the
 * advisory lock returns without touching anything.
 */
export const runAnalyticsRollup = async (now: Date = new Date()): Promise<RollupResult> => {
  let total: RollupResult = { ran: false, rolledThrough: null, deleted: 0 };
  for (;;) {
    const { done, ...chunk } = await rollupChunk(now);
    if (!chunk.ran) return total.ran ? total : chunk;
    total = { ran: true, rolledThrough: chunk.rolledThrough, deleted: total.deleted + chunk.deleted };
    if (done) return total;
  }
};

/**
 * Runs the rollup now and every RUN_EVERY_MS inside this process. stop()
 * cancels the schedule and resolves once a run in progress has finished.
 */
export const scheduleAnalyticsRollup = (log: (message: string) => void = console.log) => {
  let current: Promise<void> | null = null;

  const runOnce = () => {
    if (current) return;
    current = runAnalyticsRollup()
      .then((result) => {
        if (result.ran && result.deleted > 0) {
          log(`Analytics rollup through ${result.rolledThrough}, deleted ${result.deleted} raw events`);
        }
      })
      .catch((err: unknown) => {
        console.error('Analytics rollup failed:', err instanceof Error ? err.message : err);
      })
      .finally(() => {
        current = null;
      });
  };

  runOnce();
  const timer = setInterval(runOnce, RUN_EVERY_MS);
  timer.unref();

  return {
    stop: async () => {
      clearInterval(timer);
      await current;
    },
  };
};
