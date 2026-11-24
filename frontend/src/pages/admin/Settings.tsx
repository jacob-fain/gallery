import { useState, useEffect } from 'react';
import { useSiteTitle } from '../../contexts/siteTitle';
import { getSettings, updateSettings } from '../../api/client';
import { siteLinksError } from '../../utils/siteLinks';
import styles from './Settings.module.css';

export default function Settings() {
  const { setSiteTitle: applySiteTitle } = useSiteTitle();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);

  // Form state
  const [siteTitle, setSiteTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  useEffect(() => {
    async function fetchSettings() {
      try {
        const data = await getSettings();
        setSiteTitle(data.site_title);
        setMetaDescription(data.meta_description);
        setInstagramUrl(data.instagram_url ?? '');
        setContactEmail(data.contact_email ?? '');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings');
        setLoadFailed(true);
      } finally {
        setLoading(false);
      }
    }

    fetchSettings();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const linksError = siteLinksError(instagramUrl, contactEmail);
    if (linksError) {
      setError(linksError);
      return;
    }

    setSaving(true);

    try {
      await updateSettings({
        site_title: siteTitle,
        meta_description: metaDescription,
        instagram_url: instagramUrl.trim(),
        contact_email: contactEmail.trim(),
      });
      setSuccess('Settings saved successfully');

      applySiteTitle(siteTitle);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  // The form would open blank, and saving it would replace the stored
  // settings with empty values.
  if (loadFailed) {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>Site Settings</h1>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Site Settings</h1>

      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.success}>{success}</div>}

      {/* The URL and email fields are checked by siteLinksError, which names
          the field in the page's error message, rather than by the browser. */}
      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        <div className={styles.field}>
          <label htmlFor="siteTitle" className={styles.label}>
            Site Title
          </label>
          <input
            type="text"
            id="siteTitle"
            value={siteTitle}
            onChange={(e) => setSiteTitle(e.target.value)}
            className={styles.input}
            placeholder="My Photography Portfolio"
          />
          <p className={styles.hint}>
            Appears in browser tab and search results
          </p>
        </div>

        <div className={styles.field}>
          <label htmlFor="metaDescription" className={styles.label}>
            Meta Description
          </label>
          <textarea
            id="metaDescription"
            value={metaDescription}
            onChange={(e) => setMetaDescription(e.target.value)}
            className={styles.textarea}
            rows={3}
            placeholder="A brief description of your photography portfolio..."
          />
          <p className={styles.hint}>
            Appears in Google search results (recommended: 150-160 characters)
          </p>
        </div>

        <div className={styles.field}>
          <label htmlFor="instagramUrl" className={styles.label}>
            Instagram URL
          </label>
          <input
            type="url"
            id="instagramUrl"
            value={instagramUrl}
            onChange={(e) => setInstagramUrl(e.target.value)}
            className={styles.input}
            placeholder="https://www.instagram.com/username"
          />
          <p className={styles.hint}>
            Linked in the site footer. Leave empty to hide the link.
          </p>
        </div>

        <div className={styles.field}>
          <label htmlFor="contactEmail" className={styles.label}>
            Contact Email
          </label>
          <input
            type="email"
            id="contactEmail"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            className={styles.input}
            placeholder="you@example.com"
          />
          <p className={styles.hint}>
            Linked in the site footer as an email link. Leave empty to hide the link.
          </p>
        </div>

        <button type="submit" className={styles.button} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}
