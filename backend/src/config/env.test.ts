import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { envProblems, loadDotenv } from './env';

const SECRET = 'x'.repeat(32);

describe('envProblems', () => {
  it('accepts a database URL and a long enough secret', () => {
    expect(envProblems({ DATABASE_URL: 'postgresql://h/db', JWT_SECRET: SECRET })).toEqual([]);
  });

  it('names every missing or invalid setting', () => {
    expect(envProblems({})).toEqual([
      'DATABASE_URL is required',
      'JWT_SECRET must be at least 32 characters',
    ]);
    expect(envProblems({ DATABASE_URL: 'postgresql://h/db', JWT_SECRET: SECRET.slice(1) })).toEqual([
      'JWT_SECRET must be at least 32 characters',
    ]);
  });
});

describe('loadDotenv', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'env-')), '.env');
  writeFileSync(file, 'FROM_FILE=yes\n');

  it('reads the file outside production', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'development' };
    loadDotenv(env, file);
    expect(env.FROM_FILE).toBe('yes');
  });

  it('never reads it in production', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    loadDotenv(env, file);
    expect(env).toEqual({ NODE_ENV: 'production' });
  });
});
