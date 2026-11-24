import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import ContactModal from '../ContactModal/ContactModal';
import ThemeToggle from '../ThemeToggle/ThemeToggle';
import { MOBILE_NAV_QUERY, isMenuOpen, menuAction, type MenuAction } from './menu';
import styles from './Navbar.module.css';

// The contact form is off until the site sends mail through a send-only
// service (#52). Turning it back on also needs CONTACT_FORM_ENABLED=true on
// the backend.
const CONTACT_ENABLED = false;

const MENU_ID = 'site-menu';

const contactIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);

export default function Navbar() {
  const [contactOpen, setContactOpen] = useState(false);
  const location = useLocation();
  const [menuOpenedAt, setMenuOpenedAt] = useState<string | null>(null);
  const menuOpen = isMenuOpen(menuOpenedAt, location.key);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const closeMenu = () => setMenuOpenedAt(null);

  useEffect(() => {
    if (!menuOpen) return;

    menuRef.current?.querySelector<HTMLElement>('a, button')?.focus();

    const apply = (action: MenuAction) => {
      if (action === 'keep') return;
      setMenuOpenedAt(null);
      if (action === 'closeAndRefocus') menuButtonRef.current?.focus();
    };
    const onKeyDown = (e: KeyboardEvent) => apply(menuAction({ type: 'keydown', key: e.key }));
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      const insideMenu =
        !!menuRef.current?.contains(target) || !!menuButtonRef.current?.contains(target);
      apply(menuAction({ type: 'pointerdown', insideMenu }));
    };
    const media = window.matchMedia(MOBILE_NAV_QUERY);
    const onViewport = (e: MediaQueryListEvent) =>
      apply(menuAction({ type: 'viewport', mobile: e.matches }));

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    media.addEventListener('change', onViewport);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      media.removeEventListener('change', onViewport);
    };
  }, [menuOpen]);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? `${styles.link} ${styles.active}` : styles.link;
  const menuLinkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? `${styles.menuItem} ${styles.active}` : styles.menuItem;

  return (
    <>
      <nav className={styles.navbar}>
        <div className={styles.container}>
          <Link to="/" className={styles.logo}>
            Jacob Fain
          </Link>
          <div className={styles.links}>
            <NavLink to="/galleries" className={linkClass}>
              Galleries
            </NavLink>
            <NavLink to="/photos" className={linkClass}>
              Photos
            </NavLink>
            {CONTACT_ENABLED && (
              <button
                onClick={() => setContactOpen(true)}
                className={styles.iconLink}
                title="Contact"
                aria-label="Contact"
              >
                {contactIcon}
              </button>
            )}
            <ThemeToggle className={styles.iconLink} />
          </div>
          <button
            ref={menuButtonRef}
            type="button"
            className={styles.menuButton}
            aria-label="Menu"
            aria-expanded={menuOpen}
            aria-controls={MENU_ID}
            onClick={() => setMenuOpenedAt(menuOpen ? null : location.key)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
        <div id={MENU_ID} ref={menuRef} className={styles.menu} hidden={!menuOpen}>
          <NavLink to="/galleries" className={menuLinkClass} onClick={closeMenu}>
            Galleries
          </NavLink>
          <NavLink to="/photos" className={menuLinkClass} onClick={closeMenu}>
            Photos
          </NavLink>
          {CONTACT_ENABLED && (
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                closeMenu();
                setContactOpen(true);
              }}
            >
              Contact
              {contactIcon}
            </button>
          )}
          <ThemeToggle className={styles.menuItem} label="Theme" />
        </div>
      </nav>
      {CONTACT_ENABLED && (
        <ContactModal isOpen={contactOpen} onClose={() => setContactOpen(false)} />
      )}
    </>
  );
}
