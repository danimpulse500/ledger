const session = require('express-session');
const path = require('path');
const fs = require('fs');

class AppSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.isPostgres = Boolean(process.env.DATABASE_URL);

    if (this.isPostgres) {
      this.db = require('./index');
      this.pool = this.db.pool;
      this.initPg();
    } else {
      const { DatabaseSync } = require('node:sqlite');
      const dbPath = options.dbPath || path.join(__dirname, '..', 'data', 'sessions.db');
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      this.sqliteDb = new DatabaseSync(dbPath);
      this.sqliteDb.exec('PRAGMA journal_mode = WAL;');
      this.sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          sid TEXT PRIMARY KEY,
          sess TEXT NOT NULL,
          expires INTEGER
        )
      `);
    }
  }

  async initPg() {
    try {
      if (this.db) {
        await this.db.query(`
          CREATE TABLE IF NOT EXISTS sessions (
            sid VARCHAR(255) PRIMARY KEY,
            sess JSON NOT NULL,
            expires TIMESTAMPTZ
          );
        `);
      }
    } catch (err) {
      console.error('[Session Store] PG init notice:', err.message);
    }
  }

  get(sid, cb) {
    if (this.isPostgres) {
      this.db.query('SELECT sess, expires FROM sessions WHERE sid = $1', [sid])
        .then((res) => {
          const row = res.rows[0];
          if (!row) return cb(null, null);
          if (row.expires && new Date(row.expires).getTime() < Date.now()) {
            this.destroy(sid, () => {});
            return cb(null, null);
          }
          const sessData = typeof row.sess === 'string' ? JSON.parse(row.sess) : row.sess;
          cb(null, sessData);
        })
        .catch((err) => {
          console.error('[Session Store Error] get session:', err.message);
          cb(null, null);
        });
    } else {
      try {
        const row = this.sqliteDb.prepare('SELECT sess, expires FROM sessions WHERE sid = ?').get(sid);
        if (!row) return cb(null, null);
        if (row.expires && row.expires < Date.now()) {
          this.destroy(sid, () => {});
          return cb(null, null);
        }
        cb(null, JSON.parse(row.sess));
      } catch (err) {
        cb(null, null);
      }
    }
  }

  set(sid, sess, cb) {
    const expiresMs = sess.cookie && sess.cookie.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + 1000 * 60 * 60 * 24 * 7;

    if (this.isPostgres) {
      const expiresDate = new Date(expiresMs);
      this.db.query(`
        INSERT INTO sessions (sid, sess, expires) VALUES ($1, $2, $3)
        ON CONFLICT(sid) DO UPDATE SET sess = EXCLUDED.sess, expires = EXCLUDED.expires
      `, [sid, JSON.stringify(sess), expiresDate])
        .then(() => cb && cb(null))
        .catch((err) => {
          console.error('[Session Store Error] set session:', err.message);
          cb && cb(null);
        });
    } else {
      try {
        this.sqliteDb.prepare(`
          INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
          ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires
        `).run(sid, JSON.stringify(sess), expiresMs);
        cb && cb(null);
      } catch (err) {
        cb && cb(null);
      }
    }
  }

  destroy(sid, cb) {
    if (this.isPostgres) {
      this.db.query('DELETE FROM sessions WHERE sid = $1', [sid])
        .then(() => cb && cb(null))
        .catch((err) => {
          console.error('[Session Store Error] destroy session:', err.message);
          cb && cb(null);
        });
    } else {
      try {
        this.sqliteDb.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        cb && cb(null);
      } catch (err) {
        cb && cb(null);
      }
    }
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

module.exports = AppSessionStore;
