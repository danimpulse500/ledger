const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { sendVerificationEmail } = require('../utils/mailer');

const router = express.Router();

async function generateSlug(companyName) {
  let baseSlug = companyName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'company';
  let slug = baseSlug;
  let counter = 1;
  while (await db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug)) {
    counter++;
    slug = `${baseSlug}-${counter}`;
  }
  return slug;
}

router.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.render('login', { title: 'Log In', error: null });
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const cleanEmail = (email || '').toLowerCase().trim();
    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
      return res.render('login', { title: 'Log In', error: 'Invalid email or password.' });
    }

    if (user.is_verified === 0 || user.is_verified === false) {
      return res.render('verify-email-pending', {
        title: 'Verify Your Email',
        email: user.email,
        successMessage: null,
        error: 'Please verify your email address before logging in. Check your inbox for the activation link.',
      });
    }

    const org = await db.prepare('SELECT id, name, slug, status FROM organizations WHERE id = ?').get(user.org_id || 1);

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
  } catch (err) {
    next(err);
  }
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

router.post('/signup', async (req, res, next) => {
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
  const existingUser = await db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
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
    await db.exec('BEGIN;');
    const slug = await generateSlug(company_name);
    const orgInfo = await db.prepare(`INSERT INTO organizations (name, slug, status, plan) VALUES (?, ?, 'active', ?)`).run(company_name.trim(), slug, selectedPlan);
    const orgId = orgInfo.lastInsertRowid;

    // Default settings for new organization
    await db.prepare(`INSERT INTO company_settings (org_id, company_name) VALUES (?, ?)`).run(orgId, company_name.trim());

    // Generate email verification token (valid for 24h)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Admin user for new organization (unverified initially)
    const hash = bcrypt.hashSync(password, 10);
    await db.prepare(`INSERT INTO users (org_id, name, email, password_hash, role, is_verified, verification_token, verification_token_expires_at) VALUES (?, ?, ?, ?, 'admin', 0, ?, ?)`)
      .run(orgId, name.trim(), cleanEmail, hash, token, expiresAt);

    await db.exec('COMMIT;');

    // Send email verification message
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    await sendVerificationEmail({
      recipientEmail: cleanEmail,
      name: name.trim(),
      token,
      baseUrl,
    });

    res.render('verify-email-pending', {
      title: 'Verify Your Email',
      email: cleanEmail,
      successMessage: null,
      error: null,
    });
  } catch (err) {
    try { await db.exec('ROLLBACK;'); } catch (e) {}
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

router.get('/verify-email-pending', (req, res) => {
  const email = req.query.email || '';
  res.render('verify-email-pending', {
    title: 'Verify Your Email',
    email,
    successMessage: null,
    error: null,
  });
});

router.post('/resend-verification', async (req, res, next) => {
  try {
    const { email } = req.body;
    const cleanEmail = (email || '').toLowerCase().trim();

    if (!cleanEmail) {
      return res.render('verify-email-pending', {
        title: 'Verify Your Email',
        email: '',
        successMessage: null,
        error: 'Please provide a valid email address.',
      });
    }

    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    if (!user) {
      return res.render('verify-email-pending', {
        title: 'Verify Your Email',
        email: cleanEmail,
        successMessage: null,
        error: 'No account found with that email address.',
      });
    }

    if (user.is_verified === 1 || user.is_verified === true) {
      return res.render('login', {
        title: 'Log In',
        error: 'Your email address is already verified. Please log in.',
      });
    }

    // Generate new token and expiration
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await db.prepare('UPDATE users SET verification_token = ?, verification_token_expires_at = ? WHERE id = ?')
      .run(token, expiresAt, user.id);

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    await sendVerificationEmail({
      recipientEmail: user.email,
      name: user.name,
      token,
      baseUrl,
    });

    res.render('verify-email-pending', {
      title: 'Verify Your Email',
      email: user.email,
      successMessage: 'A new verification link has been sent to your email inbox.',
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.render('verify-email-result', {
        title: 'Email Verification',
        success: false,
        message: 'Verification token is missing.',
        email: null,
      });
    }

    const user = await db.prepare('SELECT * FROM users WHERE verification_token = ?').get(token);

    if (!user) {
      return res.render('verify-email-result', {
        title: 'Email Verification',
        success: false,
        message: 'This verification link is invalid or has already been used.',
        email: null,
      });
    }

    // Check token expiration
    if (user.verification_token_expires_at && new Date(user.verification_token_expires_at) < new Date()) {
      return res.render('verify-email-result', {
        title: 'Email Verification',
        success: false,
        message: 'This verification link has expired. Please request a new verification link.',
        email: user.email,
      });
    }

    // Mark user as verified and clear verification tokens
    await db.prepare('UPDATE users SET is_verified = 1, verification_token = NULL, verification_token_expires_at = NULL WHERE id = ?')
      .run(user.id);

    const org = await db.prepare('SELECT id, name, slug, status FROM organizations WHERE id = ?').get(user.org_id || 1);

    // Auto log-in user
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      org_id: user.org_id || 1,
      org_name: org ? org.name : 'Default Organization',
      org_slug: org ? org.slug : 'default',
    };

    res.render('verify-email-result', {
      title: 'Email Verification',
      success: true,
      email: user.email,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  if (req.session) {
    delete req.session.user;
  }
  res.redirect('/login');
});

module.exports = router;
