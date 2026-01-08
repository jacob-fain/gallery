import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import styles from './AdminLayout.module.css';

interface AdminLayoutProps {
  children: React.ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
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
      <main className={styles.content}>{children}</main>
    </div>
  );
}
