const express = require('express');
const db = require('../db');
const { generateInvoicePDF } = require('../utils/pdf-generator');
const { sendInvoiceEmail } = require('../utils/mailer');

const router = express.Router();

function getSettings(orgId) {
  let settings = db.prepare('SELECT * FROM company_settings WHERE org_id = ?').get(orgId);
  if (!settings) {
    db.prepare(`INSERT INTO company_settings (org_id, company_name) VALUES (?, 'My Company')`).run(orgId);
    settings = db.prepare('SELECT * FROM company_settings WHERE org_id = ?').get(orgId);
  }
  return settings;
}

function nextInvoiceNumber(orgId) {
  const settings = getSettings(orgId);
  const number = `${settings.invoice_prefix || 'INV-'}${settings.next_invoice_number || 1001}`;
  db.prepare('UPDATE company_settings SET next_invoice_number = next_invoice_number + 1 WHERE org_id = ?').run(orgId);
  return number;
}

// Normalize the `items` field from a form submission into a clean array.
function parseItems(body) {
  if (!body.items) return [];
  const raw = Array.isArray(body.items) ? body.items : Object.values(body.items);
  return raw
    .filter((it) => it && it.description && it.description.trim())
    .map((it) => {
      const quantity = parseFloat(it.quantity) || 0;
      const unit_price = parseFloat(it.unit_price) || 0;
      const discount_rate = parseFloat(it.tax_rate) || 0;
      const line_subtotal = quantity * unit_price;
      const line_discount = line_subtotal * (discount_rate / 100);
      return {
        product_id: it.product_id ? parseInt(it.product_id, 10) : null,
        description: it.description.trim(),
        quantity,
        unit_price,
        tax_rate: discount_rate,
        line_total: line_subtotal - line_discount,
      };
    });
}

function recalcInvoiceTotals(invoiceId, orgId) {
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoiceId);
  const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
  const discount_total = items.reduce((s, it) => s + it.quantity * it.unit_price * (it.tax_rate / 100), 0);
  const total = subtotal - discount_total;
  db.prepare('UPDATE invoices SET subtotal=?, tax_total=?, total=? WHERE id=? AND org_id=?').run(subtotal, discount_total, total, invoiceId, orgId);
}

function refreshPaidStatus(invoiceId, orgId) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?').get(invoiceId, orgId);
  if (!invoice) return;
  const paidRow = db.prepare('SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE invoice_id = ?').get(invoiceId);
  const amount_paid = paidRow.paid;
  let status = invoice.status;
  if (status !== 'cancelled' && status !== 'draft') {
    if (amount_paid >= invoice.total && invoice.total > 0) {
      status = 'paid';
    } else if (new Date(invoice.due_date) < new Date() && amount_paid < invoice.total) {
      status = 'overdue';
    } else if (status === 'paid' || status === 'overdue') {
      status = 'sent';
    }
  }
  db.prepare('UPDATE invoices SET amount_paid=?, status=? WHERE id=? AND org_id=?').run(amount_paid, status, invoiceId, orgId);
}

// List
router.get('/', (req, res) => {
  const orgId = req.session.user.org_id;
  const { status, q } = req.query;
  let sql = `SELECT invoices.*, clients.name AS client_name FROM invoices
             JOIN clients ON clients.id = invoices.client_id WHERE invoices.org_id = ?`;
  const params = [orgId];
  if (status) { sql += ' AND invoices.status = ?'; params.push(status); }
  if (q) { sql += ' AND (invoices.invoice_number LIKE ? OR clients.name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY invoices.issue_date DESC, invoices.id DESC';
  const invoices = db.prepare(sql).all(...params);
  const settings = getSettings(orgId);
  res.render('invoices/list', { title: 'Invoices', invoices, status: status || '', q: q || '', settings });
});

// New form
router.get('/new', (req, res) => {
  const orgId = req.session.user.org_id;
  const clients = db.prepare('SELECT * FROM clients WHERE org_id = ? ORDER BY name').all(orgId);
  const products = db.prepare('SELECT * FROM products WHERE org_id = ? ORDER BY name').all(orgId);
  const settings = getSettings(orgId);
  const today = new Date().toISOString().slice(0, 10);
  const dueDate = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  res.render('invoices/form', {
    title: 'New Invoice', invoice: { issue_date: today, due_date: dueDate, status: 'draft' },
    items: [], clients, products, settings, errors: null,
    preselectClientId: req.query.client_id || null,
  });
});

// Create
router.post('/', (req, res) => {
  const orgId = req.session.user.org_id;
  const { client_id, issue_date, due_date, status, notes } = req.body;
  const items = parseItems(req.body);

  if (!client_id || !issue_date || !due_date || items.length === 0) {
    const clients = db.prepare('SELECT * FROM clients WHERE org_id = ? ORDER BY name').all(orgId);
    const products = db.prepare('SELECT * FROM products WHERE org_id = ? ORDER BY name').all(orgId);
    return res.render('invoices/form', {
      title: 'New Invoice', invoice: req.body, items, clients, products, settings: getSettings(orgId),
      errors: ['Client, issue date, due date, and at least one line item are required.'],
    });
  }

  const invoice_number = nextInvoiceNumber(orgId);
  const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
  const discount_total = items.reduce((s, it) => s + it.quantity * it.unit_price * (it.tax_rate / 100), 0);
  const total = subtotal - discount_total;

  const info = db.prepare(`INSERT INTO invoices
    (org_id, invoice_number, client_id, issue_date, due_date, status, notes, subtotal, tax_total, total, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(orgId, invoice_number, client_id, issue_date, due_date, status || 'draft', notes || '', subtotal, discount_total, total, req.session.user.id);

  const invoiceId = info.lastInsertRowid;
  const insertItem = db.prepare(`INSERT INTO invoice_items
    (invoice_id, product_id, description, quantity, unit_price, tax_rate, line_total) VALUES (?,?,?,?,?,?,?)`);
  for (const it of items) {
    insertItem.run(invoiceId, it.product_id, it.description, it.quantity, it.unit_price, it.tax_rate, it.line_total);
  }

  res.redirect(`/invoices/${invoiceId}`);
});

// Show (printable invoice view)
router.get('/:id', (req, res) => {
  const orgId = req.session.user.org_id;
  const invoice = db.prepare(`SELECT invoices.*, clients.name AS client_name, clients.email AS client_email,
    clients.address AS client_address, clients.tax_id AS client_tax_id
    FROM invoices JOIN clients ON clients.id = invoices.client_id WHERE invoices.id = ? AND invoices.org_id = ?`).get(req.params.id, orgId);
  if (!invoice) return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date').all(req.params.id);
  const settings = getSettings(orgId);
  res.render('invoices/show', {
    title: invoice.invoice_number,
    invoice,
    items,
    payments,
    settings,
    emailSent: req.query.emailSent === '1',
    emailError: req.query.emailError || null,
    msg: req.query.msg || null,
  });
});

// Download / View PDF
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const invoice = db.prepare(`SELECT invoices.*, clients.name AS client_name, clients.email AS client_email,
      clients.address AS client_address, clients.tax_id AS client_tax_id
      FROM invoices JOIN clients ON clients.id = invoices.client_id WHERE invoices.id = ? AND invoices.org_id = ?`).get(req.params.id, orgId);
    if (!invoice) return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });

    const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);
    const settings = getSettings(orgId);

    const pdfBuffer = await generateInvoicePDF(invoice, items, settings);

    const filename = `${invoice.invoice_number}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

// Send invoice email to client with PDF attachment
router.post('/:id/send', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const invoice = db.prepare(`SELECT invoices.*, clients.name AS client_name, clients.email AS client_email,
      clients.address AS client_address, clients.tax_id AS client_tax_id
      FROM invoices JOIN clients ON clients.id = invoices.client_id WHERE invoices.id = ? AND invoices.org_id = ?`).get(req.params.id, orgId);
    if (!invoice) return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });

    const recipientEmail = (req.body.recipient_email || invoice.client_email || 'daviddominic767@gmail.com').trim();
    if (!recipientEmail) {
      return res.redirect(`/invoices/${req.params.id}?emailError=Recipient email address is required.`);
    }

    const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);
    const settings = getSettings(orgId);

    const pdfBuffer = await generateInvoicePDF(invoice, items, settings);

    const result = await sendInvoiceEmail({
      invoice,
      items,
      settings,
      recipientEmail,
      pdfBuffer,
      customNote: req.body.custom_note,
    });

    // Auto-update status to 'sent' if currently 'draft'
    if (invoice.status === 'draft') {
      db.prepare("UPDATE invoices SET status = 'sent' WHERE id = ? AND org_id = ?").run(req.params.id, orgId);
    }

    const msg = encodeURIComponent(result.message);
    res.redirect(`/invoices/${req.params.id}?emailSent=1&msg=${msg}`);
  } catch (err) {
    console.error('Failed to send invoice email:', err);
    res.redirect(`/invoices/${req.params.id}?emailError=${encodeURIComponent(err.message)}`);
  }
});

// Edit form
router.get('/:id/edit', (req, res) => {
  const orgId = req.session.user.org_id;
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?').get(req.params.id, orgId);
  if (!invoice) return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);
  const clients = db.prepare('SELECT * FROM clients WHERE org_id = ? ORDER BY name').all(orgId);
  const products = db.prepare('SELECT * FROM products WHERE org_id = ? ORDER BY name').all(orgId);
  res.render('invoices/form', { title: `Edit ${invoice.invoice_number}`, invoice, items, clients, products, settings: getSettings(orgId), errors: null });
});

// Update
router.put('/:id', (req, res) => {
  const orgId = req.session.user.org_id;
  const { client_id, issue_date, due_date, status, notes } = req.body;
  const items = parseItems(req.body);
  const invoiceId = req.params.id;

  const existing = db.prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?').get(invoiceId, orgId);
  if (!existing) return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });

  if (!client_id || !issue_date || !due_date || items.length === 0) {
    const clients = db.prepare('SELECT * FROM clients WHERE org_id = ? ORDER BY name').all(orgId);
    const products = db.prepare('SELECT * FROM products WHERE org_id = ? ORDER BY name').all(orgId);
    return res.render('invoices/form', {
      title: 'Edit Invoice', invoice: { ...req.body, id: invoiceId }, items, clients, products, settings: getSettings(orgId),
      errors: ['Client, issue date, due date, and at least one line item are required.'],
    });
  }

  db.prepare(`UPDATE invoices SET client_id=?, issue_date=?, due_date=?, status=?, notes=? WHERE id=? AND org_id=?`)
    .run(client_id, issue_date, due_date, status || 'draft', notes || '', invoiceId, orgId);

  db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
  const insertItem = db.prepare(`INSERT INTO invoice_items
    (invoice_id, product_id, description, quantity, unit_price, tax_rate, line_total) VALUES (?,?,?,?,?,?,?)`);
  for (const it of items) {
    insertItem.run(invoiceId, it.product_id, it.description, it.quantity, it.unit_price, it.tax_rate, it.line_total);
  }
  recalcInvoiceTotals(invoiceId, orgId);
  refreshPaidStatus(invoiceId, orgId);

  res.redirect(`/invoices/${invoiceId}`);
});

// Quick status change
router.post('/:id/status', (req, res) => {
  const orgId = req.session.user.org_id;
  const { status, redirect } = req.body;
  const allowed = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];
  if (allowed.includes(status)) {
    db.prepare('UPDATE invoices SET status=? WHERE id=? AND org_id=?').run(status, req.params.id, orgId);
  }
  res.redirect(redirect || `/invoices/${req.params.id}`);
});

// Record a payment
router.post('/:id/payments', (req, res) => {
  const orgId = req.session.user.org_id;
  const invoice = db.prepare('SELECT id FROM invoices WHERE id = ? AND org_id = ?').get(req.params.id, orgId);
  if (!invoice) return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });

  const { amount, payment_date, method, notes } = req.body;
  const amt = parseFloat(amount);
  if (amt && amt > 0) {
    db.prepare(`INSERT INTO payments (invoice_id, amount, payment_date, method, notes) VALUES (?,?,?,?,?)`)
      .run(req.params.id, amt, payment_date || new Date().toISOString().slice(0, 10), method || '', notes || '');
    refreshPaidStatus(req.params.id, orgId);
  }
  res.redirect(`/invoices/${req.params.id}`);
});

// Delete a payment
router.delete('/:id/payments/:paymentId', (req, res) => {
  const orgId = req.session.user.org_id;
  const invoice = db.prepare('SELECT id FROM invoices WHERE id = ? AND org_id = ?').get(req.params.id, orgId);
  if (!invoice) return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });

  db.prepare('DELETE FROM payments WHERE id = ? AND invoice_id = ?').run(req.params.paymentId, req.params.id);
  refreshPaidStatus(req.params.id, orgId);
  res.redirect(`/invoices/${req.params.id}`);
});

// Delete invoice
router.delete('/:id', (req, res) => {
  const orgId = req.session.user.org_id;
  db.prepare('DELETE FROM invoices WHERE id = ? AND org_id = ?').run(req.params.id, orgId);
  res.redirect('/invoices');
});

module.exports = router;
