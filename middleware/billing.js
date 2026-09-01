const db = require('../db');

function isSubscriptionOrTrialActive(org) {
  if (!org) return false;
  
  // Active paid subscription
  if (org.subscription_status === 'active') return true;

  // Active trial period
  if (org.trial_ends_at) {
    const trialEnd = new Date(org.trial_ends_at);
    if (trialEnd > new Date()) return true;
  }

  return false;
}

async function checkBillingStatus(req, res, next) {
  try {
    if (!req.session || !req.session.user || !req.session.user.org_id) {
      res.locals.isBillingActive = false;
      res.locals.orgBilling = null;
      return next();
    }

    const orgId = req.session.user.org_id;
    const org = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);
    const active = isSubscriptionOrTrialActive(org);

    res.locals.isBillingActive = active;
    res.locals.orgBilling = org;
    req.isBillingActive = active;
    req.orgBilling = org;

    next();
  } catch (err) {
    res.locals.isBillingActive = false;
    res.locals.orgBilling = null;
    next();
  }
}

async function requireActiveBilling(req, res, next) {
  try {
    const orgId = req.session?.user?.org_id;
    if (!orgId) return res.redirect('/login');

    const org = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);
    const active = isSubscriptionOrTrialActive(org);

    if (active) {
      return next();
    }

    // If request is JSON / API / AJAX
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(402).json({
        error: 'BillingRequired',
        message: 'Billing details or an active trial is required to create invoices.',
        openBillingModal: true
      });
    }

    // Redirect to dashboard with trigger query param
    return res.redirect('/dashboard?billingModal=1');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  isSubscriptionOrTrialActive,
  checkBillingStatus,
  requireActiveBilling
};
