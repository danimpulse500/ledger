const fs = require('fs');
const path = require('path');

function runMigrations(db) {
  // Ensure tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const migrationsDir = path.join(__dirname, '..', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  // Get list of migration files sorted
  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  // Get already applied migrations
  const appliedRows = db.prepare('SELECT name FROM schema_migrations').all();
  const appliedSet = new Set(appliedRows.map(row => row.name));

  for (const file of files) {
    if (appliedSet.has(file)) {
      continue;
    }

    console.log(`[Migrations] Applying: ${file}`);
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    try {
      db.exec('BEGIN;');
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
      db.exec('COMMIT;');
      console.log(`[Migrations] Successfully applied: ${file}`);
    } catch (err) {
      try {
        db.exec('ROLLBACK;');
      } catch (rollbackErr) {
        // ignore rollback errors if transaction was not active
      }
      console.error(`[Migrations] Failed to apply ${file}:`, err.message);
      throw err;
    }
  }
}

module.exports = { runMigrations };
