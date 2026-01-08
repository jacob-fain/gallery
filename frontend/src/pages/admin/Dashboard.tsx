import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getAdminStats, getAnalytics } from '../../api/client';
import StatsCard from '../../components/Admin/StatsCard/StatsCard';
import {
  TrafficChart,
  UploadChart,
  StorageChart,
  TopGalleries,
  TopPhotos,
} from '../../components/Admin/Charts';
import type { AdminStats, AnalyticsData } from '../../types';
import styles from './Dashboard.module.css';

export default function Dashboard() {
  const { token } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchData() {
      if (!token) return;

      try {
        const [statsData, analyticsData] = await Promise.all([
          getAdminStats(token),
          getAnalytics(token),
        ]);
        setStats(statsData);
        setAnalytics(analyticsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [token]);

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  if (!stats || !analytics) {
    return null;
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Dashboard</h1>

      {/* Quick Stats Row */}
      <div className={styles.statsGrid}>
        <StatsCard
          label="Total Galleries"
          value={stats.galleries.total}
          sublabel={`${stats.galleries.public} public, ${stats.galleries.private} private`}
        />
        <StatsCard
          label="Total Photos"
          value={stats.photos.total}
        />
        <StatsCard
          label="Gallery Views"
          value={stats.views.galleries}
        />
        <StatsCard
          label="Downloads"
          value={stats.downloads}
        />
      </div>

      {/* Main Traffic Chart */}
      <div className={styles.mainChart}>
        <TrafficChart data={analytics.viewsOverTime} />
      </div>

      {/* Secondary Charts Row */}
      <div className={styles.secondaryCharts}>
        <UploadChart data={analytics.uploadActivity} />
        <StorageChart data={analytics.storage} />
      </div>

      {/* Leaderboards Row */}
      <div className={styles.leaderboards}>
        <TopGalleries data={analytics.topGalleries} />
        <TopPhotos data={analytics.topPhotos} />
      </div>
    </div>
  );
}
