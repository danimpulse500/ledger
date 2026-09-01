-- Migration 003: Platform Admins Table

CREATE TABLE IF NOT EXISTS platform_admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed initial Platform Super Admin (admin@platform.com / admin123)
INSERT INTO platform_admins (name, email, password_hash)
SELECT 'Platform Admin', 'admin@platform.com', '$2a$10$MLrke7sx/kuV15KTlM0PiOFOWDGVrNF2.fp4azDDLw.7Udiam6ama'
WHERE NOT EXISTS (SELECT 1 FROM platform_admins WHERE email = 'admin@platform.com');
