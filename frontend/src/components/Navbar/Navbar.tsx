import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import ContactModal from '../ContactModal/ContactModal';
import styles from './Navbar.module.css';

export default function Navbar() {
  const [contactOpen, setContactOpen] = useState(false);

  return (
    <>
      <nav className={styles.navbar}>
        <div className={styles.container}>
          <Link to="/" className={styles.logo}>
            Jacob Fain
          </Link>
          <div className={styles.links}>
            <NavLink
              to="/galleries"
              className={({ isActive }) =>
                isActive ? `${styles.link} ${styles.active}` : styles.link
              }
            >
              Galleries
            </NavLink>
            <a
              href="https://buymeacoffee.com/jacobfain"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.iconLink}
              title="Buy me a coffee"
              aria-label="Buy me a coffee"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
                <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
                <line x1="6" y1="2" x2="6" y2="4" />
                <line x1="10" y1="2" x2="10" y2="4" />
                <line x1="14" y1="2" x2="14" y2="4" />
              </svg>
            </a>
            <button
              onClick={() => setContactOpen(true)}
              className={styles.iconLink}
              title="Contact"
              aria-label="Contact"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </button>
          </div>
        </div>
      </nav>
      <ContactModal isOpen={contactOpen} onClose={() => setContactOpen(false)} />
    </>
  );
}
