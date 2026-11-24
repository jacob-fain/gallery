import { describe, expect, it } from 'vitest';
import { createEventCounter } from './clientErrorMetrics';

describe('createEventCounter', () => {
  it('counts events inside the window only', () => {
    let t = 0;
    const counter = createEventCounter({ windowMs: 1000, now: () => t });
    counter.record();
    t = 500;
    counter.record();
    expect(counter.summarize()).toEqual({ windowSeconds: 1, count: 2 });
    t = 1200;
    expect(counter.summarize().count).toBe(1);
  });

  it('holds at most its capacity', () => {
    const counter = createEventCounter({ capacity: 3 });
    for (let i = 0; i < 5; i++) counter.record();
    expect(counter.summarize().count).toBe(3);
  });
});
