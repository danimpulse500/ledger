-- Migration: Billing Transactions & Payment History
CREATE TABLE IF NOT EXISTS billing_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  reference TEXT UNIQUE NOT NULL,
  amount REAL NOT NULL DEFAULT 0.0,
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'success',
  plan TEXT NOT NULL DEFAULT 'starter',
  payment_method TEXT DEFAULT 'Card',
  card_brand TEXT,
  card_last4 TEXT,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
