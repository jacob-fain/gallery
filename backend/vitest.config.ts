import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Unit tests never reach a database: db.ts only needs a URL to build its
    // pool, and nothing here issues a query against it.
    env: {
      DATABASE_URL: 'postgresql://unit:unit@127.0.0.1:1/unit',
      JWT_SECRET: 'unit-test-secret-that-is-at-least-32-characters',
    },
  },
});
