import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { testConnection } from './config/db';

const PORT = process.env.PORT || 3001;

const start = async () => {
  // Test database connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.error('Failed to connect to database. Exiting.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
  });
};

start();
