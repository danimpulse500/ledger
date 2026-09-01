const path = require('path');
const fs = require('fs');
const dns = require('dns');
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');
require('dotenv').config();

try { dns.setDefaultResultOrder('ipv4first'); } catch (e) {}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Error: DATABASE_URL environment variable is not defined in .env');
  process.exit(1);
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

const sqlitePath = path.join(__dirname, '..', 'data', 'invoicing.db');
if (!fs.existsSync(sqlitePath)) {
  console.error('Error: Local SQLite database file not found at:', sqlitePath);
  process.exit(1);
}

const sqliteDb = new DatabaseSync(sqlitePath);

async function migrate() {
  console.log('Starting migration to PostgreSQL...');
  const client = await pool.connect();

  try {
    // 1. Create PostgreSQL Schema
    const schemaPgPath = path.join(__dirname, 'schema-pg.sql');
    if (fs.existsSync(schemaPgPath)) {
      console.log('Applying PostgreSQL schema (db/schema-pg.sql)...');
      const schemaSql = fs.readFileSync(schemaPgPath, 'utf8');
      await client.query(schemaSql);
      console.log('Schema applied successfully.');
    }

    // 2. Migration table order (respecting foreign key relationships)
    const tables = [
      'organizations',
      'company_settings',
      'users',
      'platform_admins',
      'clients',
      'products',
      'invoices',
      'invoice_items',
      'payments',
      'expenses',
      'billing_transactions',
      'sessions',
    ];

    await client.query('BEGIN');

    for (const table of tables) {
      let rows = [];
      try {
        rows = sqliteDb.prepare(`SELECT * FROM ${table}`).all();
      } catch (err) {
        console.log(`Table ${table} skipped (not in SQLite database).`);
        continue;
      }

      if (!rows || rows.length === 0) {
        console.log(`Table ${table}: 0 rows to migrate.`);
        continue;
      }

      // Check existing columns in PG table
      const pgColsRes = await client.query(`
        SELECT column_name FROM information_schema.columns WHERE table_name = $1
      `, [table]);
      const existingPgCols = new Set(pgColsRes.rows.map(r => r.column_name.toLowerCase()));

      const columns = Object.keys(rows[0]);
      
      // Auto-add any missing columns to PostgreSQL table
      for (const col of columns) {
        if (!existingPgCols.has(col.toLowerCase())) {
          console.log(`Adding missing column '${col}' to PostgreSQL table '${table}'...`);
          await client.query(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`);
        }
      }

      const colNames = columns.join(', ');
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

      const insertSql = `INSERT INTO ${table} (${colNames}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

      for (const row of rows) {
        const values = columns.map((col) => row[col]);
        await client.query(insertSql, values);
      }

      console.log(`Migrated ${rows.length} rows into '${table}' table.`);

      // Reset sequence for auto-incrementing id if applicable
      if (columns.includes('id')) {
        await client.query(`
          SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), true)
        `);
      }
    }

    await client.query('COMMIT');
    console.log('\nMigration completed successfully!');

    // Verify row counts in PostgreSQL
    console.log('\n--- PostgreSQL Verification ---');
    for (const table of tables) {
      try {
        const res = await client.query(`SELECT COUNT(*) AS count FROM ${table}`);
        console.log(`PostgreSQL table '${table}': ${res.rows[0].count} rows`);
      } catch (e) {
        // ignore missing tables
      }
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
