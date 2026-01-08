import styles from './StatsCard.module.css';

interface StatsCardProps {
  label: string;
  value: number | string;
  sublabel?: string;
}

export default function StatsCard({ label, value, sublabel }: StatsCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value.toLocaleString()}</div>
      {sublabel && <div className={styles.sublabel}>{sublabel}</div>}
    </div>
  );
}
