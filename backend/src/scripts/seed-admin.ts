/**
 * Seed Admin User Script
 *
 * Creates or updates the admin user in the database.
 * Reads credentials from environment variables:
 *   - ADMIN_EMAIL
 *   - ADMIN_PASSWORD
 *
 * Usage: node dist/scripts/seed-admin.js
 */

import { loadDotenv } from '../config/env';
import { Pool } from 'pg';

loadDotenv();

import { hashPassword } from '../services/authService';

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('Error: ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Error: ADMIN_PASSWORD must be at least 8 characters');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log(`Seeding admin user: ${email}`);

    // Hash the password
    const passwordHash = await hashPassword(password);

    // Upsert the admin user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (email)
       -- A new password also revokes every existing admin session.
       DO UPDATE SET password_hash = $2, token_version = users.token_version + 1
       RETURNING id, email, created_at`,
      [email, passwordHash]
    );

    const user = result.rows[0];
    console.log('Admin user seeded successfully:');
    console.log(`  ID: ${user.id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Created: ${user.created_at}`);
  } catch (err) {
    console.error('Failed to seed admin user:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedAdmin();
