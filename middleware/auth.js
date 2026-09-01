function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  return res.status(403).render('error', {
    title: 'Access Denied',
    message: 'You need administrator access to view this page.',
    user: req.session.user || null,
  });
}

function requirePlatformAdmin(req, res, next) {
  if (req.session && req.session.platformAdmin) {
    return next();
  }
  return res.redirect('/platform/login');
}

// Makes logged-in user / platform admin available to all views
function attachUser(req, res, next) {
  res.locals.currentUser = (req.session && req.session.user) || null;
  res.locals.currentPlatformAdmin = (req.session && req.session.platformAdmin) || null;
  next();
}

module.exports = { requireAuth, requireAdmin, requirePlatformAdmin, attachUser };
