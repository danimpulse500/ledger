const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;

    // Monthly revenue (based on paid/sent invoices' issue_date, last 12 months)
    const revenueRows = await db.prepare(`
      SELECT SUBSTR(issue_date, 1, 7) AS month, SUM(total) AS revenue
      FROM invoices
      WHERE org_id = ? AND status != 'cancelled' AND status != 'draft'
      GROUP BY SUBSTR(issue_date, 1, 7) ORDER BY month DESC LIMIT 12
    `).all(orgId);

    const revenueByMonth = (revenueRows || []).slice().reverse();

    const expensesByMonth = (await db.prepare(`
      SELECT SUBSTR(expense_date, 1, 7) AS month, SUM(amount) AS total
      FROM expenses WHERE org_id = ? GROUP BY SUBSTR(expense_date, 1, 7) ORDER BY month DESC LIMIT 12
    `).all(orgId)) || [];
    const expenseMap = Object.fromEntries(expensesByMonth.map((e) => [e.month, parseFloat(e.total || 0)]));

    const combined = revenueByMonth.map((r) => ({
      month: r.month,
      revenue: parseFloat(r.revenue || 0),
      expenses: expenseMap[r.month] || 0,
    }));

    const outstanding = (await db.prepare(`
      SELECT invoices.*, clients.name AS client_name FROM invoices
      JOIN clients ON clients.id = invoices.client_id
      WHERE invoices.org_id = ? AND status IN ('sent','overdue') ORDER BY due_date ASC
    `).all(orgId)) || [];
    const outstandingTotal = outstanding.reduce((s, i) => s + (parseFloat(i.total || 0) - parseFloat(i.amount_paid || 0)), 0);

    const expensesByCategory = (await db.prepare(`
      SELECT category, SUM(amount) AS total FROM expenses WHERE org_id = ? GROUP BY category ORDER BY total DESC
    `).all(orgId)) || [];

    const totals = (await db.prepare(`
      SELECT
        (SELECT COALESCE(SUM(total),0) FROM invoices WHERE org_id = ? AND status != 'cancelled' AND status != 'draft') AS total_invoiced,
        (SELECT COALESCE(SUM(amount_paid),0) FROM invoices WHERE org_id = ?) AS total_collected,
        (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE org_id = ?) AS total_expenses
    `).get(orgId, orgId, orgId)) || { total_invoiced: 0, total_collected: 0, total_expenses: 0 };

    const totalCollected = parseFloat(totals.total_collected || 0);
    const totalExpenses = parseFloat(totals.total_expenses || 0);
    const netProfit = totalCollected - totalExpenses;

    const clientCountRow = await db.prepare(`SELECT COUNT(*) AS count FROM clients WHERE org_id = ?`).get(orgId);
    const clientCount = clientCountRow ? (parseInt(clientCountRow.count, 10) || parseInt(clientCountRow.c, 10) || 0) : 0;

    res.render('reports/index', {
      title: 'Reports', combined, outstanding, outstandingTotal, expensesByCategory, totals, netProfit, clientCount,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
