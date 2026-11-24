import { describe, expect, it } from 'vitest';
import { DOWNLOAD_TICKET_TTL_MS, issueDownloadTicket, redeemDownloadTicket } from './downloadTickets';

const GALLERY = { id: '11111111-1111-4111-8111-111111111111', access_version: 2 };
const access = { galleryId: GALLERY.id, accessVersion: 2 };

describe('download tickets', () => {
  it('open the gallery they were issued for, once', () => {
    const ticket = issueDownloadTicket(access, 1000);
    expect(redeemDownloadTicket(ticket, GALLERY, 1000)).toBe(true);
    expect(redeemDownloadTicket(ticket, GALLERY, 1000)).toBe(false);
  });

  it('are random and carry nothing of the gallery', () => {
    const a = issueDownloadTicket(access);
    const b = issueDownloadTicket(access);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(a).not.toContain(GALLERY.id);
  });

  it('expire after their lifetime', () => {
    const live = issueDownloadTicket(access, 1000);
    expect(redeemDownloadTicket(live, GALLERY, 1000 + DOWNLOAD_TICKET_TTL_MS - 1)).toBe(true);
    const late = issueDownloadTicket(access, 1000);
    expect(redeemDownloadTicket(late, GALLERY, 1000 + DOWNLOAD_TICKET_TTL_MS)).toBe(false);
  });

  it("refuse another gallery, and are spent by the attempt", () => {
    const ticket = issueDownloadTicket(access);
    expect(redeemDownloadTicket(ticket, { ...GALLERY, id: '22222222-2222-4222-8222-222222222222' })).toBe(false);
    expect(redeemDownloadTicket(ticket, GALLERY)).toBe(false);
  });

  it('refuse a gallery whose access version has moved on', () => {
    const ticket = issueDownloadTicket(access);
    expect(redeemDownloadTicket(ticket, { ...GALLERY, access_version: 3 })).toBe(false);
  });

  it.each([undefined, '', 'unknown', ['a', 'b'], 42])('refuse %j', (value) => {
    expect(redeemDownloadTicket(value, GALLERY)).toBe(false);
  });
});
