/**
 * Recent request timings held in memory for the admin metrics route. A fixed
 * ring buffer keeps memory bounded whatever the traffic: once it is full the
 * oldest sample is overwritten, so under heavy load the summary covers less
 * than the full window and says so through `since`.
 */

export interface RequestSample {
  at: number;
  method: string;
  route: string;
  status: number;
  durationMs: number;
}

export interface RouteSummary {
  route: string;
  count: number;
  clientErrors: number;
  serverErrors: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface RequestSummary {
  windowSeconds: number;
  /** Time of the oldest sample summarized, or null when there are none. */
  since: string | null;
  total: number;
  serverErrors: number;
  routes: RouteSummary[];
}

/** Nearest-rank percentile of an ascending list. */
export const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
};

const round = (ms: number) => Math.round(ms * 10) / 10;

export const createRequestMetrics = ({
  capacity = 20_000,
  windowMs = 60 * 60 * 1000,
  now = () => Date.now(),
}: { capacity?: number; windowMs?: number; now?: () => number } = {}) => {
  const buffer: (RequestSample | undefined)[] = new Array(capacity);
  let next = 0;

  const record = (sample: Omit<RequestSample, 'at'>) => {
    buffer[next] = { ...sample, at: now() };
    next = (next + 1) % capacity;
  };

  const summarize = (): RequestSummary => {
    const cutoff = now() - windowMs;
    const byRoute = new Map<string, { durations: number[]; client: number; server: number }>();
    let oldest = Infinity;
    let total = 0;
    let serverErrors = 0;
    for (const s of buffer) {
      if (!s || s.at < cutoff) continue;
      total += 1;
      if (s.at < oldest) oldest = s.at;
      const key = `${s.method} ${s.route}`;
      let entry = byRoute.get(key);
      if (!entry) {
        entry = { durations: [], client: 0, server: 0 };
        byRoute.set(key, entry);
      }
      entry.durations.push(s.durationMs);
      if (s.status >= 500) {
        entry.server += 1;
        serverErrors += 1;
      } else if (s.status >= 400) {
        entry.client += 1;
      }
    }
    const routes = [...byRoute.entries()]
      .map(([route, e]): RouteSummary => {
        const sorted = e.durations.sort((a, b) => a - b);
        return {
          route,
          count: sorted.length,
          clientErrors: e.client,
          serverErrors: e.server,
          p50Ms: round(percentile(sorted, 50)),
          p95Ms: round(percentile(sorted, 95)),
          maxMs: round(sorted[sorted.length - 1]),
        };
      })
      .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route));
    return {
      windowSeconds: windowMs / 1000,
      since: total > 0 ? new Date(oldest).toISOString() : null,
      total,
      serverErrors,
      routes,
    };
  };

  return { record, summarize };
};

export const requestMetrics = createRequestMetrics();
