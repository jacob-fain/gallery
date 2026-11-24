import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatDayLabel } from '../../../utils/dayLabel';
import styles from './Charts.module.css';

interface TrafficChartProps {
  data: { date: string; views: number }[];
}

export default function TrafficChart({ data }: TrafficChartProps) {
  // Show every 5th label to avoid crowding
  const formatXAxis = (dateStr: string, index: number) => {
    if (index % 5 === 0) {
      return formatDayLabel(dateStr);
    }
    return '';
  };

  const totalViews = data.reduce((sum, d) => sum + d.views, 0);

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <h3 className={styles.chartTitle}>Traffic (Last 30 Days)</h3>
        <span className={styles.chartTotal}>{totalViews.toLocaleString()} total views</span>
      </div>
      <div className={styles.chartContainer}>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="date"
              tickFormatter={formatXAxis}
              tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
              stroke="var(--color-border)"
            />
            <YAxis
              tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
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
              formatter={(value) => [value, 'Views']}
            />
            <Line
              type="monotone"
              dataKey="views"
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: 'var(--color-primary)' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
