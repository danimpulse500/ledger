const db = require('../db');

async function requireActiveTenant(req, res, next) {
  try {
    if (!req.session || !req.session.user) {
      return res.redirect('/login');
    }

    const orgId = req.session.user.org_id || 1;
    const org = await db.prepare('SELECT id, name, slug, status, plan FROM organizations WHERE id = ?').get(orgId);

    if (!org) {
      return res.status(403).render('error', {
        title: 'Organization Not Found',
        message: 'The organization associated with your account could not be found.',
      });
    }

    if (org.status === 'suspended') {
      return res.status(403).render('suspended', {
        title: 'Account Suspended',
        orgName: org.name,
      });
    }

    // Attach active org details to req & res.locals for view rendering
    req.organization = org;
    res.locals.currentOrg = org;

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireActiveTenant };
