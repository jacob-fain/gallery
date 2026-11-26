import type { GridLayout } from './gridLayout';
import styles from './LayoutSwitch.module.css';

const OPTIONS: { value: GridLayout; label: string }[] = [
  { value: 'columns', label: 'Columns' },
  { value: 'collage', label: 'Collage' },
];

interface LayoutSwitchProps {
  layout: GridLayout;
  onChange: (layout: GridLayout) => void;
  // Places the switch on the page (next to its floating buttons).
  className?: string;
}

export default function LayoutSwitch({ layout, onChange, className }: LayoutSwitchProps) {
  return (
    <div role="group" aria-label="Layout" className={`${styles.switch}${className ? ` ${className}` : ''}`}>
      {OPTIONS.map(({ value, label }) => (
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
