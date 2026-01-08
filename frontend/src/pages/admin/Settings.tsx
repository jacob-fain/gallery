import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getSettings, updateSettings } from '../../api/client';
import styles from './Settings.module.css';

export default function Settings() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [siteTitle, setSiteTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');

  useEffect(() => {
    async function fetchSettings() {
      try {
        const data = await getSettings();
        setSiteTitle(data.site_title);
        setMetaDescription(data.meta_description);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    }

    fetchSettings();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await updateSettings(token, {
        site_title: siteTitle,
        meta_description: metaDescription,
      });
      setSuccess('Settings saved successfully');

      // Update document title immediately
      document.title = siteTitle;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Site Settings</h1>

      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.success}>{success}</div>}

      <form onSubmit={handleSubmit} className={styles.form}>
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

        <button type="submit" className={styles.button} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}
