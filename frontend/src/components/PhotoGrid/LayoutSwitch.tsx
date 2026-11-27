import type { GridLayout } from './gridLayout';
import styles from './LayoutSwitch.module.css';

const OPTIONS: { value: GridLayout; label: string }[] = [
  { value: 'columns', label: 'Columns' },
  { value: 'collage', label: 'Collage' },
  { value: 'single', label: 'Single' },
];

interface LayoutSwitchProps {
  layout: GridLayout;
  onChange: (layout: GridLayout) => void;
  // Off on a one-column grid, where columns is already one photo per row.
  offerSingle?: boolean;
  // Places the switch on the page (next to its floating buttons).
  className?: string;
}

export default function LayoutSwitch({ layout, onChange, offerSingle = true, className }: LayoutSwitchProps) {
  return (
    <div role="group" aria-label="Layout" className={`${styles.switch}${className ? ` ${className}` : ''}`}>
      {OPTIONS.filter(({ value }) => offerSingle || value !== 'single').map(({ value, label }) => (
        <button
          key={value}
          type="button"
          className={styles.option}
          aria-pressed={layout === value}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
