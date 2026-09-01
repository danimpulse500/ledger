-- Migration 004: Invoice logo settings

ALTER TABLE company_settings ADD COLUMN invoice_logo_path TEXT DEFAULT '';
ALTER TABLE company_settings ADD COLUMN invoice_logo_enabled INTEGER NOT NULL DEFAULT 0;
