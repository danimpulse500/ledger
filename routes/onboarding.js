const express = require('express');
const db = require('../db');

const router = express.Router();

function getSettings(orgId) {
  let settings = db.prepare('SELECT * FROM company_settings WHERE org_id = ?').get(orgId);
  if (!settings) {
    db.prepare(`INSERT INTO company_settings (org_id, company_name) VALUES (?, 'My Company')`).run(orgId);
    settings = db.prepare('SELECT * FROM company_settings WHERE org_id = ?').get(orgId);
  }
  return settings;
}

router.get('/', (req, res) => {
  const orgId = req.session.user.org_id;
  const settings = getSettings(orgId);
  const clientCount = db.prepare('SELECT COUNT(*) AS c FROM clients WHERE org_id = ?').get(orgId).c;
  const productCount = db.prepare('SELECT COUNT(*) AS c FROM products WHERE org_id = ?').get(orgId).c;
  const invoiceCount = db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE org_id = ?').get(orgId).c;

  res.render('onboarding', {
    title: 'Welcome & Quick Onboarding',
    settings,
    clientCount,
    productCount,
    invoiceCount,
    step: parseInt(req.query.step || '1', 10),
    success: req.query.saved ? 'Settings saved!' : null,
  });
});

router.post('/settings', (req, res) => {
  const orgId = req.session.user.org_id;
  const { currency_symbol, address, phone, tax_id, invoice_prefix, default_tax_rate } = req.body;

  db.prepare(`
    UPDATE company_settings
    SET currency_symbol=?, address=?, phone=?, tax_id=?, invoice_prefix=?, default_tax_rate=?, updated_at=datetime('now')
    WHERE org_id=?
  `).run(currency_symbol || '$', address || '', phone || '', tax_id || '', invoice_prefix || 'INV-', parseFloat(default_tax_rate) || 0, orgId);

  res.redirect('/onboarding?step=2&saved=1');
});

module.exports = router;
