import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/auth';
import { UploadQueueProvider } from '../../../contexts/UploadQueueContext';
import { useUploadSummary } from '../../../contexts/uploads';
import ThemeToggle from '../../ThemeToggle/ThemeToggle';
import UploadIndicator from '../UploadIndicator/UploadIndicator';
import styles from './AdminLayout.module.css';

interface AdminLayoutProps {
  children: React.ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <UploadQueueProvider>
      <AdminShell>{children}</AdminShell>
    </UploadQueueProvider>
  );
}

function AdminShell({ children }: AdminLayoutProps) {
  const { user, logout } = useAuth();
  const uploads = useUploadSummary();
  const navigate = useNavigate();

  const handleLogout = () => {
    // Signing out stops every upload still running.
    if (uploads.active && !window.confirm('Uploads are still running. Log out and cancel them?')) return;
    logout();
    navigate('/login');
  };

  // Get the main site URL (remove manage. subdomain)
  const mainSiteUrl = window.location.origin.replace('manage.', '');

  return (
    <div className={styles.layout}>
      <nav className={styles.navbar}>
        <div className={styles.container}>
          <div className={styles.left}>
            <span className={styles.logo}>Admin</span>
            <div className={styles.links}>
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  isActive ? `${styles.link} ${styles.active}` : styles.link
                }
              >
                Dashboard
              </NavLink>
              <NavLink
                to="/galleries"
                className={({ isActive }) =>
                  isActive ? `${styles.link} ${styles.active}` : styles.link
                }
              >
                Galleries
              </NavLink>
              <NavLink
                to="/homepage"
                className={({ isActive }) =>
                  isActive ? `${styles.link} ${styles.active}` : styles.link
                }
              >
                Homepage
              </NavLink>
              <NavLink
                to="/unassigned"
                className={({ isActive }) =>
                  isActive ? `${styles.link} ${styles.active}` : styles.link
                }
              >
                Unassigned
              </NavLink>
              <NavLink
                to="/settings"
                className={({ isActive }) =>
                  isActive ? `${styles.link} ${styles.active}` : styles.link
                }
              >
                Settings
              </NavLink>
            </div>
          </div>
          <div className={styles.right}>
            <ThemeToggle />
            <a
              href={mainSiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.viewSite}
            >
              View Site ↗
            </a>
            <span className={styles.user}>{user?.email}</span>
            <button onClick={handleLogout} className={styles.logoutBtn}>
              Logout
            </button>
          </div>
        </div>
      </nav>
      <main className={styles.content}>
        {children}
        <UploadIndicator />
      </main>
    </div>
  );
}
