const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const orgId = req.session.user.org_id;

  // Monthly revenue (based on paid/sent invoices' issue_date, last 12 months)
  const revenueByMonth = db.prepare(`
    SELECT strftime('%Y-%m', issue_date) AS month, SUM(total) AS revenue
    FROM invoices
    WHERE org_id = ? AND status != 'cancelled' AND status != 'draft'
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all(orgId).reverse();

  const expensesByMonth = db.prepare(`
    SELECT strftime('%Y-%m', expense_date) AS month, SUM(amount) AS total
    FROM expenses WHERE org_id = ? GROUP BY month ORDER BY month DESC LIMIT 12
  `).all(orgId);
  const expenseMap = Object.fromEntries(expensesByMonth.map((e) => [e.month, e.total]));

  const combined = revenueByMonth.map((r) => ({
    month: r.month,
    revenue: r.revenue || 0,
    expenses: expenseMap[r.month] || 0,
  }));

  const outstanding = db.prepare(`
    SELECT invoices.*, clients.name AS client_name FROM invoices
    JOIN clients ON clients.id = invoices.client_id
    WHERE invoices.org_id = ? AND status IN ('sent','overdue') ORDER BY due_date ASC
  `).all(orgId);
  const outstandingTotal = outstanding.reduce((s, i) => s + (i.total - i.amount_paid), 0);

  const expensesByCategory = db.prepare(`
    SELECT category, SUM(amount) AS total FROM expenses WHERE org_id = ? GROUP BY category ORDER BY total DESC
  `).all(orgId);

  const totals = db.prepare(`
    SELECT
      (SELECT COALESCE(SUM(total),0) FROM invoices WHERE org_id = ? AND status != 'cancelled' AND status != 'draft') AS total_invoiced,
      (SELECT COALESCE(SUM(amount_paid),0) FROM invoices WHERE org_id = ?) AS total_collected,
      (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE org_id = ?) AS total_expenses
  `).get(orgId, orgId, orgId);
  const netProfit = totals.total_collected - totals.total_expenses;
  const clientCount = db.prepare(`SELECT COUNT(*) AS count FROM clients WHERE org_id = ?`).get(orgId).count;

  res.render('reports/index', {
    title: 'Reports', combined, outstanding, outstandingTotal, expensesByCategory, totals, netProfit, clientCount,
  });
});

module.exports = router;
