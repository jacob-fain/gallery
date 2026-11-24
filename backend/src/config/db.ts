import { Pool, PoolConfig } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

/**
 * Every wait on the database is bounded, so a burst of slow queries or an
 * unreachable server turns into request errors instead of requests that hang
 * with a pool connection held. statement_timeout is enforced by Postgres;
 * query_timeout is the client's own limit for when the server never answers,
 * so it sits above statement_timeout.
 */
export const poolConfig = (connectionString: string): PoolConfig => ({
  connectionString,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 10000,
  query_timeout: 15000,
});

const pool = new Pool(poolConfig(process.env.DATABASE_URL));

// An idle client fails when Postgres restarts or drops the connection. The
// pool discards that client and opens a new one on demand, so the process
// keeps serving instead of exiting with uploads and downloads in flight.
pool.on('error', (err) => {
  console.error('Idle database client error:', err.message);
});

export const query = (text: string, params?: unknown[]) => {
  return pool.query(text, params);
};

export const getClient = () => {
  return pool.connect();
};

export const testConnection = async (): Promise<boolean> => {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('Database connected:', result.rows[0].now);
    return true;
  } catch (err) {
    console.error('Database connection failed:', err);
    return false;
  }
};

export default pool;
