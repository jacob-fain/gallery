import type { ReviewStatus } from '../types';

/** The order the admin's actions and filters list the states in. */
export const REVIEW_STATUSES: readonly ReviewStatus[] = ['review', 'shown', 'rejected'];

/** How a state reads on a badge, a filter pill and the viewer's label. */
export const STATUS_LABELS: Record<ReviewStatus, string> = {
  review: 'Needs review',
  shown: 'Shown',
  rejected: 'Rejected',
};

/** The action that puts a photo in each state. */
export const STATUS_ACTIONS: Record<ReviewStatus, string> = {
  review: 'Back to review',
  shown: 'Show on site',
  rejected: 'Reject',
};

/** What the admin's undo toast says a state change did. */
export const STATUS_DONE: Record<ReviewStatus, string> = {
  review: 'Moved to review',
  shown: 'Shown on site',
  rejected: 'Rejected',
};

/** What an admin list filtered to a state (or to all, null) says when empty. */
export const emptyListMessage = (filter: ReviewStatus | null): string =>
  filter === 'review'
    ? 'No photos need review.'
    : filter === 'shown'
      ? 'No photos are shown on the site.'
      : filter === 'rejected'
        ? 'No rejected photos.'
        : 'No photos yet.';

export const isShown = (photo: { review_status: ReviewStatus }): boolean => photo.review_status === 'shown';
