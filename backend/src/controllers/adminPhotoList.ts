import type { Request } from 'express';
import * as photoService from '../services/photoService';
import { nextOffset, parseAdminPage } from '../services/photoPaging';
import { parseStatusFilter } from '../services/reviewStatus';

/**
 * ?limit=, ?offset= and ?status= of an admin photo list, or the 400 to send.
 */
export const parseAdminListQuery = (q: Request['query']) => {
  const page = parseAdminPage(q);
  if (!page.ok) return page;
  const status = parseStatusFilter(q.status);
  if (!status.ok) return status;
  return { ok: true as const, value: { page: page.value, status: status.value } };
};

/** The body of an admin photo list: the page, its total, and the counts per state. */
export const adminListBody = async (
  result: photoService.PhotoPage,
  page: photoService.OffsetPage
) => ({
  success: true,
  data: await photoService.enrichPhotosWithUrls(result.photos),
  total: result.total,
  counts: result.counts,
  nextOffset: page ? nextOffset(page.offset, result.photos.length, result.total) : null,
});
