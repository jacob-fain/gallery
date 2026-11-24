import { useTheme } from '../../contexts/theme';
import styles from './ThemeToggle.module.css';

interface ThemeToggleProps {
  className?: string;
  /** Visible text shown before the icon. */
  label?: string;
}

export default function ThemeToggle({ className, label: visibleLabel }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const action = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  // The accessible name starts with the visible text so voice control users
  // can say what they see.
  const label = visibleLabel ? `${visibleLabel}: ${action.toLowerCase()}` : action;

  return (
    <button
      onClick={toggleTheme}
      className={className ?? styles.toggle}
      title={label}
      aria-label={label}
    >
      {visibleLabel && <span>{visibleLabel}</span>}
      {theme === 'light' ? (
        // Moon icon
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      ) : (
        // Sun icon
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      )}
    </button>
  );
}
