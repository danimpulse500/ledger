const express = require('express');
const db = require('../db');

const router = express.Router();

async function getSettings(orgId) {
  let settings = await db.prepare('SELECT * FROM company_settings WHERE org_id = ?').get(orgId);
  if (!settings) {
    await db.prepare(`INSERT INTO company_settings (org_id, company_name) VALUES (?, 'My Company')`).run(orgId);
    settings = await db.prepare('SELECT * FROM company_settings WHERE org_id = ?').get(orgId);
  }
  return settings;
}

router.get('/', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const settings = await getSettings(orgId);
    const clientRow = await db.prepare('SELECT COUNT(*) AS c FROM clients WHERE org_id = ?').get(orgId);
    const productRow = await db.prepare('SELECT COUNT(*) AS c FROM products WHERE org_id = ?').get(orgId);
    const invoiceRow = await db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE org_id = ?').get(orgId);

    const clientCount = clientRow ? (parseInt(clientRow.c, 10) || parseInt(clientRow.count, 10) || 0) : 0;
    const productCount = productRow ? (parseInt(productRow.c, 10) || parseInt(productRow.count, 10) || 0) : 0;
    const invoiceCount = invoiceRow ? (parseInt(invoiceRow.c, 10) || parseInt(invoiceRow.count, 10) || 0) : 0;

    res.render('onboarding', {
      title: 'Welcome & Quick Onboarding',
      settings,
      clientCount,
      productCount,
      invoiceCount,
      step: parseInt(req.query.step || '1', 10),
      success: req.query.saved ? 'Settings saved!' : null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/settings', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const { currency_symbol, address, phone, tax_id, invoice_prefix, default_tax_rate } = req.body;

    await db.prepare(`
      UPDATE company_settings
      SET currency_symbol=?, address=?, phone=?, tax_id=?, invoice_prefix=?, default_tax_rate=?, updated_at=CURRENT_TIMESTAMP
      WHERE org_id=?
    `).run(currency_symbol || '$', address || '', phone || '', tax_id || '', invoice_prefix || 'INV-', parseFloat(default_tax_rate) || 0, orgId);

    res.redirect('/onboarding?step=2&saved=1');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
