const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('./runner');

const DB_PATH = path.join(__dirname, '..', 'data', 'invoicing.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Run tracked SQL migrations
runMigrations(db);

// Ensure default company settings exist for org_id = 1
const settingsRow = db.prepare('SELECT id FROM company_settings WHERE org_id = 1').get();
if (!settingsRow) {
  db.prepare(`INSERT INTO company_settings (org_id, company_name) VALUES (1, 'My Company')`).run();
}

module.exports = db;
