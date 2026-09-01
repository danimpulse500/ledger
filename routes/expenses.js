const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const { category } = req.query;
    let sql = 'SELECT * FROM expenses WHERE org_id = ?';
    const params = [orgId];
    if (category) { sql += ' AND category = ?'; params.push(category); }
    sql += ' ORDER BY expense_date DESC, id DESC';
    const expenses = await db.prepare(sql).all(...params);
    const catRows = await db.prepare('SELECT DISTINCT category FROM expenses WHERE org_id = ? ORDER BY category').all(orgId);
    const categories = (catRows || []).map((r) => r.category);
    const total = (expenses || []).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    res.render('expenses/list', { title: 'Expenses', expenses, categories, category: category || '', total });
  } catch (err) {
    next(err);
  }
});

router.get('/new', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.render('expenses/form', { title: 'New Expense', expense: { expense_date: today }, errors: null });
});

router.post('/', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const { description, category, amount, expense_date, vendor } = req.body;
    const amt = parseFloat(amount);
    if (!description || !description.trim() || !amt || amt <= 0 || !expense_date) {
      return res.render('expenses/form', { title: 'New Expense', expense: req.body, errors: ['Description, a positive amount, and a date are required.'] });
    }
    await db.prepare(`INSERT INTO expenses (org_id, description, category, amount, expense_date, vendor, created_by) VALUES (?,?,?,?,?,?,?)`)
      .run(orgId, description.trim(), category || 'General', amt, expense_date, vendor || '', req.session.user.id);
    res.redirect('/expenses');
  } catch (err) {
    next(err);
  }
});

router.get('/:id/edit', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const expense = await db.prepare('SELECT * FROM expenses WHERE id = ? AND org_id = ?').get(req.params.id, orgId);
    if (!expense) return res.status(404).render('error', { title: 'Not Found', message: 'Expense not found.' });
    res.render('expenses/form', { title: 'Edit Expense', expense, errors: null });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const { description, category, amount, expense_date, vendor } = req.body;
    const amt = parseFloat(amount);
    if (!description || !description.trim() || !amt || amt <= 0 || !expense_date) {
      return res.render('expenses/form', { title: 'Edit Expense', expense: { ...req.body, id: req.params.id }, errors: ['Description, a positive amount, and a date are required.'] });
    }
    const result = await db.prepare(`UPDATE expenses SET description=?, category=?, amount=?, expense_date=?, vendor=? WHERE id=? AND org_id=?`)
      .run(description.trim(), category || 'General', amt, expense_date, vendor || '', req.params.id, orgId);
    if (result.changes === 0) return res.status(404).render('error', { title: 'Not Found', message: 'Expense not found.' });
    res.redirect('/expenses');
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    await db.prepare('DELETE FROM expenses WHERE id = ? AND org_id = ?').run(req.params.id, orgId);
    res.redirect('/expenses');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
