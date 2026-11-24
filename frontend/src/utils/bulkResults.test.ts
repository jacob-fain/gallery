import { describe, expect, it } from 'vitest';
import { describeFailures, isPhotoGone, settleBulk } from './bulkResults';

const ok = { status: 'fulfilled', value: null } as const;
const fail = (message: string) => ({ status: 'rejected', reason: new Error(message) }) as const;

describe('settleBulk', () => {
  it('separates successes from failures, keeping ids aligned', () => {
    const outcome = settleBulk(['a', 'b', 'c'], [ok, fail('Server error'), ok]);
    expect(outcome).toEqual({ done: ['a', 'c'], failed: [{ id: 'b', message: 'Server error' }] });
  });

  it('counts an already-deleted photo as done, so a retry cannot get stuck on it', () => {
    const outcome = settleBulk(['a', 'b'], [fail('Photo not found'), fail('Server error')], isPhotoGone);
    expect(outcome.done).toEqual(['a']);
    expect(outcome.failed.map((f) => f.id)).toEqual(['b']);
  });
});

describe('describeFailures', () => {
  it('says nothing when everything succeeded', () => {
    expect(describeFailures('Deleted', 'deleted', { done: ['a'], failed: [] })).toBeNull();
  });

  it('reports counts and the first reason', () => {
    const message = describeFailures('Deleted', 'deleted', {
      done: ['a', 'b'],
      failed: [{ id: 'c', message: 'Failed to delete photo' }],
    });
    expect(message).toBe(
      'Deleted 2 of 3. 1 could not be deleted (Failed to delete photo) and stay selected so you can try again.'
    );
  });

  it('uses the participle for verbs whose past tense differs', () => {
    expect(
      describeFailures('Hid', 'hidden', { done: ['a'], failed: [{ id: 'b', message: 'x' }] })
    ).toMatch(/^Hid 1 of 2\. 1 could not be hidden/);
  });
});
