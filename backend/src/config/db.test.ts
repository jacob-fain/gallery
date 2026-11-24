import { describe, it, expect, vi } from 'vitest';
import pool, { poolConfig } from './db';

describe('database pool', () => {
  it('bounds connection, idle, statement and query waits', () => {
    const config = poolConfig('postgresql://u:p@h:5432/d');
    expect(config.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(config.idleTimeoutMillis).toBeGreaterThan(0);
    expect(config.statement_timeout).toBeGreaterThan(0);
    expect(config.query_timeout).toBeGreaterThan(config.statement_timeout as number);
  });

  it('logs an idle client error instead of exiting', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    pool.emit('error', new Error('terminating connection due to administrator command'));
    expect(exit).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    exit.mockRestore();
    error.mockRestore();
  });
});
