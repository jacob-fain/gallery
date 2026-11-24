/**
 * Splits the results of a batch of per-item requests into the ids that are
 * done and the ones that failed. An error isGone() recognizes (for example
 * "Photo not found" on a delete) counts as done: the item is already in the
 * wanted state, so a retry must not keep failing on it.
 */
export interface BulkOutcome {
  done: string[];
  failed: { id: string; message: string }[];
}

export function settleBulk(
  ids: string[],
  results: PromiseSettledResult<unknown>[],
  isGone: (error: unknown) => boolean = () => false
): BulkOutcome {
  const outcome: BulkOutcome = { done: [], failed: [] };
  results.forEach((result, i) => {
    const id = ids[i];
    if (result.status === 'fulfilled' || isGone(result.reason)) {
      outcome.done.push(id);
    } else {
      const message = result.reason instanceof Error ? result.reason.message : 'Request failed';
      outcome.failed.push({ id, message });
    }
  });
  return outcome;
}

/** One line for the admin after a batch, or null when everything succeeded. */
export function describeFailures(
  verb: string,
  participle: string,
  outcome: BulkOutcome
): string | null {
  if (outcome.failed.length === 0) return null;
  const total = outcome.done.length + outcome.failed.length;
  return (
    `${verb} ${outcome.done.length} of ${total}. ` +
    `${outcome.failed.length} could not be ${participle} (${outcome.failed[0].message}) ` +
    'and stay selected so you can try again.'
  );
}

export const isPhotoGone = (error: unknown): boolean =>
  error instanceof Error && error.message === 'Photo not found';
