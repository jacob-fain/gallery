import { useEffect, useRef } from 'react';
import type { StatusFilter } from '../../../api/client';
import type { StatusCounts } from '../../../types';
import { STATUS_LABELS } from '../../../utils/reviewStatus';
import type { ViewMode } from './viewMode';
import styles from './Review.module.css';

const FILTERS: StatusFilter[] = ['review', 'shown', 'rejected', null];

/** Width of the pill row's right-edge fade on phones, in px. */
const FADE = 32;

interface StatusPillsProps {
  value: StatusFilter | undefined;
  counts: StatusCounts | null;
  onChange: (status: StatusFilter) => void;
}

/** Needs review · 3, Shown · 18, Rejected · 2, All. */
export function StatusPills({ value, counts, onChange }: StatusPillsProps) {
  const groupRef = useRef<HTMLDivElement>(null);

  // On phones the row scrolls sideways; keep the selected pill in view.
  // Only the row's own scroll moves, never the page. The last FADE pixels
  // are under the edge fade (Review.module.css), so they count as hidden.
  useEffect(() => {
    const group = groupRef.current;
    const active = group?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!group || !active) return;
    const left = active.offsetLeft - group.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < group.scrollLeft) group.scrollLeft = left;
    else if (right > group.scrollLeft + group.clientWidth - FADE) group.scrollLeft = right - group.clientWidth + FADE;
  }, [value]);

  return (
    <div ref={groupRef} role="group" aria-label="Status" className={styles.pills}>
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
