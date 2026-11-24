import { Link } from 'react-router-dom';
import styles from './StatusMessage.module.css';

type Action = { label: string; to: string } | { label: string; onClick: () => void };

interface StatusMessageProps {
  title?: string;
  message: string;
  action: Action;
  fullPage?: boolean;
}

/** A quiet centered notice for pages that have nothing to show. */
export default function StatusMessage({ title, message, action, fullPage }: StatusMessageProps) {
  return (
    <div className={fullPage ? `${styles.container} ${styles.fullPage}` : styles.container}>
      {title && <h1 className={styles.title}>{title}</h1>}
      <p className={styles.message}>{message}</p>
      {'to' in action ? (
        <Link to={action.to} className={styles.action}>
          {action.label}
        </Link>
      ) : (
        <button type="button" onClick={action.onClick} className={styles.action}>
          {action.label}
        </button>
      )}
    </div>
  );
}
