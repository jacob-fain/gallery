import { describe, expect, it } from 'vitest';
import { Semaphore } from './semaphore';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('Semaphore', () => {
  it('runs up to the limit at once and queues the rest in order', async () => {
    const slots = new Semaphore(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    const runs = gates.map((gate, i) =>
      slots.run(async () => {
        started.push(i);
        await gate.promise;
        return i;
      })
    );

    await flush();
    expect(started).toEqual([0, 1]);
    expect(slots.running).toBe(2);
    expect(slots.queued).toBe(2);

    gates[1].resolve();
    await flush();
    expect(started).toEqual([0, 1, 2]);
    expect(slots.running).toBe(2);

    gates[0].resolve();
    gates[2].resolve();
    gates[3].resolve();
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
    expect(slots.running).toBe(0);
    expect(slots.queued).toBe(0);
  });

  it('releases the slot when a task throws', async () => {
    const slots = new Semaphore(1);
    await expect(slots.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(slots.running).toBe(0);
    expect(await slots.run(async () => 'next')).toBe('next');
  });

  it('gives a freed slot to the queue before a later caller', async () => {
    const slots = new Semaphore(1);
    const first = deferred();
    const order: string[] = [];
    const a = slots.run(async () => {
      await first.promise;
      order.push('a');
    });
    const b = slots.run(async () => {
      order.push('b');
    });
    first.resolve();
    await a;
    const c = slots.run(async () => {
      order.push('c');
    });
    await Promise.all([b, c]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('refuses a limit below one', () => {
    expect(() => new Semaphore(0)).toThrow();
  });
});
