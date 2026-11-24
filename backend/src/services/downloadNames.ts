// Characters Windows refuses in a filename, plus control characters. Extract
// tools on every platform write entries to disk, so a name has to be valid on
// the strictest one.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

// Keeps a name, plus a " (NN)" suffix, well under the common 255-byte limit
// even when every character takes several bytes in UTF-8.
const MAX_NAME_LENGTH = 120;

/**
 * Turns an uploaded filename into a safe single path component. Anything
 * before the last slash or backslash is dropped, so a stored name can never
 * place a file outside the folder it is extracted into.
 */
export const sanitizeFilename = (raw: string | null | undefined, fallback: string): string => {
  const base = (raw ?? '').split(/[/\\]/).pop() ?? '';
  let name = base
    .normalize('NFC')
    .replace(UNSAFE_CHARS, '_')
    .trim()
    // Leading dots hide the file on Unix; trailing dots and spaces are
    // stripped by Windows, which can make two distinct names collide.
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');

  if (name.length > MAX_NAME_LENGTH) {
    const { stem, ext } = splitExtension(name);
    const keptExt = ext.length <= 16 ? ext : '';
    name = Array.from(stem).slice(0, MAX_NAME_LENGTH - keptExt.length).join('') + keptExt;
  }

  return name || fallback;
};

const splitExtension = (name: string): { stem: string; ext: string } => {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
};

/**
 * Returns a function that hands out each name once, renaming repeats to
 * `name (2).ext`, `name (3).ext` and so on. Names are compared without case
 * because macOS and Windows filesystems treat IMG_1.JPG and img_1.jpg as the
 * same file.
 */
export const createNameDeduper = (): ((name: string) => string) => {
  const used = new Set<string>();
  return (name) => {
    let candidate = name;
    if (used.has(candidate.toLowerCase())) {
      const { stem, ext } = splitExtension(name);
      let n = 2;
      do {
        candidate = `${stem} (${n})${ext}`;
        n += 1;
      } while (used.has(candidate.toLowerCase()));
    }
    used.add(candidate.toLowerCase());
    return candidate;
  };
};

/**
 * ZIP entry names for a gallery's photos, in order: the sanitized original
 * filename, made unique within the archive.
 */
export const zipEntryNames = (
  photos: { id: string; original_filename: string | null }[]
): string[] => {
  const unique = createNameDeduper();
  return photos.map((photo) => unique(sanitizeFilename(photo.original_filename, `${photo.id}.jpg`)));
};

/**
 * A Content-Disposition attachment header. The quoted filename is an ASCII
 * fallback for old clients; filename* (RFC 5987) carries the real name.
 */
export const attachmentDisposition = (filename: string): string => {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
};
