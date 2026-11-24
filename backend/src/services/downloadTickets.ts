import crypto from 'crypto';
import type { Gallery, GalleryAccessPayload } from '../types';

/**
 * One-time tickets for a private gallery's ZIP. The ZIP is a browser
 * navigation, which cannot carry the access token header, and a token in the
 * URL would reach nginx's error log. A ticket in the URL is worth little to
 * anyone who reads it there: it opens one download, within a minute.
 *
 * Kept in this process's memory, which holds because the API runs as one
 * process. A restart drops the open tickets; the page asks for a new one on
 * the next click.
 */
export const DOWNLOAD_TICKET_TTL_MS = 60 * 1000;

// Bounds memory: only a visitor holding a valid access token can add one,
// but nothing stops that visitor asking many times a minute.
const MAX_TICKETS = 10_000;

interface Ticket {
  galleryId: string;
  accessVersion: number;
  expires: number;
}

const tickets = new Map<string, Ticket>();

const sweepExpired = (now: number): void => {
  for (const [ticket, entry] of tickets) {
    if (now >= entry.expires) tickets.delete(ticket);
  }
};

setInterval(() => sweepExpired(Date.now()), DOWNLOAD_TICKET_TTL_MS).unref();

const makeRoom = (now: number): void => {
  if (tickets.size < MAX_TICKETS) return;
  sweepExpired(now);
  // Map iterates in insertion order, so the first keys are the oldest.
  for (const ticket of tickets.keys()) {
    if (tickets.size < MAX_TICKETS) break;
    tickets.delete(ticket);
  }
};

/**
 * A ticket for one ZIP of the gallery the access token unlocks. It names the
 * token's access version, so a password or visibility change made before it
 * is used revokes it as it revokes the token.
 */
export const issueDownloadTicket = (
  access: Pick<GalleryAccessPayload, 'galleryId' | 'accessVersion'>,
  now = Date.now()
): string => {
  makeRoom(now);
  const ticket = crypto.randomBytes(32).toString('base64url');
  tickets.set(ticket, {
    galleryId: access.galleryId,
    accessVersion: access.accessVersion,
    expires: now + DOWNLOAD_TICKET_TTL_MS,
  });
  return ticket;
};

/**
 * Whether the ticket opens this gallery's ZIP as it is now. Any use spends
 * it, a refused one included, so a ticket is never tried twice.
 */
export const redeemDownloadTicket = (
  ticket: unknown,
  gallery: Pick<Gallery, 'id' | 'access_version'>,
  now = Date.now()
): boolean => {
  if (typeof ticket !== 'string') return false;
  const entry = tickets.get(ticket);
  if (!entry) return false;
  tickets.delete(ticket);
  return now < entry.expires && entry.galleryId === gallery.id && entry.accessVersion === gallery.access_version;
};
