import type { StatusFilter } from '../../../api/client';
import type { StatusCounts } from '../../../types';
import { STATUS_LABELS } from '../../../utils/reviewStatus';
import type { ViewMode } from './viewMode';
import styles from './Review.module.css';

const FILTERS: StatusFilter[] = ['review', 'shown', 'rejected', null];

interface StatusPillsProps {
  value: StatusFilter | undefined;
  counts: StatusCounts | null;
  onChange: (status: StatusFilter) => void;
}

/** Needs review · 3, Shown · 18, Rejected · 2, All. */
export function StatusPills({ value, counts, onChange }: StatusPillsProps) {
  return (
    <div role="group" aria-label="Status" className={styles.pills}>
      {FILTERS.map((status) => {
        const label = status ? STATUS_LABELS[status] : 'All';
        const count = status && counts ? ` · ${counts[status]}` : '';
        return (
          <button
            key={status ?? 'all'}
            type="button"
            className={styles.pill}
            aria-pressed={value === status}
            onClick={() => onChange(status)}
          >
            {label}
            {count}
          </button>
        );
      })}
    </div>
  );
}

export function ViewSwitch({ value, onChange }: { value: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div role="group" aria-label="View" className={styles.switch}>
      {(['grid', 'review'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={styles.switchBtn}
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
        >
          {mode === 'grid' ? 'Grid' : 'Review'}
        </button>
      ))}
    </div>
  );
}
