// The footer links to these settings directly, so a stored value must be safe
// to put in an href as is. An empty string clears a link.

const MAX_URL_LENGTH = 2048;
const MAX_EMAIL_LENGTH = 254;

// Deliberately narrower than RFC 5321: it leaves out characters such as "?"
// and "&" that would add headers to the footer's mailto: link.
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export const INSTAGRAM_URL_ERROR = 'Instagram link must be an https://instagram.com address';
export const CONTACT_EMAIL_ERROR = 'Contact email must be a valid email address';

export function isInstagramUrl(value: string): boolean {
  if (value.length > MAX_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    (host === 'instagram.com' || host.endsWith('.instagram.com'))
  );
}

export function isContactEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}

export interface SiteLinksInput {
  instagram_url?: unknown;
  contact_email?: unknown;
}

export type SiteLinksResult =
  | { ok: true; values: { instagram_url?: string; contact_email?: string } }
  | { ok: false; error: string };

/**
 * Checks the link settings in an update. A field left out stays as stored;
 * a field sent is trimmed, and must be empty or valid.
 */
export function validateSiteLinks(input: SiteLinksInput): SiteLinksResult {
  const values: { instagram_url?: string; contact_email?: string } = {};

  if (input.instagram_url !== undefined) {
    if (typeof input.instagram_url !== 'string') return { ok: false, error: INSTAGRAM_URL_ERROR };
    const url = input.instagram_url.trim();
    if (url && !isInstagramUrl(url)) return { ok: false, error: INSTAGRAM_URL_ERROR };
    values.instagram_url = url;
  }

  if (input.contact_email !== undefined) {
    if (typeof input.contact_email !== 'string') return { ok: false, error: CONTACT_EMAIL_ERROR };
    const email = input.contact_email.trim();
    if (email && !isContactEmail(email)) return { ok: false, error: CONTACT_EMAIL_ERROR };
    values.contact_email = email;
  }

  return { ok: true, values };
}
