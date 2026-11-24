import dotenv from 'dotenv';
import path from 'path';

/**
 * Loads the repository's .env file outside production. In a container the
 * settings come from the environment, and this relative path resolves to
 * /.env, a file nothing manages, so it is never read there.
 */
export const loadDotenv = (
  env: NodeJS.ProcessEnv = process.env,
  // src/config or dist/config, three levels below the repository root.
  file: string = path.join(__dirname, '../../../.env')
): void => {
  if (env.NODE_ENV === 'production') return;
  dotenv.config({ path: file, processEnv: env as dotenv.DotenvPopulateInput });
};

/**
 * Settings the server cannot run without. Checked at startup so a bad value
 * stops the process before it serves, instead of failing the first request
 * that happens to need it.
 */
export const envProblems = (env: NodeJS.ProcessEnv = process.env): string[] => {
  const problems: string[] = [];
  if (!env.DATABASE_URL) problems.push('DATABASE_URL is required');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters');
  }
  return problems;
};
