const path = require('path');
const fs = require('fs');
const dns = require('dns');
const { runMigrations } = require('./runner');

try { dns.setDefaultResultOrder('ipv4first'); } catch (e) {}

const isPostgres = Boolean(process.env.DATABASE_URL);

let db;

if (isPostgres) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let connStr = process.env.DATABASE_URL || '';
  if (connStr.includes('sslmode=require')) {
    connStr = connStr.replace('sslmode=require', 'sslmode=no-verify');
  }

  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
    max: 20,
  });

  pool.on('error', (err) => {
    console.error('[PostgreSQL Pool Notice]:', err.message);
  });

  // Helper to convert `?` placeholders to `$1, $2, ...` for PostgreSQL
  function formatSql(sql) {
    let index = 1;
    let formatted = sql.replace(/\?/g, () => `$${index++}`);
    formatted = formatted.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
    return formatted;
  }

  async function queryWithRetry(sql, params = [], retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await pool.query(sql, params);
      } catch (err) {
        const isNetworkErr =
          err.code === 'ECONNRESET' ||
          err.code === 'ETIMEDOUT' ||
          err.code === '57P01' ||
          (err.message && (
            err.message.includes('ECONNRESET') ||
            err.message.includes('Connection terminated') ||
            err.message.includes('Client was closed') ||
            err.message.includes('timeout')
          ));

        if (isNetworkErr && attempt < retries) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        throw err;
      }
    }
  }

  db = {
    isPostgres: true,
    pool,
    query: queryWithRetry,
    exec: async (sql) => {
      return await queryWithRetry(sql);
    },
    prepare: (sql) => {
      const formattedSql = formatSql(sql);
      return {
        get: async (...params) => {
          const flatParams = params.flat();
          const res = await queryWithRetry(formattedSql, flatParams);
          return res.rows[0];
        },
        all: async (...params) => {
          const flatParams = params.flat();
          const res = await queryWithRetry(formattedSql, flatParams);
          return res.rows;
        },
        run: async (...params) => {
          const flatParams = params.flat();
          let finalSql = formattedSql;
          const isInsert = /^\s*INSERT\s+INTO/i.test(finalSql);
          if (isInsert && !/RETURNING/i.test(finalSql)) {
            finalSql += ' RETURNING id';
          }
          const res = await queryWithRetry(finalSql, flatParams);
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
