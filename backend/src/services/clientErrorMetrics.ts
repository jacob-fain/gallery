/**
 * Times of recent browser error reports, held in memory for the admin
 * metrics route. A fixed ring buffer bounds memory: past `capacity` reports
 * in the window the count reads as `capacity`, which the per-visitor rate
 * limit makes unlikely outside an attack.
 */
export const createEventCounter = ({
  capacity = 10_000,
  windowMs = 60 * 60 * 1000,
  now = () => Date.now(),
}: { capacity?: number; windowMs?: number; now?: () => number } = {}) => {
  const times = new Array<number>(capacity).fill(-Infinity);
  let next = 0;

  const record = () => {
    times[next] = now();
    next = (next + 1) % capacity;
  };

  const summarize = () => {
    const cutoff = now() - windowMs;
    let count = 0;
    for (const at of times) if (at >= cutoff) count += 1;
    return { windowSeconds: windowMs / 1000, count };
  };

  return { record, summarize };
};

export const clientErrorMetrics = createEventCounter();
