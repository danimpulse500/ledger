const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const orgId = req.session.user.org_id;
  const products = db.prepare('SELECT * FROM products WHERE org_id = ? ORDER BY name').all(orgId);
  res.render('products/list', { title: 'Products & Services', products });
});

router.get('/new', (req, res) => {
  res.render('products/form', { title: 'New Product/Service', product: {}, errors: null });
});

router.post('/', (req, res) => {
  const orgId = req.session.user.org_id;
  const { name, description, unit_price, tax_rate } = req.body;
  if (!name || !name.trim()) {
    return res.render('products/form', { title: 'New Product/Service', product: req.body, errors: ['Name is required.'] });
  }
  db.prepare(`INSERT INTO products (org_id, name, description, unit_price, tax_rate) VALUES (?,?,?,?,?)`)
    .run(orgId, name.trim(), description || '', parseFloat(unit_price) || 0, parseFloat(tax_rate) || 0);
  res.redirect('/products');
});

router.get('/:id/edit', (req, res) => {
  const orgId = req.session.user.org_id;
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND org_id = ?').get(req.params.id, orgId);
  if (!product) return res.status(404).render('error', { title: 'Not Found', message: 'Product not found.' });
  res.render('products/form', { title: 'Edit Product/Service', product, errors: null });
});

router.put('/:id', (req, res) => {
  const orgId = req.session.user.org_id;
  const { name, description, unit_price, tax_rate } = req.body;
  if (!name || !name.trim()) {
    return res.render('products/form', { title: 'Edit Product/Service', product: { ...req.body, id: req.params.id }, errors: ['Name is required.'] });
  }
  const result = db.prepare(`UPDATE products SET name=?, description=?, unit_price=?, tax_rate=? WHERE id=? AND org_id=?`)
    .run(name.trim(), description || '', parseFloat(unit_price) || 0, parseFloat(tax_rate) || 0, req.params.id, orgId);
  if (result.changes === 0) return res.status(404).render('error', { title: 'Not Found', message: 'Product not found.' });
  res.redirect('/products');
});

router.delete('/:id', (req, res) => {
  const orgId = req.session.user.org_id;
  const used = db.prepare('SELECT COUNT(*) AS c FROM invoice_items ii JOIN invoices i ON ii.invoice_id = i.id WHERE ii.product_id = ? AND i.org_id = ?').get(req.params.id, orgId);
  if (used && used.c > 0) {
    const products = db.prepare('SELECT * FROM products WHERE org_id = ? ORDER BY name').all(orgId);
    return res.status(400).render('products/list', {
      title: 'Products & Services', products,
      error: 'Cannot delete a product used on existing invoices.',
    });
  }
  db.prepare('DELETE FROM products WHERE id = ? AND org_id = ?').run(req.params.id, orgId);
  res.redirect('/products');
});

module.exports = router;
