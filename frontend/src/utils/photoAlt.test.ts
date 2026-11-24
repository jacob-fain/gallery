import { describe, expect, it } from 'vitest';
import { photoAlt } from './photoAlt';

describe('photoAlt', () => {
  it('numbers the photo from one and names the gallery', () => {
    expect(photoAlt(2, 24, 'Iceland 2025')).toBe('Photo 3 of 24 in Iceland 2025');
  });

  it('leaves out the gallery when there is no title', () => {
    expect(photoAlt(0, 5)).toBe('Photo 1 of 5');
    expect(photoAlt(0, 5, null)).toBe('Photo 1 of 5');
  });

  it('treats a blank title as no title', () => {
    expect(photoAlt(4, 5, '   ')).toBe('Photo 5 of 5');
  });

  it('trims the title', () => {
    expect(photoAlt(0, 1, '  Weddings ')).toBe('Photo 1 of 1 in Weddings');
  });
});
