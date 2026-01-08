import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getAdminStats } from '../../api/client';
import StatsCard from '../../components/Admin/StatsCard/StatsCard';
import type { AdminStats } from '../../types';
import styles from './Dashboard.module.css';

export default function Dashboard() {
  const { token } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchStats() {
      if (!token) return;

      try {
        const data = await getAdminStats(token);
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load stats');
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [token]);

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  if (!stats) {
    return null;
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Dashboard</h1>

      <div className={styles.grid}>
        <StatsCard
          label="Total Galleries"
          value={stats.galleries.total}
          sublabel={`${stats.galleries.public} public, ${stats.galleries.private} private`}
        />
        <StatsCard
          label="Total Photos"
          value={stats.photos.total}
          sublabel={`${stats.photos.featured} featured`}
        />
        <StatsCard
          label="Gallery Views"
          value={stats.views.galleries}
        />
        <StatsCard
          label="Photo Views"
          value={stats.views.photos}
        />
        <StatsCard
          label="Total Downloads"
          value={stats.downloads}
        />
      </div>
    </div>
  );
}
