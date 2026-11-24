// Same rules as backend/src/services/siteLinks.ts, which is what enforces
// them; checking here only lets the form name the field before a round trip.

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export const INSTAGRAM_URL_ERROR = 'Instagram link must be an https://instagram.com address';
export const CONTACT_EMAIL_ERROR = 'Contact email must be a valid email address';

export function isInstagramUrl(value: string): boolean {
  if (value.length > 2048) return false;
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
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

/** The first problem with the link settings, or null. Empty values are allowed. */
export function siteLinksError(instagramUrl: string, contactEmail: string): string | null {
  const url = instagramUrl.trim();
  if (url && !isInstagramUrl(url)) return INSTAGRAM_URL_ERROR;
  const email = contactEmail.trim();
  if (email && !isContactEmail(email)) return CONTACT_EMAIL_ERROR;
  return null;
}
