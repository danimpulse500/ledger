const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
const logoDirectory = path.join(__dirname, '..', 'data', 'invoice-logos');
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => {
      fs.mkdirSync(logoDirectory, { recursive: true });
      callback(null, logoDirectory);
    },
    filename: (req, file, callback) => {
      const extension = file.mimetype === 'image/png' ? '.png' : '.jpg';
      callback(null, `org-${req.session.user.org_id}-${Date.now()}${extension}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    callback(null, ['image/png', 'image/jpeg'].includes(file.mimetype));
  },
});

async function getSettings(orgId) {
  let settings = await db.prepare('SELECT * FROM company_settings WHERE org_id = ?').get(orgId);
  if (!settings) {
    await db.prepare(`INSERT INTO company_settings (org_id, company_name) VALUES (?, 'My Company')`).run(orgId);
    settings = await db.prepare('SELECT * FROM company_settings WHERE org_id = ?').get(orgId);
  }
  return settings;
}

// Dashboard
router.get('/', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const currentMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

    const draftInvoices = (await db.prepare(`
      SELECT invoices.*, clients.name AS client_name FROM invoices
      JOIN clients ON clients.id = invoices.client_id
      WHERE invoices.org_id = ? AND invoices.status = 'draft' ORDER BY created_at DESC LIMIT 8
    `).all(orgId)) || [];

    const stats = (await db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM invoices WHERE org_id = ?) AS total_invoice_count,
        (SELECT COUNT(*) FROM clients WHERE org_id = ?) AS client_count,
        (SELECT COUNT(*) FROM invoices WHERE org_id = ? AND status IN ('draft','sent')) AS active_count,
        (SELECT COUNT(*) FROM invoices WHERE org_id = ? AND status='draft') AS draft_count,
        (SELECT COUNT(*) FROM invoices WHERE org_id = ? AND status='sent') AS sent_count,
        (SELECT COUNT(*) FROM invoices WHERE org_id = ? AND status='overdue') AS overdue_count,
        (SELECT COALESCE(SUM(total-amount_paid),0) FROM invoices WHERE org_id = ? AND status IN ('sent','overdue')) AS outstanding_total,
        (SELECT COALESCE(SUM(total),0) FROM invoices WHERE org_id = ? AND status != 'cancelled' AND status != 'draft'
          AND issue_date LIKE ?) AS revenue_this_month,
        (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE org_id = ?
          AND expense_date LIKE ?) AS expenses_this_month
    `).get(orgId, orgId, orgId, orgId, orgId, orgId, orgId, orgId, `${currentMonth}%`, orgId, `${currentMonth}%`)) || {};

    const recentInvoices = (await db.prepare(`
      SELECT invoices.*, clients.name AS client_name FROM invoices
      JOIN clients ON clients.id = invoices.client_id
      WHERE invoices.org_id = ?
      ORDER BY invoices.created_at DESC LIMIT 6
    `).all(orgId)) || [];

    const recentExpenses = (await db.prepare(`
      SELECT * FROM expenses
      WHERE org_id = ?
      ORDER BY expense_date DESC, created_at DESC LIMIT 8
    `).all(orgId)) || [];

    res.render('dashboard', { title: 'Dashboard', draftInvoices, stats, recentInvoices, recentExpenses });
  } catch (err) {
    next(err);
  }
});

// Settings (admin only)
router.get('/settings', requireAdmin, async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const settings = await getSettings(orgId);
    const users = (await db.prepare('SELECT id, name, email, role, created_at FROM users WHERE org_id = ? ORDER BY name').all(orgId)) || [];
    res.render('settings', { title: 'Settings', settings, users, error: null, success: null });
  } catch (err) {
    next(err);
  }
});

router.get('/settings/logo', requireAdmin, async (req, res, next) => {
  try {
    const settings = await getSettings(req.session.user.org_id);
    if (!settings.invoice_logo_path || !fs.existsSync(settings.invoice_logo_path)) {
      return res.sendStatus(404);
    }
    res.sendFile(path.resolve(settings.invoice_logo_path));
  } catch (err) {
    next(err);
  }
});

router.post('/settings', requireAdmin, logoUpload.single('invoice_logo'), async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const { company_name, address, email, phone, tax_id, currency_symbol, invoice_prefix, default_tax_rate } = req.body;
    const existing = await getSettings(orgId);
    const logoPath = req.file ? req.file.path : (existing ? existing.invoice_logo_path || '' : '');
    const logoEnabled = req.body.invoice_logo_enabled === 'on' ? 1 : 0;
    const companyNameEnabled = req.body.invoice_company_name_enabled === 'on' ? 1 : 0;
    if (existing) {
      await db.prepare(`UPDATE company_settings SET company_name=?, address=?, email=?, phone=?, tax_id=?, currency_symbol=?, invoice_prefix=?, default_tax_rate=?, invoice_logo_path=?, invoice_logo_enabled=?, invoice_company_name_enabled=?, updated_at=CURRENT_TIMESTAMP WHERE org_id=?`)
        .run(company_name || 'My Company', address || '', email || '', phone || '', tax_id || '', currency_symbol || '$', invoice_prefix || 'INV-', parseFloat(default_tax_rate) || 0, logoPath, logoEnabled, companyNameEnabled, orgId);
    } else {
      await db.prepare(`INSERT INTO company_settings (org_id, company_name, address, email, phone, tax_id, currency_symbol, invoice_prefix, default_tax_rate, invoice_logo_path, invoice_logo_enabled, invoice_company_name_enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(orgId, company_name || 'My Company', address || '', email || '', phone || '', tax_id || '', currency_symbol || '$', invoice_prefix || 'INV-', parseFloat(default_tax_rate) || 0, logoPath, logoEnabled, companyNameEnabled);
    }
    if (req.file && existing && existing.invoice_logo_path && existing.invoice_logo_path !== logoPath) {
      fs.rmSync(existing.invoice_logo_path, { force: true });
    }

    const settings = await getSettings(orgId);
    const users = (await db.prepare('SELECT id, name, email, role, created_at FROM users WHERE org_id = ? ORDER BY name').all(orgId)) || [];
    res.render('settings', { title: 'Settings', settings, users, error: null, success: 'Settings updated.' });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/users', requireAdmin, async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const { name, email, password, role } = req.body;
    const settings = await getSettings(orgId);
    const users = (await db.prepare('SELECT id, name, email, role, created_at FROM users WHERE org_id = ? ORDER BY name').all(orgId)) || [];

    if (!name || !email || !password || password.length < 8) {
      return res.render('settings', { title: 'Settings', settings, users, error: 'Name, email, and an 8+ character password are required.', success: null });
    }
    try {
      const hash = bcrypt.hashSync(password, 10);
      await db.prepare(`INSERT INTO users (org_id, name, email, password_hash, role) VALUES (?,?,?,?,?)`)
        .run(orgId, name.trim(), email.toLowerCase().trim(), hash, role === 'admin' ? 'admin' : 'staff');
    } catch (err) {
      const updatedUsers = (await db.prepare('SELECT id, name, email, role, created_at FROM users WHERE org_id = ? ORDER BY name').all(orgId)) || [];
      return res.render('settings', { title: 'Settings', settings, users: updatedUsers, error: 'That email is already in use.', success: null });
    }
    const updatedUsers = (await db.prepare('SELECT id, name, email, role, created_at FROM users WHERE org_id = ? ORDER BY name').all(orgId)) || [];
    res.render('settings', { title: 'Settings', settings, users: updatedUsers, error: null, success: 'User created.' });
  } catch (err) {
    next(err);
  }
});

router.delete('/settings/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    if (req.session.user.id == req.params.id) {
      const settings = await getSettings(orgId);
      const users = (await db.prepare('SELECT id, name, email, role, created_at FROM users WHERE org_id = ? ORDER BY name').all(orgId)) || [];
      return res.render('settings', { title: 'Settings', settings, users, error: 'You cannot delete your own account.', success: null });
    }
    await db.prepare('DELETE FROM users WHERE id = ? AND org_id = ?').run(req.params.id, orgId);
    res.redirect('/settings');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
