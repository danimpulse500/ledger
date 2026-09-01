-- Migration 005: Invoice company name visibility

ALTER TABLE company_settings ADD COLUMN invoice_company_name_enabled INTEGER NOT NULL DEFAULT 1;
