import { describe, expect, it } from 'vitest';
import { webpKeysFor } from './backfill-webp';

describe('webpKeysFor', () => {
  it('keeps an unassigned photo in its existing folder, not galleries/null', () => {
    expect(
      webpKeysFor({
        id: 'p1',
        s3_key: 'galleries/unassigned/f1/original.jpg',
        s3_web_key: 'galleries/unassigned/f1/web.jpg',
      })
    ).toEqual({
      web: 'galleries/unassigned/f1/web.webp',
      thumbnail: 'galleries/unassigned/f1/thumb.webp',
    });
  });

  it('keeps a moved photo in the folder it was uploaded to, named by its folder id', () => {
    expect(
      webpKeysFor({ id: 'p2', s3_key: 'galleries/g-old/f2/original.jpg', s3_web_key: 'galleries/g-old/f2/web.jpg' })
    ).toEqual({
      web: 'galleries/g-old/f2/web.webp',
      thumbnail: 'galleries/g-old/f2/thumb.webp',
    });
  });

  it("falls back to the original's folder, and refuses a photo with neither", () => {
    expect(webpKeysFor({ id: 'p3', s3_key: 'galleries/g/f3/original.jpg', s3_web_key: 'web.jpg' })).toEqual({
      web: 'galleries/g/f3/web.webp',
      thumbnail: 'galleries/g/f3/thumb.webp',
    });
    expect(() => webpKeysFor({ id: 'p4', s3_key: 'original.jpg', s3_web_key: 'web.jpg' })).toThrow(
      'Photo p4 has no key folder'
    );
  });
});
