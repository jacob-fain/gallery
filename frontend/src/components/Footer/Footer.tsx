import { Fragment } from 'react';
import styles from './Footer.module.css';

const COFFEE_URL = 'https://buymeacoffee.com/jacobfain';

interface FooterLink {
  label: string;
  href: string;
  external: boolean;
}

interface FooterProps {
  /** Shown only when set; the settings API allows only https links on instagram.com. */
  instagramUrl?: string;
  /** Shown only when set, as a mailto: link. */
  contactEmail?: string;
}

export default function Footer({ instagramUrl, contactEmail }: FooterProps) {
  const links: FooterLink[] = [];
  if (instagramUrl) links.push({ label: 'Instagram', href: instagramUrl, external: true });
  if (contactEmail) links.push({ label: 'Email', href: `mailto:${contactEmail}`, external: false });
  links.push({ label: 'Buy me a coffee', href: COFFEE_URL, external: true });

  return (
    <footer className={styles.footer}>
      <div className={styles.row}>
        <span className={styles.copyright}>&copy; {new Date().getFullYear()} Jacob Fain</span>
        {links.map(({ label, href, external }) => (
          <Fragment key={label}>
            <span className={styles.separator} aria-hidden="true">
              &middot;
            </span>
            <a
              href={href}
              className={styles.link}
              {...(external && { target: '_blank', rel: 'noopener noreferrer' })}
            >
              {label}
            </a>
          </Fragment>
        ))}
      </div>
    </footer>
  );
}
