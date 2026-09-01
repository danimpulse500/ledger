-- Migration 002: Add Organizations and Multi-Tenancy Scoping

-- 1. Create Organizations Table
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  plan TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'pro', 'enterprise')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Seed Default Organization (id = 1)
INSERT INTO organizations (id, name, slug, status, plan)
SELECT 1, 'Default Organization', 'default', 'active', 'starter'
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE id = 1);

-- 3. Add org_id column to users, clients, products, invoices, expenses
ALTER TABLE users ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE clients ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE invoices ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE expenses ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1;

-- 4. Re-create company_settings table to support per-organization settings
CREATE TABLE company_settings_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL UNIQUE REFERENCES organizations(id),
  company_name TEXT NOT NULL DEFAULT 'My Company',
  address TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  tax_id TEXT DEFAULT '',
  currency_symbol TEXT DEFAULT '$',
  invoice_prefix TEXT DEFAULT 'INV-',
  next_invoice_number INTEGER DEFAULT 1001,
  default_tax_rate REAL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO company_settings_new (id, org_id, company_name, address, email, phone, tax_id, currency_symbol, invoice_prefix, next_invoice_number, default_tax_rate)
SELECT id, 1, company_name, address, email, phone, tax_id, currency_symbol, invoice_prefix, next_invoice_number, default_tax_rate
FROM company_settings;

DROP TABLE company_settings;
ALTER TABLE company_settings_new RENAME TO company_settings;

-- 5. Create performance indexes for org_id scoping
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_clients_org ON clients(org_id);
CREATE INDEX IF NOT EXISTS idx_products_org ON products(org_id);
CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_expenses_org ON expenses(org_id);
