const express = require('express');
const db = require('../db');

const router = express.Router();

// List
router.get('/', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const q = (req.query.q || '').trim();
    let clients;
    if (q) {
      clients = await db.prepare(`SELECT * FROM clients WHERE org_id = ? AND (name LIKE ? OR email LIKE ?) ORDER BY name`)
        .all(orgId, `%${q}%`, `%${q}%`);
    } else {
      clients = await db.prepare('SELECT * FROM clients WHERE org_id = ? ORDER BY name').all(orgId);
    }
    res.render('clients/list', { title: 'Clients', clients, q });
  } catch (err) {
    next(err);
  }
});

// New form
router.get('/new', (req, res) => {
  res.render('clients/form', { title: 'New Client', clientRecord: {}, errors: null });
});

// Create
router.post('/', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const { name, email, phone, address, tax_id, notes } = req.body;
    if (!name || !name.trim()) {
      return res.render('clients/form', { title: 'New Client', clientRecord: req.body, errors: ['Client name is required.'] });
    }
    const info = await db.prepare(`INSERT INTO clients (org_id, name, email, phone, address, tax_id, notes) VALUES (?,?,?,?,?,?,?)`)
      .run(orgId, name.trim(), email || '', phone || '', address || '', tax_id || '', notes || '');
    res.redirect(`/clients/${info.lastInsertRowid}`);
  } catch (err) {
    next(err);
  }
});

// Show (with invoice history)
router.get('/:id', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const clientRecord = await db.prepare('SELECT * FROM clients WHERE id = ? AND org_id = ?').get(req.params.id, orgId);
    if (!clientRecord) return res.status(404).render('error', { title: 'Not Found', message: 'Client not found.' });
    const invoices = await db.prepare(`SELECT * FROM invoices WHERE client_id = ? AND org_id = ? ORDER BY issue_date DESC`).all(req.params.id, orgId);
    res.render('clients/show', { title: clientRecord.name, clientRecord, invoices });
  } catch (err) {
    next(err);
  }
});

// Edit form
router.get('/:id/edit', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const clientRecord = await db.prepare('SELECT * FROM clients WHERE id = ? AND org_id = ?').get(req.params.id, orgId);
    if (!clientRecord) return res.status(404).render('error', { title: 'Not Found', message: 'Client not found.' });
    res.render('clients/form', { title: 'Edit Client', clientRecord, errors: null });
  } catch (err) {
    next(err);
  }
});

// Update
router.put('/:id', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const { name, email, phone, address, tax_id, notes } = req.body;
    if (!name || !name.trim()) {
      return res.render('clients/form', { title: 'Edit Client', clientRecord: { ...req.body, id: req.params.id }, errors: ['Client name is required.'] });
    }
    const result = await db.prepare(`UPDATE clients SET name=?, email=?, phone=?, address=?, tax_id=?, notes=? WHERE id=? AND org_id=?`)
      .run(name.trim(), email || '', phone || '', address || '', tax_id || '', notes || '', req.params.id, orgId);
    if (result.changes === 0) return res.status(404).render('error', { title: 'Not Found', message: 'Client not found.' });
    res.redirect(`/clients/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// Delete
router.delete('/:id', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const invCount = await db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE client_id = ? AND org_id = ?').get(req.params.id, orgId);
    const countVal = invCount ? (parseInt(invCount.c, 10) || parseInt(invCount.count, 10) || 0) : 0;
    if (countVal > 0) {
      const clientRecord = await db.prepare('SELECT * FROM clients WHERE id = ? AND org_id = ?').get(req.params.id, orgId);
      const invoices = await db.prepare(`SELECT * FROM invoices WHERE client_id = ? AND org_id = ? ORDER BY issue_date DESC`).all(req.params.id, orgId);
      return res.status(400).render('clients/show', {
        title: clientRecord ? clientRecord.name : 'Client', clientRecord, invoices,
        error: 'Cannot delete a client with existing invoices. Delete their invoices first.',
      });
    }
    await db.prepare('DELETE FROM clients WHERE id = ? AND org_id = ?').run(req.params.id, orgId);
    res.redirect('/clients');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
