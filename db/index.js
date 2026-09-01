const path = require('path');
const fs = require('fs');
const dns = require('dns');
const { runMigrations } = require('./runner');

try { dns.setDefaultResultOrder('ipv4first'); } catch (e) {}

const isPostgres = Boolean(process.env.DATABASE_URL);

let db;

if (isPostgres) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });

  // Helper to convert `?` placeholders to `$1, $2, ...` for PostgreSQL
  function formatSql(sql) {
    let index = 1;
    let formatted = sql.replace(/\?/g, () => `$${index++}`);
    formatted = formatted.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
    return formatted;
  }

  db = {
    isPostgres: true,
    pool,
    exec: async (sql) => {
      const client = await pool.connect();
      try {
        await client.query(sql);
      } finally {
        client.release();
      }
    },
    prepare: (sql) => {
      const formattedSql = formatSql(sql);
      return {
        get: async (...params) => {
          const flatParams = params.flat();
          const res = await pool.query(formattedSql, flatParams);
          return res.rows[0];
        },
        all: async (...params) => {
          const flatParams = params.flat();
          const res = await pool.query(formattedSql, flatParams);
          return res.rows;
        },
        run: async (...params) => {
          const flatParams = params.flat();
          let finalSql = formattedSql;
          const isInsert = /^\s*INSERT\s+INTO/i.test(finalSql);
          if (isInsert && !/RETURNING/i.test(finalSql)) {
            finalSql += ' RETURNING id';
          }
          const res = await pool.query(finalSql, flatParams);
          const lastInsertRowid = res.rows[0] ? res.rows[0].id : null;
          return {
            lastInsertRowid,
            changes: res.rowCount,
          };
        },
      };
    },
  };

  // Run PostgreSQL migrations
  runMigrations(db).catch((err) => {
    console.error('[Database Adapter] PostgreSQL setup notice:', err.message);
  });
} else {
  // SQLite Local Development Mode
  const { DatabaseSync } = require('node:sqlite');
  const DB_PATH = path.join(__dirname, '..', 'data', 'invoicing.db');
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const sqliteDb = new DatabaseSync(DB_PATH);
  sqliteDb.exec('PRAGMA journal_mode = WAL;');
  sqliteDb.exec('PRAGMA foreign_keys = ON;');

  db = {
    isPostgres: false,
    sqliteDb,
    exec: (sql) => sqliteDb.exec(sql),
    prepare: (sql) => sqliteDb.prepare(sql),
  };

  runMigrations(db);

  // Ensure default company settings exist for org_id = 1
  try {
    const settingsRow = sqliteDb.prepare('SELECT id FROM company_settings WHERE org_id = 1').get();
    if (!settingsRow) {
      sqliteDb.prepare(`INSERT INTO company_settings (org_id, company_name) VALUES (1, 'My Company')`).run();
    }
  } catch (err) {
    // ignore initialization check error if table pending
  }
}

module.exports = db;
