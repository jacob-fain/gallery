import { describe, expect, it } from 'vitest';
import {
  ADMIN_PAGE_MAX,
  PUBLIC_PAGE_MAX,
  decodeCursor,
  encodeCursor,
  nextOffset,
  parseAdminPage,
  parsePublicPage,
} from './photoPaging';

const cursor = { uploadedAt: '2026-11-24T10:15:30.123456Z', id: '22222222-2222-4222-8222-222222222222' };

describe('public cursors', () => {
  it('round-trip with microseconds intact', () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each([
    ['not base64 of anything', 'garbage!'],
    ['a millisecond timestamp', Buffer.from(`2026-11-24T10:15:30.123Z|${cursor.id}`).toString('base64url')],
    ['a non-uuid id', Buffer.from(`${cursor.uploadedAt}|1 OR 1=1`).toString('base64url')],
    ['extra fields', Buffer.from(`${cursor.uploadedAt}|${cursor.id}|x`).toString('base64url')],
  ])('refuse %s', (_name, value) => {
    expect(decodeCursor(value)).toBeNull();
  });
});

describe('parsePublicPage', () => {
  it('sends the largest page when no limit is given', () => {
    expect(parsePublicPage({})).toEqual({ ok: true, value: { limit: PUBLIC_PAGE_MAX, after: null } });
  });

  it('lowers a limit above the maximum instead of refusing it', () => {
    expect(parsePublicPage({ limit: '100000' })).toEqual({
      ok: true,
      value: { limit: PUBLIC_PAGE_MAX, after: null },
    });
  });

  it('reads a cursor', () => {
    expect(parsePublicPage({ limit: '10', cursor: encodeCursor(cursor) })).toEqual({
      ok: true,
      value: { limit: 10, after: cursor },
    });
  });

  it.each([{ limit: '0' }, { limit: '-1' }, { limit: '2.5' }, { limit: 'ten' }, { limit: ['1', '2'] }])(
    'refuses limit %j',
    (q) => {
      expect(parsePublicPage(q)).toEqual({ ok: false, error: 'limit must be a positive integer' });
    }
  );

  it('refuses a cursor it did not make', () => {
    expect(parsePublicPage({ cursor: 'abc' })).toEqual({ ok: false, error: 'cursor is not valid' });
  });
});

describe('parseAdminPage', () => {
  it('means the whole list when no limit is given', () => {
    expect(parseAdminPage({})).toEqual({ ok: true, value: null });
  });

  it('reads a page and caps its size', () => {
    expect(parseAdminPage({ limit: '50', offset: '100' })).toEqual({ ok: true, value: { limit: 50, offset: 100 } });
    expect(parseAdminPage({ limit: '5000', offset: '0' })).toEqual({
      ok: true,
      value: { limit: ADMIN_PAGE_MAX, offset: 0 },
    });
  });

  it.each([
    [{ offset: '10' }, 'offset needs a limit'],
    [{ limit: '0' }, 'limit must be a positive integer'],
    [{ limit: '10', offset: '-5' }, 'offset must be a non-negative integer'],
    [{ limit: '10', offset: 'x' }, 'offset must be a non-negative integer'],
  ])('refuses %j', (q, error) => {
    expect(parseAdminPage(q)).toEqual({ ok: false, error });
  });
});

describe('nextOffset', () => {
  it('points past this page until the list is exhausted', () => {
    expect(nextOffset(0, 100, 250)).toBe(100);
    expect(nextOffset(200, 50, 250)).toBeNull();
    expect(nextOffset(300, 0, 250)).toBeNull();
  });
});
