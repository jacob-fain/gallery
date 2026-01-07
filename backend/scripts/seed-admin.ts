/**
 * Seed Admin User Script
 *
 * Creates or updates the admin user in the database.
 * Reads credentials from environment variables:
 *   - ADMIN_EMAIL
 *   - ADMIN_PASSWORD
 *
 * Usage: npx ts-node scripts/seed-admin.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

// Load environment variables from root .env
dotenv.config({ path: path.join(__dirname, '../../.env') });

const BCRYPT_ROUNDS = 10;

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
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Upsert the admin user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (email)
       DO UPDATE SET password_hash = $2
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
