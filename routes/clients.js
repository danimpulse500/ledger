const express = require('express');
const db = require('../db');

const router = express.Router();

// List
router.get('/', (req, res) => {
  const orgId = req.session.user.org_id;
  const q = (req.query.q || '').trim();
  let clients;
  if (q) {
    clients = db.prepare(`SELECT * FROM clients WHERE org_id = ? AND (name LIKE ? OR email LIKE ?) ORDER BY name`)
      .all(orgId, `%${q}%`, `%${q}%`);
  } else {
    clients = db.prepare('SELECT * FROM clients WHERE org_id = ? ORDER BY name').all(orgId);
  }
  res.render('clients/list', { title: 'Clients', clients, q });
});

// New form
router.get('/new', (req, res) => {
  res.render('clients/form', { title: 'New Client', clientRecord: {}, errors: null });
});

// Create
router.post('/', (req, res) => {
  const orgId = req.session.user.org_id;
  const { name, email, phone, address, tax_id, notes } = req.body;
  if (!name || !name.trim()) {
    return res.render('clients/form', { title: 'New Client', clientRecord: req.body, errors: ['Client name is required.'] });
  }
  const info = db.prepare(`INSERT INTO clients (org_id, name, email, phone, address, tax_id, notes) VALUES (?,?,?,?,?,?,?)`)
    .run(orgId, name.trim(), email || '', phone || '', address || '', tax_id || '', notes || '');
  res.redirect(`/clients/${info.lastInsertRowid}`);
});

// Show (with invoice history)
router.get('/:id', (req, res) => {
  const orgId = req.session.user.org_id;
  const clientRecord = db.prepare('SELECT * FROM clients WHERE id = ? AND org_id = ?').get(req.params.id, orgId);
  if (!clientRecord) return res.status(404).render('error', { title: 'Not Found', message: 'Client not found.' });
  const invoices = db.prepare(`SELECT * FROM invoices WHERE client_id = ? AND org_id = ? ORDER BY issue_date DESC`).all(req.params.id, orgId);
  res.render('clients/show', { title: clientRecord.name, clientRecord, invoices });
});

// Edit form
router.get('/:id/edit', (req, res) => {
  const orgId = req.session.user.org_id;
  const clientRecord = db.prepare('SELECT * FROM clients WHERE id = ? AND org_id = ?').get(req.params.id, orgId);
  if (!clientRecord) return res.status(404).render('error', { title: 'Not Found', message: 'Client not found.' });
  res.render('clients/form', { title: 'Edit Client', clientRecord, errors: null });
});

// Update
router.put('/:id', (req, res) => {
  const orgId = req.session.user.org_id;
  const { name, email, phone, address, tax_id, notes } = req.body;
  if (!name || !name.trim()) {
    return res.render('clients/form', { title: 'Edit Client', clientRecord: { ...req.body, id: req.params.id }, errors: ['Client name is required.'] });
  }
  const result = db.prepare(`UPDATE clients SET name=?, email=?, phone=?, address=?, tax_id=?, notes=? WHERE id=? AND org_id=?`)
    .run(name.trim(), email || '', phone || '', address || '', tax_id || '', notes || '', req.params.id, orgId);
  if (result.changes === 0) return res.status(404).render('error', { title: 'Not Found', message: 'Client not found.' });
  res.redirect(`/clients/${req.params.id}`);
});

// Delete
router.delete('/:id', (req, res) => {
  const orgId = req.session.user.org_id;
  const invCount = db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE client_id = ? AND org_id = ?').get(req.params.id, orgId);
  if (invCount && invCount.c > 0) {
    const clientRecord = db.prepare('SELECT * FROM clients WHERE id = ? AND org_id = ?').get(req.params.id, orgId);
    const invoices = db.prepare(`SELECT * FROM invoices WHERE client_id = ? AND org_id = ? ORDER BY issue_date DESC`).all(req.params.id, orgId);
    return res.status(400).render('clients/show', {
      title: clientRecord ? clientRecord.name : 'Client', clientRecord, invoices,
      error: 'Cannot delete a client with existing invoices. Delete their invoices first.',
    });
  }
  db.prepare('DELETE FROM clients WHERE id = ? AND org_id = ?').run(req.params.id, orgId);
  res.redirect('/clients');
});

module.exports = router;
