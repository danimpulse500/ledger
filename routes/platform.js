const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requirePlatformAdmin } = require('../middleware/auth');

const router = express.Router();

// Public Platform Routes
router.get('/login', (req, res) => {
  if (req.session && req.session.platformAdmin) {
    return res.redirect('/platform');
  }
  res.render('platform/login', { title: 'Platform Admin Login', error: null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const admin = db.prepare('SELECT * FROM platform_admins WHERE email = ?').get((email || '').toLowerCase().trim());

  if (!admin || !bcrypt.compareSync(password || '', admin.password_hash)) {
    return res.render('platform/login', { title: 'Platform Admin Login', error: 'Invalid platform credentials.' });
  }

  req.session.platformAdmin = {
    id: admin.id,
    name: admin.name,
    email: admin.email,
  };

  res.redirect('/platform');
});

router.post('/logout', (req, res) => {
  if (req.session) {
    delete req.session.platformAdmin;
  }
  res.redirect('/platform/login');
});

// Protected Platform Routes
router.use(requirePlatformAdmin);

// Platform Overview Dashboard
router.get('/', (req, res) => {
  const metrics = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM organizations) AS total_orgs,
      (SELECT COUNT(*) FROM organizations WHERE status = 'active') AS active_orgs,
      (SELECT COUNT(*) FROM organizations WHERE status = 'suspended') AS suspended_orgs,
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM invoices) AS total_invoices,
      (SELECT COALESCE(SUM(total), 0) FROM invoices WHERE status != 'cancelled') AS total_volume
  `).get();

  const planStats = db.prepare(`
    SELECT plan, COUNT(*) AS count FROM organizations GROUP BY plan
  `).all();

  const recentOrgs = db.prepare(`
    SELECT o.*, 
      (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS member_count,
      (SELECT COUNT(*) FROM invoices i WHERE i.org_id = o.id) AS invoice_count
    FROM organizations o
    ORDER BY o.created_at DESC LIMIT 5
  `).all();

  res.render('platform/dashboard', {
    title: 'Platform Control Center',
    metrics,
    planStats,
    recentOrgs,
  });
});

// Organizations List & Management
router.get('/organizations', (req, res) => {
  const { q, status, plan } = req.query;
  let sql = `
    SELECT o.*,
      (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS member_count,
      (SELECT COUNT(*) FROM invoices i WHERE i.org_id = o.id) AS invoice_count,
      (SELECT COALESCE(SUM(total),0) FROM invoices i WHERE i.org_id = o.id AND i.status != 'cancelled') AS total_volume
    FROM organizations o
    WHERE 1=1
  `;
  const params = [];

  if (q) {
    sql += ' AND (o.name LIKE ? OR o.slug LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (status) {
    sql += ' AND o.status = ?';
    params.push(status);
  }
  if (plan) {
    sql += ' AND o.plan = ?';
    params.push(plan);
  }

  sql += ' ORDER BY o.created_at DESC';

  const organizations = db.prepare(sql).all(...params);

  res.render('platform/organizations', {
    title: 'Organizations - Platform Admin',
    organizations,
    q: q || '',
    status: status || '',
    plan: plan || '',
    error: null,
    success: null,
  });
});

// Create New Tenant Organization
router.post('/organizations', (req, res) => {
  const { name, slug, plan, admin_name, admin_email, admin_password } = req.body;

  if (!name || !slug || !admin_name || !admin_email || !admin_password || admin_password.length < 8) {
    const organizations = db.prepare('SELECT o.*, (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS member_count FROM organizations o ORDER BY o.created_at DESC').all();
    return res.render('platform/organizations', {
      title: 'Organizations - Platform Admin',
      organizations,
      q: '', status: '', plan: '',
      error: 'Organization name, slug, admin name, admin email, and 8+ char password are required.',
      success: null,
    });
  }

  const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-');

  try {
    db.exec('BEGIN;');
    const orgInfo = db.prepare(`INSERT INTO organizations (name, slug, status, plan) VALUES (?, ?, 'active', ?)`).run(name.trim(), cleanSlug, plan || 'starter');
    const orgId = orgInfo.lastInsertRowid;

    // Create default company settings for new organization
    db.prepare(`INSERT INTO company_settings (org_id, company_name) VALUES (?, ?)`).run(orgId, name.trim());

    // Create initial admin user for new organization
    const hash = bcrypt.hashSync(admin_password, 10);
    db.prepare(`INSERT INTO users (org_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')`)
      .run(orgId, admin_name.trim(), admin_email.toLowerCase().trim(), hash);

    db.exec('COMMIT;');
    res.redirect(`/platform/organizations/${orgId}`);
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch (e) {}
    const organizations = db.prepare('SELECT o.*, (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS member_count FROM organizations o ORDER BY o.created_at DESC').all();
    return res.render('platform/organizations', {
      title: 'Organizations - Platform Admin',
      organizations,
      q: '', status: '', plan: '',
      error: `Failed to create organization: ${err.message}`,
      success: null,
    });
  }
});

// Organization Detail
router.get('/organizations/:id', (req, res) => {
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Organization not found.' });
  }

  const members = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE org_id = ? ORDER BY created_at ASC').all(org.id);
  const settings = db.prepare('SELECT * FROM company_settings WHERE org_id = ?').get(org.id);
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM invoices WHERE org_id = ?) AS invoice_count,
      (SELECT COALESCE(SUM(total),0) FROM invoices WHERE org_id = ? AND status != 'cancelled') AS total_volume,
      (SELECT COUNT(*) FROM clients WHERE org_id = ?) AS client_count,
      (SELECT COUNT(*) FROM products WHERE org_id = ?) AS product_count
  `).get(org.id, org.id, org.id, org.id);

  res.render('platform/organization_detail', {
    title: `${org.name} - Platform Admin`,
    org,
    members,
    settings,
    stats,
    error: null,
    success: req.query.updated ? 'Organization details updated successfully.' : null,
  });
});

// Toggle Organization Status (Active / Suspended)
router.post('/organizations/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) {
    return res.redirect(`/platform/organizations/${req.params.id}`);
  }

  db.prepare('UPDATE organizations SET status = ? WHERE id = ?').run(status, req.params.id);
  res.redirect(`/platform/organizations/${req.params.id}?updated=1`);
});

// Update Organization Plan
router.post('/organizations/:id/plan', (req, res) => {
  const { plan } = req.body;
  if (!['starter', 'pro', 'enterprise'].includes(plan)) {
    return res.redirect(`/platform/organizations/${req.params.id}`);
  }

  db.prepare('UPDATE organizations SET plan = ? WHERE id = ?').run(plan, req.params.id);
  res.redirect(`/platform/organizations/${req.params.id}?updated=1`);
});

module.exports = router;
