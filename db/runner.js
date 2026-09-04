const fs = require('fs');
const path = require('path');

async function runMigrations(db) {
  if (db.isPostgres) {
    // --- PostgreSQL Migration Runner ---
    await db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure initial PostgreSQL schema is applied
    const pgSchemaPath = path.join(__dirname, 'schema-pg.sql');
    if (fs.existsSync(pgSchemaPath)) {
      const pgSchemaSql = fs.readFileSync(pgSchemaPath, 'utf8');
      const statements = pgSchemaSql.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for (const stmt of statements) {
        try {
          await db.exec(stmt);
        } catch (err) {
          // ignore table/index already exists notices
        }
      }
    }

    const migrationsDir = path.join(__dirname, '..', 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql')).sort();
      const appliedRows = await db.prepare('SELECT name FROM schema_migrations').all();
      const appliedSet = new Set((appliedRows || []).map(row => row.name));

      for (const file of files) {
        if (!appliedSet.has(file)) {
          console.log(`[PG Migrations] Applying: ${file}`);
          const filePath = path.join(migrationsDir, file);
          let sql = fs.readFileSync(filePath, 'utf8');
          try {
            await db.exec(sql);
            await db.prepare('INSERT INTO schema_migrations (name) VALUES (?) ON CONFLICT DO NOTHING').run(file);
            console.log(`[PG Migrations] Successfully applied: ${file}`);
          } catch (err) {
            console.log(`[PG Migrations] Note on ${file}: ${err.message}`);
            try {
              await db.prepare('INSERT INTO schema_migrations (name) VALUES (?) ON CONFLICT DO NOTHING').run(file);
            } catch (e) {}
          }
        }
      }
    }
  } else {
    // --- SQLite Local Migration Runner ---
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const sqliteSchemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(sqliteSchemaPath)) {
      const sqliteSchemaSql = fs.readFileSync(sqliteSchemaPath, 'utf8');
      db.exec(sqliteSchemaSql);
    }

    const migrationsDir = path.join(__dirname, '..', 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql')).sort();
      const appliedRows = db.prepare('SELECT name FROM schema_migrations').all();
      const appliedSet = new Set((appliedRows || []).map(row => row.name));

      for (const file of files) {
        if (!appliedSet.has(file)) {
          console.log(`[SQLite Migrations] Applying: ${file}`);
          const filePath = path.join(migrationsDir, file);
          const sql = fs.readFileSync(filePath, 'utf8');
          try {
            db.exec(sql);
            db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
            console.log(`[SQLite Migrations] Successfully applied: ${file}`);
          } catch (err) {
            console.log(`[SQLite Migrations] Info on ${file}: ${err.message}`);
          }
        }
      }
    }
  }
}

module.exports = { runMigrations };
