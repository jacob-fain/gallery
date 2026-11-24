import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { query } from '../config/db';
import { getUserById, revokeTokens } from './authService';

const db = process.env.TEST_DATABASE_URL;

describe.skipIf(!db)('revokeTokens (database)', () => {
  const created: string[] = [];
  afterAll(async () => {
    if (created.length) await query('DELETE FROM users WHERE id = ANY($1)', [created]);
  });

  it('new users start at version 0, and each revoke moves it on for that user only', async () => {
    const make = async () => {
      const { rows } = await query(
        `INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`,
        [`u-${crypto.randomBytes(4).toString('hex')}@example.com`]
      );
      created.push(rows[0].id);
      return rows[0].id as string;
    };
    const a = await make();
    const b = await make();
    expect((await getUserById(a))!.token_version).toBe(0);
    await revokeTokens(a);
    await revokeTokens(a);
    expect((await getUserById(a))!.token_version).toBe(2);
    expect((await getUserById(b))!.token_version).toBe(0);
  });
});
