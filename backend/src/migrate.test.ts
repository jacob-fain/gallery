import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listMigrations, MIGRATIONS_DIR } from './migrate';

const dirs: string[] = [];
const tempDir = (files: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('listMigrations', () => {
  it('lists the shipped migrations in order', () => {
    const files = listMigrations(MIGRATIONS_DIR);
    expect(files[0]).toBe('001_schema.sql');
    expect(files).toEqual([...files].sort());
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('refuses a file that is not named NNN_description.sql', () => {
    expect(() => listMigrations(tempDir({ '001_ok.sql': '', 'add-thing.sql': '' }))).toThrow(
      /must look like 001_description.sql/
    );
  });

  it('refuses two migrations with the same number', () => {
    expect(() => listMigrations(tempDir({ '003_one.sql': '', '003_two.sql': '' }))).toThrow(
      /share the number 003/
    );
  });
});
