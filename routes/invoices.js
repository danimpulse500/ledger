const express = require('express');
const db = require('../db');
const { generateInvoicePDF } = require('../utils/pdf-generator');
const { sendInvoiceEmail } = require('../utils/mailer');
const { requireActiveBilling } = require('../middleware/billing');

const router = express.Router();

async function getSettings(orgId) {
  let settings = await db.prepare('SELECT * FROM company_settings WHERE org_id = ?').get(orgId);
  if (!settings) {
    await db.prepare(`INSERT INTO company_settings (org_id, company_name) VALUES (?, 'My Company')`).run(orgId);
    settings = await db.prepare('SELECT * FROM company_settings WHERE org_id = ?').get(orgId);
  }
  return settings;
}

async function nextInvoiceNumber(orgId) {
  const settings = await getSettings(orgId);
  const number = `${settings.invoice_prefix || 'INV-'}${settings.next_invoice_number || 1001}`;
  await db.prepare('UPDATE company_settings SET next_invoice_number = next_invoice_number + 1 WHERE org_id = ?').run(orgId);
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

async function recalcInvoiceTotals(invoiceId, orgId) {
  const items = (await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoiceId)) || [];
  const subtotal = items.reduce((s, it) => s + parseFloat(it.quantity || 0) * parseFloat(it.unit_price || 0), 0);
  const discount_total = items.reduce((s, it) => s + parseFloat(it.quantity || 0) * parseFloat(it.unit_price || 0) * (parseFloat(it.tax_rate || 0) / 100), 0);
  const total = subtotal - discount_total;
  await db.prepare('UPDATE invoices SET subtotal=?, tax_total=?, total=? WHERE id=? AND org_id=?').run(subtotal, discount_total, total, invoiceId, orgId);
}

async function refreshPaidStatus(invoiceId, orgId) {
  const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?').get(invoiceId, orgId);
  if (!invoice) return;
  const paidRow = await db.prepare('SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE invoice_id = ?').get(invoiceId);
  const amount_paid = paidRow ? parseFloat(paidRow.paid || 0) : 0;
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
  await db.prepare('UPDATE invoices SET amount_paid=?, status=? WHERE id=? AND org_id=?').run(amount_paid, status, invoiceId, orgId);
}

// List
router.get('/', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const { status, q } = req.query;
    let sql = `SELECT invoices.*, clients.name AS client_name FROM invoices
               JOIN clients ON clients.id = invoices.client_id WHERE invoices.org_id = ?`;
    const params = [orgId];
    if (status) { sql += ' AND invoices.status = ?'; params.push(status); }
    if (q) { sql += ' AND (invoices.invoice_number LIKE ? OR clients.name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    sql += ' ORDER BY invoices.issue_date DESC, invoices.id DESC';
    const invoices = (await db.prepare(sql).all(...params)) || [];
    const settings = await getSettings(orgId);
    res.render('invoices/list', { title: 'Invoices', invoices, status: status || '', q: q || '', settings });
  } catch (err) {
    next(err);
  }
});

// New form
router.get('/new', requireActiveBilling, async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const clients = (await db.prepare('SELECT * FROM clients WHERE org_id = ? ORDER BY name').all(orgId)) || [];
    const products = (await db.prepare('SELECT * FROM products WHERE org_id = ? ORDER BY name').all(orgId)) || [];
    const settings = await getSettings(orgId);
    const today = new Date().toISOString().slice(0, 10);
    const dueDate = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    res.render('invoices/form', {
      title: 'New Invoice', invoice: { issue_date: today, due_date: dueDate, status: 'draft' },
      items: [], clients, products, settings, errors: null,
      preselectClientId: req.query.client_id || null,
      msg: req.query.msg || null
    });
  } catch (err) {
    next(err);
  }
});

// Create
router.post('/', requireActiveBilling, async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const { client_id, issue_date, due_date, status, notes } = req.body;
    const items = parseItems(req.body);

    if (!client_id || !issue_date || !due_date || items.length === 0) {
      const clients = (await db.prepare('SELECT * FROM clients WHERE org_id = ? ORDER BY name').all(orgId)) || [];
      const products = (await db.prepare('SELECT * FROM products WHERE org_id = ? ORDER BY name').all(orgId)) || [];
      const settings = await getSettings(orgId);
      return res.render('invoices/form', {
        title: 'New Invoice', invoice: req.body, items, clients, products, settings,
        errors: ['Client, issue date, due date, and at least one line item are required.'],
      });
    }

    const invoice_number = await nextInvoiceNumber(orgId);
    const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
    const discount_total = items.reduce((s, it) => s + it.quantity * it.unit_price * (it.tax_rate / 100), 0);
    const total = subtotal - discount_total;

    const info = await db.prepare(`INSERT INTO invoices
      (org_id, invoice_number, client_id, issue_date, due_date, status, notes, subtotal, tax_total, total, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(orgId, invoice_number, client_id, issue_date, due_date, status || 'draft', notes || '', subtotal, discount_total, total, req.session.user.id);

    const invoiceId = info.lastInsertRowid;
    for (const it of items) {
      await db.prepare(`INSERT INTO invoice_items
        (invoice_id, product_id, description, quantity, unit_price, tax_rate, line_total) VALUES (?,?,?,?,?,?,?)`)
        .run(invoiceId, it.product_id, it.description, it.quantity, it.unit_price, it.tax_rate, it.line_total);
    }

    res.redirect(`/invoices/${invoiceId}`);
  } catch (err) {
    next(err);
  }
});

// Show (printable invoice view)
router.get('/:id', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const invoice = await db.prepare(`SELECT invoices.*, clients.name AS client_name, clients.email AS client_email,
      clients.address AS client_address, clients.tax_id AS client_tax_id
      FROM invoices JOIN clients ON clients.id = invoices.client_id WHERE invoices.id = ? AND invoices.org_id = ?`).get(req.params.id, orgId);
    if (!invoice) return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });
    const items = (await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id)) || [];
    const payments = (await db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date').all(req.params.id)) || [];
    const settings = await getSettings(orgId);
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
  } catch (err) {
    next(err);
  }
});

// Download / View PDF
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const invoice = await db.prepare(`SELECT invoices.*, clients.name AS client_name, clients.email AS client_email,
      clients.address AS client_address, clients.tax_id AS client_tax_id
      FROM invoices JOIN clients ON clients.id = invoices.client_id WHERE invoices.id = ? AND invoices.org_id = ?`).get(req.params.id, orgId);
    if (!invoice) return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });

    const items = (await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id)) || [];
    const settings = await getSettings(orgId);

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
    const invoice = await db.prepare(`SELECT invoices.*, clients.name AS client_name, clients.email AS client_email,
      clients.address AS client_address, clients.tax_id AS client_tax_id
      FROM invoices JOIN clients ON clients.id = invoices.client_id WHERE invoices.id = ? AND invoices.org_id = ?`).get(req.params.id, orgId);
    if (!invoice) return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });

    const recipientEmail = (req.body.recipient_email || invoice.client_email || 'daviddominic767@gmail.com').trim();
    if (!recipientEmail) {
      return res.redirect(`/invoices/${req.params.id}?emailError=Recipient email address is required.`);
    }

    const items = (await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id)) || [];
    const settings = await getSettings(orgId);

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
      await db.prepare("UPDATE invoices SET status = 'sent' WHERE id = ? AND org_id = ?").run(req.params.id, orgId);
    }

    const msg = encodeURIComponent(result.message);
    res.redirect(`/invoices/${req.params.id}?emailSent=1&msg=${msg}`);
  } catch (err) {
    console.error('Failed to send invoice email:', err);
    res.redirect(`/invoices/${req.params.id}?emailError=${encodeURIComponent(err.message)}`);
  }
});

// Edit form
router.get('/:id/edit', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?').get(req.params.id, orgId);
    if (!invoice) return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });
    const items = (await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id)) || [];
    const clients = (await db.prepare('SELECT * FROM clients WHERE org_id = ? ORDER BY name').all(orgId)) || [];
    const products = (await db.prepare('SELECT * FROM products WHERE org_id = ? ORDER BY name').all(orgId)) || [];
    const settings = await getSettings(orgId);
    res.render('invoices/form', { title: `Edit ${invoice.invoice_number}`, invoice, items, clients, products, settings, errors: null });
  } catch (err) {
    next(err);
  }
});

// Update
router.put('/:id', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const { client_id, issue_date, due_date, status, notes } = req.body;
    const items = parseItems(req.body);
    const invoiceId = req.params.id;

    const existing = await db.prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?').get(invoiceId, orgId);
    if (!existing) return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });

    if (!client_id || !issue_date || !due_date || items.length === 0) {
      const clients = (await db.prepare('SELECT * FROM clients WHERE org_id = ? ORDER BY name').all(orgId)) || [];
      const products = (await db.prepare('SELECT * FROM products WHERE org_id = ? ORDER BY name').all(orgId)) || [];
      const settings = await getSettings(orgId);
      return res.render('invoices/form', {
        title: 'Edit Invoice', invoice: { ...req.body, id: invoiceId }, items, clients, products, settings,
        errors: ['Client, issue date, due date, and at least one line item are required.'],
      });
    }

    await db.prepare(`UPDATE invoices SET client_id=?, issue_date=?, due_date=?, status=?, notes=? WHERE id=? AND org_id=?`)
      .run(client_id, issue_date, due_date, status || 'draft', notes || '', invoiceId, orgId);

    await db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
    for (const it of items) {
      await db.prepare(`INSERT INTO invoice_items
        (invoice_id, product_id, description, quantity, unit_price, tax_rate, line_total) VALUES (?,?,?,?,?,?,?)`)
        .run(invoiceId, it.product_id, it.description, it.quantity, it.unit_price, it.tax_rate, it.line_total);
    }
    await recalcInvoiceTotals(invoiceId, orgId);
    await refreshPaidStatus(invoiceId, orgId);

    res.redirect(`/invoices/${invoiceId}`);
  } catch (err) {
    next(err);
  }
});

// Quick status change
router.post('/:id/status', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const { status, redirect } = req.body;
    const allowed = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];
    if (allowed.includes(status)) {
      await db.prepare('UPDATE invoices SET status=? WHERE id=? AND org_id=?').run(status, req.params.id, orgId);
    }
    res.redirect(redirect || `/invoices/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// Record a payment
router.post('/:id/payments', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const invoice = await db.prepare('SELECT id FROM invoices WHERE id = ? AND org_id = ?').get(req.params.id, orgId);
    if (!invoice) return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });

    const { amount, payment_date, method, notes } = req.body;
    const amt = parseFloat(amount);
    if (amt && amt > 0) {
      await db.prepare(`INSERT INTO payments (invoice_id, amount, payment_date, method, notes) VALUES (?,?,?,?,?)`)
        .run(req.params.id, amt, payment_date || new Date().toISOString().slice(0, 10), method || '', notes || '');
      await refreshPaidStatus(req.params.id, orgId);
    }
    res.redirect(`/invoices/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// Delete a payment
router.delete('/:id/payments/:paymentId', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const invoice = await db.prepare('SELECT id FROM invoices WHERE id = ? AND org_id = ?').get(req.params.id, orgId);
    if (!invoice) return res.status(404).render('error', { title: 'Not Found', message: 'Invoice not found.' });

    await db.prepare('DELETE FROM payments WHERE id = ? AND invoice_id = ?').run(req.params.paymentId, req.params.id);
    await refreshPaidStatus(req.params.id, orgId);
    res.redirect(`/invoices/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// Delete invoice
router.delete('/:id', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    await db.prepare('DELETE FROM invoices WHERE id = ? AND org_id = ?').run(req.params.id, orgId);
    res.redirect('/invoices');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
