import { describe, expect, it } from 'vitest';
import {
  attachmentDisposition,
  createNameDeduper,
  sanitizeFilename,
  zipEntryNames,
} from './downloadNames';

describe('sanitizeFilename', () => {
  it('keeps an ordinary camera filename', () => {
    expect(sanitizeFilename('IMG_0001.JPG', 'x.jpg')).toBe('IMG_0001.JPG');
  });

  it('keeps unicode and spaces', () => {
    expect(sanitizeFilename('Brautpaar Küste 01.jpg', 'x.jpg')).toBe('Brautpaar Küste 01.jpg');
  });

  it('drops directories and traversal from either slash style', () => {
    expect(sanitizeFilename('../../etc/passwd', 'x.jpg')).toBe('passwd');
    expect(sanitizeFilename('..\\..\\Windows\\win.ini', 'x.jpg')).toBe('win.ini');
    expect(sanitizeFilename('/abs/path/photo.jpg', 'x.jpg')).toBe('photo.jpg');
  });

  it('replaces characters Windows refuses and control characters', () => {
    expect(sanitizeFilename('a<b>c:d"e|f?g*h\u0007.jpg', 'x.jpg')).toBe('a_b_c_d_e_f_g_h_.jpg');
  });

  it('strips leading dots and trailing dots or spaces', () => {
    expect(sanitizeFilename('.hidden.jpg', 'x.jpg')).toBe('hidden.jpg');
    expect(sanitizeFilename('photo.jpg. . ', 'x.jpg')).toBe('photo.jpg');
  });

  it('falls back when nothing usable is left', () => {
    for (const raw of ['', '..', '.', '/', 'dir/', '   ', null, undefined]) {
      expect(sanitizeFilename(raw, 'p1.jpg')).toBe('p1.jpg');
    }
  });

  it('shortens very long names but keeps the extension', () => {
    const name = sanitizeFilename(`${'a'.repeat(300)}.jpeg`, 'x.jpg');
    expect(name.length).toBe(120);
    expect(name.endsWith('.jpeg')).toBe(true);
  });
});

describe('createNameDeduper', () => {
  it('suffixes repeats before the extension', () => {
    const unique = createNameDeduper();
    expect(['IMG_0001.JPG', 'IMG_0001.JPG', 'IMG_0001.JPG'].map(unique)).toEqual([
      'IMG_0001.JPG',
      'IMG_0001 (2).JPG',
      'IMG_0001 (3).JPG',
    ]);
  });

  it('treats names that differ only in case as the same file', () => {
    const unique = createNameDeduper();
    expect(unique('img.jpg')).toBe('img.jpg');
    expect(unique('IMG.JPG')).toBe('IMG (2).JPG');
  });

  it('never reuses a name that was taken literally', () => {
    const unique = createNameDeduper();
    expect(['a (2).jpg', 'a.jpg', 'a.jpg', 'a (2).jpg'].map(unique)).toEqual([
      'a (2).jpg',
      'a.jpg',
      'a (3).jpg',
      'a (2) (2).jpg',
    ]);
  });

  it('handles names without an extension', () => {
    const unique = createNameDeduper();
    expect(['scan', 'scan'].map(unique)).toEqual(['scan', 'scan (2)']);
  });
});

describe('zipEntryNames', () => {
  it('gives every photo a distinct safe name', () => {
    const names = zipEntryNames([
      { id: 'p1', original_filename: 'IMG_0001.JPG' },
      { id: 'p2', original_filename: 'card2/IMG_0001.JPG' },
      { id: 'p3', original_filename: '' },
      { id: 'p4', original_filename: '../IMG_0001.JPG' },
    ]);
    expect(names).toEqual(['IMG_0001.JPG', 'IMG_0001 (2).JPG', 'p3.jpg', 'IMG_0001 (3).JPG']);
  });
});

describe('attachmentDisposition', () => {
  it('sends a plain name as both forms', () => {
    expect(attachmentDisposition('wedding.zip')).toBe(
      `attachment; filename="wedding.zip"; filename*=UTF-8''wedding.zip`
    );
  });

  it('encodes unicode for filename* and gives an ASCII fallback', () => {
    expect(attachmentDisposition('Küste (1).jpg')).toBe(
      `attachment; filename="K_ste (1).jpg"; filename*=UTF-8''K%C3%BCste%20%281%29.jpg`
    );
  });

  it('cannot be broken out of with quotes or backslashes', () => {
    expect(attachmentDisposition('a"b\\c.jpg')).toBe(
      `attachment; filename="a_b_c.jpg"; filename*=UTF-8''a%22b%5Cc.jpg`
    );
  });
});
