-- Migration 004: Add Paystack Billing, Subscription, and 30-Day Trial Fields to Organizations

ALTER TABLE organizations ADD COLUMN paystack_customer_code TEXT;
ALTER TABLE organizations ADD COLUMN paystack_subscription_code TEXT;
ALTER TABLE organizations ADD COLUMN paystack_auth_code TEXT;
ALTER TABLE organizations ADD COLUMN subscription_status TEXT DEFAULT 'none';
ALTER TABLE organizations ADD COLUMN trial_ends_at TEXT;
ALTER TABLE organizations ADD COLUMN card_brand TEXT;
ALTER TABLE organizations ADD COLUMN card_last4 TEXT;
ALTER TABLE organizations ADD COLUMN card_exp_month TEXT;
ALTER TABLE organizations ADD COLUMN card_exp_year TEXT;
