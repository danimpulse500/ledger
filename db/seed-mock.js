const bcrypt = require('bcryptjs');
const db = require('./index');

console.log('=== Invoicing App: Populating Mock Data ===\n');

// 1. Password Hashes (password123)
const passwordHash = bcrypt.hashSync('password123', 10);

try {
  db.exec('BEGIN TRANSACTION;');

  // 2. Ensure Organizations exist
  const orgs = [
    { id: 1, name: 'Acme Software Solutions', slug: 'acme-software', status: 'active', plan: 'pro' },
    { id: 2, name: 'Brightside Creative Agency', slug: 'brightside', status: 'active', plan: 'starter' },
    { id: 3, name: 'Vanguard Logistics Group', slug: 'vanguard', status: 'active', plan: 'enterprise' }
  ];

  for (const org of orgs) {
    const existing = db.prepare('SELECT id FROM organizations WHERE id = ?').get(org.id);
    if (!existing) {
      db.prepare(`INSERT INTO organizations (id, name, slug, status, plan) VALUES (?, ?, ?, ?, ?)`).run(
        org.id, org.name, org.slug, org.status, org.plan
      );
    } else {
      db.prepare(`UPDATE organizations SET name = ?, slug = ?, status = ?, plan = ? WHERE id = ?`).run(
        org.name, org.slug, org.status, org.plan, org.id
      );
    }
  }

  // 3. Ensure Company Settings exist
  const companySettings = [
    { org_id: 1, company_name: 'Acme Software Solutions', address: '100 Innovation Way, Suite 400, San Francisco, CA 94105', email: 'billing@acmesoftware.com', phone: '+1 (555) 019-2831', tax_id: 'US-987654321', currency_symbol: '$', invoice_prefix: 'INV-', next_invoice_number: 1006, default_tax_rate: 10 },
    { org_id: 2, company_name: 'Brightside Creative Agency', address: '45 Design District Ave, Austin, TX 78701', email: 'hello@brightsideagency.com', phone: '+1 (555) 014-9922', tax_id: 'US-123456789', currency_symbol: '$', invoice_prefix: 'BCA-', next_invoice_number: 2004, default_tax_rate: 8.25 },
    { org_id: 3, company_name: 'Vanguard Logistics Group', address: '782 Trade Port Blvd, Chicago, IL 60607', email: 'invoices@vanguardlogistics.com', phone: '+1 (555) 018-7711', tax_id: 'US-456789123', currency_symbol: '$', invoice_prefix: 'VLG-', next_invoice_number: 3003, default_tax_rate: 5 }
  ];

  for (const s of companySettings) {
    const existing = db.prepare('SELECT id FROM company_settings WHERE org_id = ?').get(s.org_id);
    if (existing) {
      db.prepare(`
        UPDATE company_settings 
        SET company_name = ?, address = ?, email = ?, phone = ?, tax_id = ?, currency_symbol = ?, invoice_prefix = ?, next_invoice_number = ?, default_tax_rate = ?
        WHERE org_id = ?
      `).run(s.company_name, s.address, s.email, s.phone, s.tax_id, s.currency_symbol, s.invoice_prefix, s.next_invoice_number, s.default_tax_rate, s.org_id);
    } else {
      db.prepare(`
        INSERT INTO company_settings (org_id, company_name, address, email, phone, tax_id, currency_symbol, invoice_prefix, next_invoice_number, default_tax_rate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(s.org_id, s.company_name, s.address, s.email, s.phone, s.tax_id, s.currency_symbol, s.invoice_prefix, s.next_invoice_number, s.default_tax_rate);
    }
  }

  // 4. Users (Admin and Staff for Org 1, Admins for Org 2 & 3)
  const users = [
    { org_id: 1, name: 'Alex Rivera', email: 'admin@example.com', role: 'admin' },
    { org_id: 1, name: 'Sam Taylor', email: 'staff@example.com', role: 'staff' },
    { org_id: 2, name: 'Elena Rostova', email: 'elena@brightsideagency.com', role: 'admin' },
    { org_id: 3, name: 'Marcus Vance', email: 'marcus@vanguardlogistics.com', role: 'admin' }
  ];

  for (const u of users) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(u.email);
    if (!existing) {
      db.prepare(`INSERT INTO users (org_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)`).run(
        u.org_id, u.name, u.email, passwordHash, u.role
      );
    }
  }

  const admin1 = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@example.com');
  const adminId = admin1 ? admin1.id : 1;

  // 5. Clients (for Org 1)
  const clients = [
    { org_id: 1, name: 'Nexus Dynamics Inc.', email: 'accounts@nexusdynamics.io', phone: '+1 (415) 555-0142', address: '500 Market St, Floor 12, San Francisco, CA', tax_id: 'TAX-88219', notes: 'Key enterprise account. 30-day payment terms.' },
    { org_id: 1, name: 'Apex Global Retail', email: 'finance@apexglobal.com', phone: '+1 (212) 555-0198', address: '120 Broadway, New York, NY 10005', tax_id: 'TAX-33104', notes: 'Prefers digital invoices sent directly to AP.' },
    { org_id: 1, name: 'Horizon BioTech', email: 'ap@horizonbio.org', phone: '+1 (617) 555-0177', address: '40 Kendall Sq, Cambridge, MA 02142', tax_id: 'TAX-99412', notes: 'Quarterly retainer contract.' },
    { org_id: 1, name: 'Starlight Media House', email: 'billing@starlightmedia.co', phone: '+1 (310) 555-0133', address: '9000 Sunset Blvd, Los Angeles, CA 90069', tax_id: 'TAX-55201', notes: 'Creative production partner.' }
  ];

  const clientMap = {};
  for (const c of clients) {
    let row = db.prepare('SELECT id FROM clients WHERE org_id = ? AND name = ?').get(c.org_id, c.name);
    if (!row) {
      const res = db.prepare(`INSERT INTO clients (org_id, name, email, phone, address, tax_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        c.org_id, c.name, c.email, c.phone, c.address, c.tax_id, c.notes
      );
      clientMap[c.name] = res.lastInsertRowid;
    } else {
      clientMap[c.name] = row.id;
    }
  }

  // 6. Products & Services (for Org 1)
  const products = [
    { org_id: 1, name: 'Full-Stack Web Development', description: 'Custom web application design, frontend/backend engineering, and API integrations.', unit_price: 2500.00, tax_rate: 10 },
    { org_id: 1, name: 'Monthly Managed Infrastructure & Support', description: '24/7 uptime monitoring, server maintenance, security patches, and backups.', unit_price: 450.00, tax_rate: 10 },
    { org_id: 1, name: 'UX/UI Design & Prototyping', description: 'Figma wireframes, user journeys, interactive prototypes, and design systems.', unit_price: 1200.00, tax_rate: 10 },
    { org_id: 1, name: 'Database Architecture & Performance Audit', description: 'SQL query optimization, index tuning, backup verification, and schema review.', unit_price: 950.00, tax_rate: 10 },
    { org_id: 1, name: 'Cloud Migration Consulting (Hourly)', description: 'AWS / GCP / Cloudflare architecture advisory and zero-downtime deployment.', unit_price: 175.00, tax_rate: 10 }
  ];

  const productMap = {};
  for (const p of products) {
    let row = db.prepare('SELECT id FROM products WHERE org_id = ? AND name = ?').get(p.org_id, p.name);
    if (!row) {
      const res = db.prepare(`INSERT INTO products (org_id, name, description, unit_price, tax_rate) VALUES (?, ?, ?, ?, ?)`).run(
        p.org_id, p.name, p.description, p.unit_price, p.tax_rate
      );
      productMap[p.name] = res.lastInsertRowid;
    } else {
      productMap[p.name] = row.id;
    }
  }

  // Helper date function
  const formatDate = (daysAgo) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().split('T')[0];
  };

  // 7. Invoices (for Org 1)
  const mockInvoices = [
    {
      invoice_number: 'INV-1001',
      client_name: 'Nexus Dynamics Inc.',
      issue_date: formatDate(45),
      due_date: formatDate(15),
      status: 'paid',
      notes: 'Paid via ACH transfer on completion. Thank you for your business!',
      items: [
        { product_name: 'Full-Stack Web Development', qty: 2, unit_price: 2500.00, tax_rate: 10 },
        { product_name: 'Database Architecture & Performance Audit', qty: 1, unit_price: 950.00, tax_rate: 10 }
      ],
      payments: [
        { amount: 6545.00, date: formatDate(20), method: 'Bank Transfer', notes: 'Full payment received. Ref: ACH-88412' }
      ]
    },
    {
      invoice_number: 'INV-1002',
      client_name: 'Apex Global Retail',
      issue_date: formatDate(35),
      due_date: formatDate(5),
      status: 'overdue',
      notes: 'Payment is overdue. First reminder sent on ' + formatDate(3) + '.',
      items: [
        { product_name: 'UX/UI Design & Prototyping', qty: 1, unit_price: 1200.00, tax_rate: 10 },
        { product_name: 'Monthly Managed Infrastructure & Support', qty: 2, unit_price: 450.00, tax_rate: 10 }
      ],
      payments: []
    },
    {
      invoice_number: 'INV-1003',
      client_name: 'Horizon BioTech',
      issue_date: formatDate(20),
      due_date: formatDate(-10),
      status: 'sent',
      notes: 'Quarterly support retainer & infrastructure onboarding.',
      items: [
        { product_name: 'Cloud Migration Consulting (Hourly)', qty: 10, unit_price: 175.00, tax_rate: 10 },
        { product_name: 'Monthly Managed Infrastructure & Support', qty: 1, unit_price: 450.00, tax_rate: 10 }
      ],
      payments: [
        { amount: 1000.00, date: formatDate(10), method: 'Credit Card', notes: 'Initial deposit payment' }
      ]
    },
    {
      invoice_number: 'INV-1004',
      client_name: 'Starlight Media House',
      issue_date: formatDate(10),
      due_date: formatDate(-20),
      status: 'paid',
      notes: 'Custom platform build phase 1.',
      items: [
        { product_name: 'Full-Stack Web Development', qty: 1, unit_price: 2500.00, tax_rate: 10 },
        { product_name: 'UX/UI Design & Prototyping', qty: 1, unit_price: 1200.00, tax_rate: 10 }
      ],
      payments: [
        { amount: 4070.00, date: formatDate(5), method: 'Stripe', notes: 'Paid online via invoice link' }
      ]
    },
    {
      invoice_number: 'INV-1005',
      client_name: 'Nexus Dynamics Inc.',
      issue_date: formatDate(2),
      due_date: formatDate(-28),
      status: 'draft',
      notes: 'Draft invoice for Q3 technical advisory and scaling work.',
      items: [
        { product_name: 'Cloud Migration Consulting (Hourly)', qty: 15, unit_price: 175.00, tax_rate: 10 }
      ],
      payments: []
    }
  ];

  for (const invData of mockInvoices) {
    const existing = db.prepare('SELECT id FROM invoices WHERE org_id = 1 AND invoice_number = ?').get(invData.invoice_number);
    let invoiceId;

    const clientId = clientMap[invData.client_name];

    // Compute totals
    let subtotal = 0;
    let taxTotal = 0;
    const computedItems = invData.items.map(item => {
      const prodId = productMap[item.product_name] || null;
      const lineSubtotal = item.qty * item.unit_price;
      const lineTax = lineSubtotal * (item.tax_rate / 100);
      const lineTotal = lineSubtotal + lineTax;
      subtotal += lineSubtotal;
      taxTotal += lineTax;
      return {
        product_id: prodId,
        description: item.product_name,
        quantity: item.qty,
        unit_price: item.unit_price,
        tax_rate: item.tax_rate,
        line_total: lineTotal
      };
    });

    const grandTotal = subtotal + taxTotal;

    // Calculate payments total
    const totalPaid = invData.payments.reduce((sum, p) => sum + p.amount, 0);

    if (!existing) {
      const res = db.prepare(`
        INSERT INTO invoices 
        (org_id, invoice_number, client_id, issue_date, due_date, status, notes, subtotal, tax_total, total, amount_paid, created_by)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        invData.invoice_number, clientId, invData.issue_date, invData.due_date, invData.status,
        invData.notes, subtotal, taxTotal, grandTotal, totalPaid, adminId
      );
      invoiceId = res.lastInsertRowid;
    } else {
      invoiceId = existing.id;
      db.prepare(`
        UPDATE invoices 
        SET client_id = ?, issue_date = ?, due_date = ?, status = ?, notes = ?, subtotal = ?, tax_total = ?, total = ?, amount_paid = ?
        WHERE id = ?
      `).run(clientId, invData.issue_date, invData.due_date, invData.status, invData.notes, subtotal, taxTotal, grandTotal, totalPaid, invoiceId);

      // Clean existing items/payments to re-seed cleanly
      db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
      db.prepare('DELETE FROM payments WHERE invoice_id = ?').run(invoiceId);
    }

    // Insert Items
    for (const item of computedItems) {
      db.prepare(`
        INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price, tax_rate, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(invoiceId, item.product_id, item.description, item.quantity, item.unit_price, item.tax_rate, item.line_total);
    }

    // Insert Payments
    for (const p of invData.payments) {
      db.prepare(`
        INSERT INTO payments (invoice_id, amount, payment_date, method, notes)
        VALUES (?, ?, ?, ?, ?)
      `).run(invoiceId, p.amount, p.date, p.method, p.notes);
    }
  }

  // 8. Expenses (for Org 1)
  const mockExpenses = [
    { org_id: 1, description: 'AWS Cloud Hosting & S3 Backups', category: 'Software & Cloud', amount: 349.50, expense_date: formatDate(25), vendor: 'Amazon Web Services' },
    { org_id: 1, description: 'GitHub Enterprise Team Licenses', category: 'Software & Cloud', amount: 120.00, expense_date: formatDate(22), vendor: 'GitHub Inc.' },
    { org_id: 1, description: 'Office Fiber Internet Connection', category: 'Utilities', amount: 145.00, expense_date: formatDate(18), vendor: 'Comcast Business' },
    { org_id: 1, description: 'Ergonomic Office Chairs & Desk Monitors', category: 'Equipment', amount: 890.00, expense_date: formatDate(12), vendor: 'B&H Photo Video' },
    { org_id: 1, description: 'Contractor UX Researcher Fees', category: 'Subcontractors', amount: 1500.00, expense_date: formatDate(8), vendor: 'Design Spark LLC' },
    { org_id: 1, description: 'Client Lunch Meeting with Nexus Dynamics', category: 'Meals & Entertainment', amount: 168.20, expense_date: formatDate(4), vendor: 'Waterfront Grill' }
  ];

  for (const exp of mockExpenses) {
    const existing = db.prepare('SELECT id FROM expenses WHERE org_id = ? AND description = ? AND expense_date = ?').get(exp.org_id, exp.description, exp.expense_date);
    if (!existing) {
      db.prepare(`
        INSERT INTO expenses (org_id, description, category, amount, expense_date, vendor, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(exp.org_id, exp.description, exp.category, exp.amount, exp.expense_date, exp.vendor, adminId);
    }
  }

  db.exec('COMMIT;');
  console.log('✅ Mock data seeded successfully!');
  console.log('\n--- Login Credentials for Testing ---');
  console.log('🔹 Tenant Admin (Acme Software):');
  console.log('   Email:    admin@example.com');
  console.log('   Password: password123');
  console.log('🔹 Tenant Staff (Acme Software):');
  console.log('   Email:    staff@example.com');
  console.log('   Password: password123');
  console.log('🔹 Platform Admin (Control Center):');
  console.log('   URL:      http://localhost:3000/platform/login');
  console.log('   Email:    admin@platform.com');
  console.log('   Password: admin123');
  console.log('-------------------------------------\n');

} catch (err) {
  try { db.exec('ROLLBACK;'); } catch (e) {}
  console.error('❌ Error seeding mock data:', err);
  process.exit(1);
}
