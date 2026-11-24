import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatDayLabel } from '../../../utils/dayLabel';
import styles from './Charts.module.css';

interface UploadChartProps {
  data: { date: string; count: number }[];
}

export default function UploadChart({ data }: UploadChartProps) {
  // Show every 5th label to avoid crowding
  const formatXAxis = (dateStr: string, index: number) => {
    if (index % 5 === 0) {
      return formatDayLabel(dateStr);
    }
    return '';
  };

  const totalUploads = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <h3 className={styles.chartTitle}>Upload Activity</h3>
        <span className={styles.chartTotal}>{totalUploads.toLocaleString()} uploads</span>
      </div>
      <div className={styles.chartContainer}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatXAxis}
              tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
              stroke="var(--color-border)"
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
              stroke="var(--color-border)"
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
              }}
              labelFormatter={(label) => formatDayLabel(String(label))}
              formatter={(value) => [value, 'Uploads']}
            />
            <Bar
              dataKey="count"
              fill="var(--color-primary)"
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
