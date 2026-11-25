/**
 * A photo's review state. New uploads start in review; only shown photos are
 * ever public. Rejected photos stay private until they are deleted.
 */
export const REVIEW_STATUSES = ['review', 'shown', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const isReviewStatus = (value: unknown): value is ReviewStatus =>
  typeof value === 'string' && (REVIEW_STATUSES as readonly string[]).includes(value);

/** How many photos of a list are in each state, and in all. */
export type StatusCounts = Record<ReviewStatus | 'all', number>;

export const emptyCounts = (): StatusCounts => ({ review: 0, shown: 0, rejected: 0, all: 0 });

/** Counts from rows of `SELECT review_status, COUNT(*)::int AS n ... GROUP BY review_status`. */
export const toStatusCounts = (rows: { review_status: string; n: number }[]): StatusCounts => {
  const counts = emptyCounts();
  for (const { review_status, n } of rows) {
    if (isReviewStatus(review_status)) counts[review_status] = n;
    counts.all += n;
  }
  return counts;
};

/**
 * ?status= on the admin lists: one state, or absent (or "all") for every
 * photo. Anything else is refused rather than ignored, so a typo never
 * shows the whole list as if it were filtered.
 */
export const parseStatusFilter = (
  value: unknown
): { ok: true; value: ReviewStatus | null } | { ok: false; error: string } => {
  if (value === undefined || value === 'all') return { ok: true, value: null };
  if (isReviewStatus(value)) return { ok: true, value };
  return { ok: false, error: 'status must be review, shown, rejected or all' };
};
