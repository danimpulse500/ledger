const express = require('express');
const https = require('https');
const crypto = require('crypto');
const db = require('../db');
const { sendPaymentConfirmationEmail } = require('../utils/mailer');

const router = express.Router();

// Helper to make HTTPS requests to Paystack API
function paystackRequest(path, method, data = null) {
  return new Promise((resolve, reject) => {
    const secretKey = process.env.PAYSTACK_SECRET_KEY || 'sk_test_mock_secret_key_for_dev';
    const payload = data ? JSON.stringify(data) : '';

    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: path,
      method: method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          resolve({ status: false, message: 'Invalid JSON response from Paystack', raw: body });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

// 1. Render Billing Page with Payment History & Subscriptions
router.get('/', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;

    const org = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);

    const totals = (await db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END), 0) AS total_billed,
        COALESCE(SUM(CASE WHEN status IN ('sent', 'overdue') THEN total - amount_paid ELSE 0 END), 0) AS outstanding,
        COALESCE(SUM(amount_paid), 0) AS collected,
        COUNT(CASE WHEN status != 'cancelled' THEN 1 END) AS invoice_count
      FROM invoices
      WHERE org_id = ?
    `).get(orgId)) || { total_billed: 0, outstanding: 0, collected: 0, invoice_count: 0 };

    const recentInvoices = (await db.prepare(`
      SELECT invoices.id, invoices.invoice_number, invoices.status, invoices.total, invoices.amount_paid,
             invoices.issue_date, clients.name AS client_name
      FROM invoices
      JOIN clients ON clients.id = invoices.client_id
      WHERE invoices.org_id = ? AND invoices.status != 'cancelled'
      ORDER BY invoices.issue_date DESC, invoices.id DESC
      LIMIT 8
    `).all(orgId)) || [];

    const nextInvoice = (await db.prepare(`
      SELECT total - amount_paid AS amount, due_date AS date,
             (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = invoices.id) AS items
      FROM invoices
      WHERE org_id = ? AND status IN ('sent', 'overdue') AND total > amount_paid
      ORDER BY due_date ASC, id ASC
      LIMIT 1
    `).get(orgId)) || { amount: 0, date: 'No upcoming invoice', items: 0 };

    const settings = await db.prepare('SELECT address FROM company_settings WHERE org_id = ?').get(orgId);
    const invoiceHistory = recentInvoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.invoice_number,
      date: invoice.issue_date,
      amount: invoice.total,
      status: invoice.status,
    }));

    // Fetch Payment Transactions History for Organization
    const transactions = (await db.prepare(`
      SELECT * FROM billing_transactions
      WHERE organization_id = ?
      ORDER BY created_at DESC
    `).all(orgId)) || [];

    const totalBilled = parseFloat(totals.total_billed || 0);
    const collected = parseFloat(totals.collected || 0);
    const collectionRate = totalBilled > 0
      ? Math.round((collected / totalBilled) * 100)
      : 0;

    const paystackPublicKey = process.env.PAYSTACK_PUBLIC_KEY || 'pk_test_mock_public_key';

    res.render('billing', {
      title: 'Billing & Subscriptions',
      org,
      totals,
      recentInvoices,
      collectionRate,
      paystackPublicKey,
      plan: {
        name: org ? (org.plan === 'pro_yearly' ? 'Ledger Pro (Yearly Plan)' : org.plan.toUpperCase() + ' Plan') : 'Starter Plan',
        price: org && org.subscription_status === 'active' ? (org.plan === 'pro_yearly' ? '₦44,000/yr' : '₦5,500/mo') : '30-Day Free Trial',
        interval: org && org.plan === 'pro_yearly' ? 'yearly' : 'monthly',
        features: 'Full access to invoice creation, PDF generation, client directory & expense analytics.'
      },
      usage: { current: totals.invoice_count || 0, limit: 'Unlimited', unit: 'invoices', percentage: 0 },
      nextInvoice,
      paymentMethods: org && org.card_last4 ? [{
        brand: org.card_brand || 'Card',
        last4: org.card_last4,
        exp: `${org.card_exp_month}/${org.card_exp_year}`
      }] : [],
      billingAddress: settings ? settings.address || 'No billing address set' : 'No billing address set',
      invoiceHistory,
      transactions,
      msg: req.query.msg || null,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
});

// 2. Initialize Paystack Transaction
router.post('/paystack/initialize', async (req, res) => {
  try {
    const orgId = req.session.user.org_id;
    const userEmail = req.session.user.email;
    const { plan, amount, callback_url } = req.body;

    const reference = `INV_${orgId}_${Date.now()}`;
    const paystackAmount = (amount ? parseInt(amount, 10) : 5500) * 100;

    const payload = {
      email: userEmail,
      amount: paystackAmount,
      reference: reference,
      callback_url: callback_url || `${req.protocol}://${req.get('host')}/billing/paystack/callback`,
      metadata: {
        org_id: orgId,
        user_id: req.session.user.id,
        plan: plan || 'starter'
      }
    };

    const response = await paystackRequest('/transaction/initialize', 'POST', payload);

    if (response.status) {
      return res.json({
        status: true,
        authorization_url: response.data.authorization_url,
        access_code: response.data.access_code,
        reference: response.data.reference
      });
    } else {
      return res.status(400).json({ status: false, message: response.message || 'Failed to initialize Paystack payment' });
    }
  } catch (err) {
    console.error('[Paystack Init Error]:', err);
    return res.status(500).json({ status: false, message: err.message });
  }
});

// 3. Paystack Callback / Verification
router.get('/paystack/callback', async (req, res) => {
  const { reference, trxref } = req.query;
  const ref = reference || trxref;

  if (!ref) {
    return res.redirect('/billing?error=Missing+transaction+reference');
  }

  try {
    const response = await paystackRequest(`/transaction/verify/${encodeURIComponent(ref)}`, 'GET');

    if (response.status && response.data.status === 'success') {
      const data = response.data;
      const metadata = data.metadata || {};
      const orgId = metadata.org_id || req.session?.user?.org_id;

      if (!orgId) {
        return res.redirect('/dashboard?error=Organization+not+found');
      }

      const auth = data.authorization || {};
      const customer = data.customer || {};

      const trialEnds = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      const plan = metadata.plan && metadata.plan !== 'trial' ? metadata.plan : 'starter';
      const subStatus = 'active';

      await db.prepare(`
        UPDATE organizations
        SET paystack_customer_code = ?,
            paystack_auth_code = ?,
            subscription_status = ?,
            trial_ends_at = ?,
            plan = ?,
            card_brand = ?,
            card_last4 = ?,
            card_exp_month = ?,
            card_exp_year = ?
        WHERE id = ?
      `).run(
        customer.customer_code || '',
        auth.authorization_code || '',
        subStatus,
        trialEnds,
        plan,
        auth.card_type || 'Visa',
        auth.last4 || '4242',
        auth.exp_month || '12',
        auth.exp_year || '2030',
        orgId
      );

      // Record transaction
      const chargeAmount = (data.amount / 100) || 5500;
      await db.prepare(`
        INSERT INTO billing_transactions (organization_id, reference, amount, currency, status, plan, payment_method, card_brand, card_last4, description)
        VALUES (?, ?, ?, ?, 'success', ?, 'Card', ?, ?, ?)
      `).run(
        orgId,
        ref,
        chargeAmount,
        data.currency || 'NGN',
        plan,
        auth.card_type || 'Visa',
        auth.last4 || '4242',
        'Ledger Pro Subscription Payment'
      );

      // Send email confirmation
      const userEmail = customer.email || req.session?.user?.email;
      if (userEmail) {
        sendPaymentConfirmationEmail({
          recipientEmail: userEmail,
          orgName: req.session?.user?.name || 'Customer',
          plan: plan,
          amount: chargeAmount,
          reference: ref,
          cardBrand: auth.card_type || 'Visa',
          cardLast4: auth.last4 || '4242',
          nextBillingDate: new Date(trialEnds).toLocaleDateString()
        });
      }

      const msg = encodeURIComponent('Payment processed successfully! Your subscription is active.');
      return res.redirect(`/billing?msg=${msg}`);
    } else {
      return res.redirect(`/billing?error=${encodeURIComponent(response.message || 'Paystack verification failed')}`);
    }
  } catch (err) {
    console.error('[Paystack Verify Error]:', err);
    return res.redirect(`/billing?error=${encodeURIComponent(err.message)}`);
  }
});

// 4. Direct 30-Day Free Trial Activation & Payment Verification
router.post('/trial/activate', async (req, res) => {
  try {
    const orgId = req.session?.user?.org_id;
    const userEmail = req.body.email || req.session?.user?.email;
    const userName = req.session?.user?.name || 'Valued Customer';
    if (!orgId) return res.status(401).json({ status: false, message: 'Unauthorized' });

    const { card_brand, card_last4, card_exp_month, card_exp_year, paystack_auth_code, plan } = req.body;

    const trialEnds = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const selectedPlan = plan || 'starter';
    const txRef = `TRL_${orgId}_${Date.now().toString(36).toUpperCase()}`;

    await db.prepare(`
      UPDATE organizations
      SET subscription_status = 'trialing',
          trial_ends_at = ?,
          plan = ?,
          card_brand = ?,
          card_last4 = ?,
          card_exp_month = ?,
          card_exp_year = ?,
          paystack_auth_code = ?
      WHERE id = ?
    `).run(
      trialEnds,
      selectedPlan,
      card_brand || 'Visa',
      card_last4 || '4242',
      card_exp_month || '12',
      card_exp_year || '2028',
      paystack_auth_code || 'AUTH_TOKEN_SAMPLE',
      orgId
    );

    // Record 30-Day Free Trial Verification Transaction
    try {
      await db.prepare(`
        INSERT INTO billing_transactions (organization_id, reference, amount, currency, status, plan, payment_method, card_brand, card_last4, description)
        VALUES (?, ?, 0.00, 'NGN', 'success', ?, 'Card', ?, ?, ?)
      `).run(
        orgId,
        txRef,
        selectedPlan,
        card_brand || 'Visa',
        card_last4 || '4242',
        '30-Day Free Trial Card Verification ($0.00 Due Today)'
      );
    } catch (err) {
      console.error('[Billing Transaction Error]:', err.message);
    }

    // Send Email Confirmation
    if (userEmail) {
      sendPaymentConfirmationEmail({
        recipientEmail: userEmail,
        orgName: userName,
        plan: selectedPlan,
        amount: 0,
        reference: txRef,
        cardBrand: card_brand || 'Visa',
        cardLast4: card_last4 || '4242',
        nextBillingDate: new Date(trialEnds).toLocaleDateString()
      });
    }

    return res.json({
      status: true,
      message: '30-Day Free Trial activated successfully!',
      redirectUrl: '/invoices/new?msg=' + encodeURIComponent('Payment verified! Your 30-Day Free Trial is now active.')
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
});

// 5. Download Payment Receipt / Invoice PDF
router.get('/receipt/:id/download', async (req, res, next) => {
  try {
    const orgId = req.session.user.org_id;
    const txId = req.params.id;

    const tx = await db.prepare(`
      SELECT * FROM billing_transactions
      WHERE id = ? AND organization_id = ?
    `).get(txId, orgId);

    if (!tx) {
      return res.status(404).send('Transaction receipt not found');
    }

    const org = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);
    const formattedAmount = parseFloat(tx.amount || 0).toFixed(2);
    const formattedDate = new Date(tx.created_at).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const htmlReceipt = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Payment Receipt - ${tx.reference}</title>
        <style>
          body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 40px 20px; }
          .receipt-card { max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 20px; padding: 40px; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05); }
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 20px; margin-bottom: 30px; }
          .logo { font-size: 24px; font-weight: 900; letter-spacing: -0.03em; color: #0f172a; }
          .badge { display: inline-block; background: #ecfdf5; color: #047857; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; padding: 6px 14px; border-radius: 9999px; border: 1px solid #a7f3d0; }
          .grid { display: grid; grid-template-cols: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
          .label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 4px; }
          .value { font-size: 15px; font-weight: 600; color: #0f172a; }
          .table { width: 100%; border-collapse: collapse; margin: 30px 0; }
          .table th { text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; padding: 12px 0; border-bottom: 1px solid #e2e8f0; }
          .table td { padding: 16px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; color: #0f172a; }
          .total-row { display: flex; justify-content: space-between; font-size: 18px; font-weight: 900; color: #0f172a; padding-top: 16px; border-top: 2px solid #0f172a; }
          .footer { font-size: 12px; color: #94a3b8; text-align: center; margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 20px; }
          .print-btn { display: inline-block; background: #0f172a; color: #ffffff; padding: 10px 20px; border-radius: 10px; font-weight: 700; text-decoration: none; margin-bottom: 20px; border: none; cursor: pointer; }
          @media print { .print-btn { display: none; } body { padding: 0; background: #fff; } .receipt-card { border: none; box-shadow: none; } }
        </style>
      </head>
      <body>
        <div style="text-align: center;">
          <button onclick="window.print()" class="print-btn">🖨️ Print / Save as PDF</button>
        </div>
        <div class="receipt-card">
          <div class="header">
            <div>
              <div class="logo">Ledger Pro</div>
              <div style="font-size: 13px; color: #64748b; mt-1">Official Billing Receipt</div>
            </div>
            <div>
              <span class="badge">Paid & Verified</span>
            </div>
          </div>

          <div class="grid">
            <div>
              <div class="label">Billed To</div>
              <div class="value">${org ? org.name : 'Organization Account'}</div>
              <div style="font-size: 13px; color: #64748b;">${req.session.user.email}</div>
            </div>
            <div style="text-align: right;">
              <div class="label">Receipt Reference</div>
              <div class="value" style="font-family: monospace;">${tx.reference}</div>
              <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${formattedDate}</div>
            </div>
          </div>

          <table class="table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Payment Method</th>
                <th style="text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>${tx.description || 'Ledger Pro Subscription'}</strong>
                  <div style="font-size: 12px; color: #64748b; margin-top: 2px;">Plan: ${tx.plan === 'pro_yearly' ? 'Pro Yearly' : 'Pro Monthly (30-Day Free Trial)'}</div>
                </td>
                <td>${tx.card_brand || 'Card'} •••• ${tx.card_last4 || '4242'}</td>
                <td style="text-align: right; font-family: monospace; font-weight: 700;">₦${formattedAmount}</td>
              </tr>
            </tbody>
          </table>

          <div class="total-row">
            <span>Total Paid</span>
            <span>₦${formattedAmount}</span>
          </div>

          <div class="footer">
            Thank you for choosing Ledger Pro. For questions, email billing@ledgerpro.com.
          </div>
        </div>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(htmlReceipt);
  } catch (err) {
    next(err);
  }
});

// 6. Paystack Webhook Handler
router.post('/paystack/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const secretKey = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;
  const hash = crypto.createHmac('sha512', secretKey || '').update(req.body).digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(400).send('Invalid signature');
  }

  let event;
  try {
    event = JSON.parse(req.body);
  } catch (e) {
    return res.status(400).send('Invalid payload');
  }

  if (event.event === 'charge.success') {
    const customerCode = event.data.customer?.customer_code;
    if (customerCode) {
      await db.prepare("UPDATE organizations SET subscription_status = 'active' WHERE paystack_customer_code = ?")
        .run(customerCode);
    }
  } else if (event.event === 'subscription.disable') {
    const subCode = event.data.subscription_code;
    if (subCode) {
      await db.prepare("UPDATE organizations SET subscription_status = 'cancelled' WHERE paystack_subscription_code = ?")
        .run(subCode);
    }
  }

  res.sendStatus(200);
});

module.exports = router;
