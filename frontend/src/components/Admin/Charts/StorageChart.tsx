import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import styles from './Charts.module.css';

interface StorageChartProps {
  data: {
    total_bytes: number;
    galleries: { id: string; title: string; bytes: number }[];
  };
}

// Format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Colors for bars
const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#6366f1', '#f43f5e'];

export default function StorageChart({ data }: StorageChartProps) {
  // Take top 5 galleries by storage
  const topGalleries = data.galleries
    .filter(g => g.bytes > 0)
    .slice(0, 5)
    .map(g => ({
      ...g,
      // Truncate long titles
      displayTitle: g.title.length > 15 ? g.title.slice(0, 15) + '...' : g.title,
    }));

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <h3 className={styles.chartTitle}>Storage by Gallery</h3>
        <span className={styles.chartTotal}>{formatBytes(data.total_bytes)} total</span>
      </div>
      {topGalleries.length === 0 ? (
        <div className={styles.emptyChart}>No data yet</div>
      ) : (
        <div className={styles.chartContainer}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={topGalleries}
              layout="vertical"
              margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
            >
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
                stroke="var(--color-border)"
                tickFormatter={formatBytes}
              />
              <YAxis
                type="category"
                dataKey="displayTitle"
                tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
                stroke="var(--color-border)"
                width={100}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '4px',
                }}
                formatter={(value) => [formatBytes(value as number), 'Storage']}
                labelFormatter={(label) => topGalleries.find(g => g.displayTitle === label)?.title || label}
              />
              <Bar dataKey="bytes" radius={[0, 4, 4, 0]}>
                {topGalleries.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
