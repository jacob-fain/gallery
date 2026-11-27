import { describe, expect, it } from 'vitest';
import { seededOrder } from './shuffle';

const items = (ids: string[]) => ids.map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((item) => item.id);
const many = Array.from({ length: 200 }, (_, i) => `photo-${i}`);

describe('seededOrder', () => {
  it('deals every item exactly once', () => {
    const dealt = ids(seededOrder(items(many), 12345));
    expect(dealt).toHaveLength(many.length);
    expect(new Set(dealt).size).toBe(many.length);
    expect([...dealt].sort()).toEqual([...many].sort());
    expect(dealt).not.toEqual(many);
  });

  it('deals the same order from the same seed, whatever order the input is in', () => {
    const a = ids(seededOrder(items(many), 777));
    const b = ids(seededOrder(items([...many].reverse()), 777));
    expect(b).toEqual(a);
  });

  it('deals another order from another seed', () => {
    expect(ids(seededOrder(items(many), 1))).not.toEqual(ids(seededOrder(items(many), 2)));
  });

  it('keeps the others in place when items are added or dropped', () => {
    const dealt = ids(seededOrder(items(many), 4242));
    const dropped = new Set(['photo-3', 'photo-150']);
    const fewer = ids(seededOrder(items(many.filter((id) => !dropped.has(id))), 4242));
    expect(fewer).toEqual(dealt.filter((id) => !dropped.has(id)));
    const more = ids(seededOrder(items([...many, 'photo-new']), 4242));
    expect(more.filter((id) => id !== 'photo-new')).toEqual(dealt);
  });
});
