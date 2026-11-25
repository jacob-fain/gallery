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

export const isShown = (photo: { review_status: ReviewStatus }): boolean => photo.review_status === 'shown';
