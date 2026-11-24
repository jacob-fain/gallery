import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import dotenv from 'dotenv';

/** Where migrations ship: beside dist/ in the image, beside src/ in a checkout. */
export const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

// Arbitrary but fixed: every runner takes the same advisory lock, so two
// runners on one database apply each migration once.
const LOCK_KEY = 7340231;

const FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;

/**
 * Migration files in apply order. Names are NNN_description.sql and the
 * numbers must be unique, so the order never depends on the description.
 */
export const listMigrations = (dir: string = MIGRATIONS_DIR): string[] => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const seen = new Set<string>();
  for (const file of files) {
    if (!FILE_PATTERN.test(file)) {
      throw new Error(`Migration file name must look like 001_description.sql: ${file}`);
    }
    const number = file.slice(0, 3);
    if (seen.has(number)) throw new Error(`Two migrations share the number ${number}`);
    seen.add(number);
  }
  return files;
};

/**
 * Applies every migration not yet recorded in _migrations, in order, each in
 * its own transaction, so a failing file changes nothing and is not
 * recorded. A migration therefore must not manage transactions itself or use
 * statements that cannot run inside one (CREATE INDEX CONCURRENTLY). _migrations is the table the deploy workflow has always
 * written, so an existing database continues where it left off.
 *
 * Returns the files applied by this run.
 */
export const runMigrations = async (
  connectionString: string,
  dir: string = MIGRATIONS_DIR,
  log: (line: string) => void = console.log
): Promise<string[]> => {
  const files = listMigrations(dir);
  const client = new Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT NOW()
      )`);
    const done = new Set(
      (await client.query<{ filename: string }>('SELECT filename FROM _migrations')).rows.map(
        (r) => r.filename
      )
    );
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed and was rolled back: ${(err as Error).message}`);
      }
      applied.push(file);
      log(`Applied ${file}`);
    }
    log(applied.length ? `Applied ${applied.length} migration(s)` : 'Database is up to date');
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await client.end();
  }
};

// Run as a command: node dist/migrate.js. Exits non-zero on any failure, so
// a deploy that runs this first stops before swapping containers.
if (require.main === module) {
  // Same env file the server reads in development; absent in containers.
  dotenv.config({ path: path.join(__dirname, '../../.env') });
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  runMigrations(url).then(
    () => process.exit(0),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  );
}
