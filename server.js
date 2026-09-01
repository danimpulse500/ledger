const path = require('path');
const express = require('express');
const session = require('express-session');
const SqliteSessionStore = require('./db/session-store');
const methodOverride = require('method-override');
require('dotenv').config();

const db = require('./db');
const { requireAuth, requireAdmin, attachUser } = require('./middleware/auth');
const { requireActiveTenant } = require('./middleware/tenant');

const authRoutes = require('./routes/auth');
const platformRoutes = require('./routes/platform');
const onboardingRoutes = require('./routes/onboarding');
const dashboardRoutes = require('./routes/dashboard');
const clientsRoutes = require('./routes/clients');
const productsRoutes = require('./routes/products');
const invoicesRoutes = require('./routes/invoices');
const expensesRoutes = require('./routes/expenses');
const reportsRoutes = require('./routes/reports');
const billingRoutes = require('./routes/billing');

const app = express();
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'production') {
  const livereload = require('livereload');
  const connectLivereload = require('connect-livereload');

  const liveReloadServer = livereload.createServer({
    exts: ['js', 'css', 'html', 'ejs'],
    debug: false,
    port: 35729,
  });

  liveReloadServer.watch(path.join(__dirname, 'public'));
  liveReloadServer.watch(path.join(__dirname, 'views'));

  app.use(connectLivereload({
    port: 35729,
    ignore: [/\.git\//, /node_modules\//],
  }));
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SqliteSessionStore(path.join(__dirname, 'data', 'sessions.db')),
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    secure: process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY === 'true',
  },
}));

app.use(attachUser);
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    const orgId = req.session.user.org_id;
    const settings = db.prepare('SELECT company_name, currency_symbol, default_tax_rate FROM company_settings WHERE org_id = ?').get(orgId);
    res.locals.companyName = settings ? settings.company_name : 'My Company';
    res.locals.currencySymbol = (settings && settings.currency_symbol) ? settings.currency_symbol : '$';
    res.locals.defaultDiscountRate = settings ? settings.default_tax_rate : 0;
    res.locals.globalClients = db.prepare('SELECT id, name FROM clients WHERE org_id = ? ORDER BY name').all(orgId);
    res.locals.globalProducts = db.prepare('SELECT id, name, description, unit_price, tax_rate FROM products WHERE org_id = ? ORDER BY name').all(orgId);
  } else {
    res.locals.companyName = 'My Company';
    res.locals.currencySymbol = '$';
    res.locals.globalClients = [];
    res.locals.globalProducts = [];
  }
  next();
});

// Platform operator interface (handles its own auth)
app.use('/platform', platformRoutes);

// Public tenant auth & signup routes
app.use('/', authRoutes);

// Tenant dashboard & onboarding routes (requires login + active organization status)
app.use(requireAuth);
app.use(requireActiveTenant);

app.use('/onboarding', onboardingRoutes);
app.use('/', dashboardRoutes);
app.use('/clients', clientsRoutes);
app.use('/products', productsRoutes);
app.use('/invoices', invoicesRoutes);
app.use('/expenses', expensesRoutes);
app.use('/reports', reportsRoutes);
app.use('/billing', billingRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: 'Something went wrong. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`Invoicing app running at http://localhost:${PORT}`);
});
