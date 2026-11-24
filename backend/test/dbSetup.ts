import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

/**
 * Vitest global setup for database-backed tests. Runs only when
 * TEST_DATABASE_URL is set, and refuses any database whose name does not end
 * in _test, because it drops and rebuilds the public schema from db/init.
 * Rebuilding also proves every migration applies cleanly to an empty
 * database.
 */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // Asked of the server after connecting: pg parses connection strings its
    // own way (socket paths, ?db= and the like), so the URL text cannot be
    // trusted to name the database that would be dropped.
    const { rows } = await client.query<{ name: string }>('SELECT current_database() AS name');
    const name = rows[0]?.name ?? '';
    if (!name.endsWith('_test')) {
      throw new Error(`TEST_DATABASE_URL must reach a database ending in _test (connected to "${name}")`);
    }
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    const dir = path.join(__dirname, '../../db/init');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    }
  } finally {
    await client.end();
  }
}
