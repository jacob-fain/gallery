import { afterAll, afterEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client } from 'pg';
import { listMigrations, runMigrations } from './migrate';

const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('runMigrations (database)', () => {
  const created: string[] = [];
  const dirs: string[] = [];
  const quiet = () => {};

  // Each case gets its own empty database, so runs from scratch never touch
  // the shared test database.
  const freshDatabase = async (): Promise<string> => {
    const name = `runner_${crypto.randomBytes(4).toString('hex')}_test`;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    created.push(name);
    const url = new URL(adminUrl as string);
    url.pathname = `/${name}`;
    return url.toString();
  };

  const inDb = async <T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> => {
    const c = new Client({ connectionString: url });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };

  const recorded = (url: string) =>
    inDb(url, async (c) =>
      (await c.query<{ filename: string }>('SELECT filename FROM _migrations ORDER BY filename')).rows.map(
        (r) => r.filename
      )
    );

  const tableExists = (url: string, table: string) =>
    inDb(url, async (c) => (await c.query('SELECT to_regclass($1) AS t', [table])).rows[0].t !== null);

  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  afterAll(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();
  });

  it('applies every shipped migration to an empty database, then nothing on a rerun', async () => {
    const url = await freshDatabase();
    const shipped = listMigrations();
    expect(await runMigrations(url, undefined, quiet)).toEqual(shipped);
    expect(await recorded(url)).toEqual(shipped);
    expect(await tableExists(url, 'photos')).toBe(true);
    expect(await runMigrations(url, undefined, quiet)).toEqual([]);
  });

  it('continues an existing database from its _migrations rows', async () => {
    // Production's history was written by the old deploy loop into this same
    // table; the runner must treat those files as done.
    const url = await freshDatabase();
    await runMigrations(url, undefined, quiet);
    await inDb(url, (c) => c.query(`DELETE FROM _migrations WHERE filename = '010_content_hash.sql'`));
    await inDb(url, (c) => c.query('ALTER TABLE photos DROP COLUMN content_hash'));
    expect(await runMigrations(url, undefined, quiet)).toEqual(['010_content_hash.sql']);
  });

  it('rolls back and does not record a failing migration', async () => {
    const url = await freshDatabase();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, '001_good.sql'), 'CREATE TABLE good (id int);');
    fs.writeFileSync(
      path.join(dir, '002_bad.sql'),
      'CREATE TABLE half_done (id int); SELECT * FROM no_such_table;'
    );
    await expect(runMigrations(url, dir, quiet)).rejects.toThrow(/002_bad.sql failed and was rolled back/);
    expect(await recorded(url)).toEqual(['001_good.sql']);
    expect(await tableExists(url, 'good')).toBe(true);
    expect(await tableExists(url, 'half_done')).toBe(false);
  });

  it('applies each migration once when two runners start together', async () => {
    const url = await freshDatabase();
    const [a, b] = await Promise.all([
      runMigrations(url, undefined, quiet),
      runMigrations(url, undefined, quiet),
    ]);
    expect([...a, ...b].sort()).toEqual(listMigrations());
  });
});
