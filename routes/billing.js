const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const orgId = req.session.user.org_id;

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END), 0) AS total_billed,
      COALESCE(SUM(CASE WHEN status IN ('sent', 'overdue') THEN total - amount_paid ELSE 0 END), 0) AS outstanding,
      COALESCE(SUM(amount_paid), 0) AS collected,
      COUNT(CASE WHEN status != 'cancelled' THEN 1 END) AS invoice_count
    FROM invoices
    WHERE org_id = ?
  `).get(orgId);

  const recentInvoices = db.prepare(`
    SELECT invoices.id, invoices.invoice_number, invoices.status, invoices.total, invoices.amount_paid,
           invoices.issue_date, clients.name AS client_name
    FROM invoices
    JOIN clients ON clients.id = invoices.client_id
    WHERE invoices.org_id = ? AND invoices.status != 'cancelled'
    ORDER BY invoices.issue_date DESC, invoices.id DESC
    LIMIT 8
  `).all(orgId);

  const nextInvoice = db.prepare(`
    SELECT total - amount_paid AS amount, due_date AS date,
           (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = invoices.id) AS items
    FROM invoices
    WHERE org_id = ? AND status IN ('sent', 'overdue') AND total > amount_paid
    ORDER BY due_date ASC, id ASC
    LIMIT 1
  `).get(orgId) || { amount: 0, date: 'No upcoming invoice', items: 0 };

  const settings = db.prepare('SELECT address FROM company_settings WHERE org_id = ?').get(orgId);
  const invoiceHistory = recentInvoices.map((invoice) => ({
    id: invoice.id,
    number: invoice.invoice_number,
    date: invoice.issue_date,
    amount: invoice.total,
    status: invoice.status,
  }));

  const collectionRate = totals.total_billed > 0
    ? Math.round((totals.collected / totals.total_billed) * 100)
    : 0;

  res.render('billing', {
    title: 'Billing',
    totals,
    recentInvoices,
    collectionRate,
    plan: { name: 'Invoice billing', price: 'Usage based', interval: 'ongoing', features: 'Create and manage invoices for your organization.' },
    usage: { current: totals.invoice_count, limit: 'Unlimited', unit: 'invoices', percentage: 0 },
    nextInvoice,
    paymentMethods: [],
    billingAddress: settings ? settings.address || 'No billing address set' : 'No billing address set',
    invoiceHistory,
  });
});

module.exports = router;
