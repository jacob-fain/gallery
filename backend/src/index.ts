import { envProblems, loadDotenv } from './config/env';

// Runs before the imports below, which read the environment as they load.
loadDotenv();
const problems = envProblems();
if (problems.length > 0) {
  for (const problem of problems) console.error(`Configuration error: ${problem}`);
  process.exit(1);
}

import app from './app';
import pool, { testConnection } from './config/db';
import { createShutdown } from './shutdown';
import { drainTracking } from './services/eventTracking';
import { scheduleAnalyticsRollup } from './services/analyticsRollup';

const PORT = process.env.PORT || 3001;

const start = async () => {
  // Test database connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.error('Failed to connect to database. Exiting.');
    process.exit(1);
  }

  // Listen on 0.0.0.0 to be accessible from Windows host in WSL2
  const server = app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
  });

  const rollup = scheduleAnalyticsRollup();

  const shutdown = createShutdown({
    server,
    drain: async () => {
      await Promise.all([drainTracking(), rollup.stop()]);
    },
    closePool: () => pool.end(),
    exit: (code) => process.exit(code),
  });
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
};

start();
