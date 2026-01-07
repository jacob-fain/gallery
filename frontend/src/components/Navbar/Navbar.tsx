import { Link, NavLink } from 'react-router-dom';
import styles from './Navbar.module.css';

export default function Navbar() {
  return (
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
        </div>
      </div>
    </nav>
  );
}
