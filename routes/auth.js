const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

function generateSlug(companyName) {
  let baseSlug = companyName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'company';
  let slug = baseSlug;
  let counter = 1;
  while (db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug)) {
    counter++;
    slug = `${baseSlug}-${counter}`;
  }
  return slug;
}

router.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.render('login', { title: 'Log In', error: null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase().trim());

  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.render('login', { title: 'Log In', error: 'Invalid email or password.' });
  }

  const org = db.prepare('SELECT id, name, slug, status FROM organizations WHERE id = ?').get(user.org_id || 1);

  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    org_id: user.org_id || 1,
    org_name: org ? org.name : 'Default Organization',
    org_slug: org ? org.slug : 'default',
  };

  res.redirect('/');
});

router.get('/signup', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  const allowedPlans = ['starter', 'pro', 'enterprise'];
  const requestedPlan = (req.query.plan || 'starter').toLowerCase();
  const selectedPlan = allowedPlans.includes(requestedPlan) ? requestedPlan : 'starter';

  res.render('signup', {
    title: 'Start Your Free Trial',
    plan: selectedPlan,
    company_name: '',
    name: '',
    email: '',
    error: null,
  });
});

router.post('/signup', (req, res) => {
  const { company_name, name, email, password, plan } = req.body;
  const allowedPlans = ['starter', 'pro', 'enterprise'];
  const selectedPlan = allowedPlans.includes((plan || '').toLowerCase()) ? plan.toLowerCase() : 'starter';

  if (!company_name || !company_name.trim() || !name || !name.trim() || !email || !email.trim() || !password || password.length < 8) {
    return res.render('signup', {
      title: 'Start Your Free Trial',
      plan: selectedPlan,
      company_name: company_name || '',
      name: name || '',
      email: email || '',
      error: 'Company name, admin name, valid email, and an 8+ character password are required.',
    });
  }

  const cleanEmail = email.toLowerCase().trim();
  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existingUser) {
    return res.render('signup', {
      title: 'Start Your Free Trial',
      plan: selectedPlan,
      company_name,
      name,
      email: cleanEmail,
      error: 'An account with that email address already exists. Please log in.',
    });
  }

  try {
    db.exec('BEGIN;');
    const slug = generateSlug(company_name);
    const orgInfo = db.prepare(`INSERT INTO organizations (name, slug, status, plan) VALUES (?, ?, 'active', ?)`).run(company_name.trim(), slug, selectedPlan);
    const orgId = orgInfo.lastInsertRowid;

    // Default settings for new organization
    db.prepare(`INSERT INTO company_settings (org_id, company_name) VALUES (?, ?)`).run(orgId, company_name.trim());

    // Admin user for new organization
    const hash = bcrypt.hashSync(password, 10);
    const userInfo = db.prepare(`INSERT INTO users (org_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')`)
      .run(orgId, name.trim(), cleanEmail, hash);
    const userId = userInfo.lastInsertRowid;

    db.exec('COMMIT;');

    req.session.user = {
      id: userId,
      name: name.trim(),
      email: cleanEmail,
      role: 'admin',
      org_id: orgId,
      org_name: company_name.trim(),
      org_slug: slug,
    };

    res.redirect('/onboarding');
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch (e) {}
    console.error('Signup error:', err);
    res.render('signup', {
      title: 'Start Your Free Trial',
      plan: selectedPlan,
      company_name,
      name,
      email: cleanEmail,
      error: 'Could not complete registration. Please try again.',
    });
  }
});

router.post('/logout', (req, res) => {
  if (req.session) {
    delete req.session.user;
  }
  res.redirect('/login');
});

module.exports = router;
