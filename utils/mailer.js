const nodemailer = require('nodemailer');

/**
 * Creates a Nodemailer transporter configured for Gmail / SMTP.
 * Falls back to console/stream logging if credentials are missing.
 */
function createTransporter() {
  const user = process.env.GMAIL_USER || process.env.SMTP_USER;
  const pass = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS;
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  if (user && pass) {
    return {
      transporter: nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      }),
      configured: true,
      user,
    };
  }

  // Fallback logger transport when SMTP is not configured yet
  return {
    transporter: nodemailer.createTransport({
      streamTransport: true,
      newline: 'unix',
      buffer: true,
    }),
    configured: false,
    user: 'no-reply@invoicingapp.local',
  };
}

/**
 * Sends an invoice email with attached PDF.
 * @param {Object} opts
 * @param {Object} opts.invoice - Invoice object
 * @param {Array} opts.items - Line items array
 * @param {Object} opts.settings - Company settings
 * @param {string} opts.recipientEmail - Target recipient email address
 * @param {Buffer} opts.pdfBuffer - PDF file Buffer
 * @param {string} [opts.customNote] - Optional custom message to client
 */
async function sendInvoiceEmail({ invoice, items, settings, recipientEmail, pdfBuffer, customNote }) {
  const { transporter, configured, user } = createTransporter();

  const companyName = settings.company_name || 'Invoicing App';
  const currency = settings.currency_symbol || '$';
  const balanceDue = (invoice.total - invoice.amount_paid).toFixed(2);
  const formattedTotal = invoice.total.toFixed(2);
  const pdfFilename = `${invoice.invoice_number}.pdf`;

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f4ef; color: #1f2421; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px; border: 1px solid #e2e0d6; }
        .header { border-bottom: 2px solid #000000; padding-bottom: 15px; margin-bottom: 20px; }
        .header h2 { color: #000000; margin: 0; font-size: 24px; }
        .subtext { color: #63696a; font-size: 14px; margin-top: 4px; }
        .summary-card { background: #f9f8f4; border: 1px solid #e2e0d6; border-radius: 6px; padding: 15px 20px; margin: 20px 0; }
        .summary-row { display: flex; justify-content: space-between; margin: 8px 0; font-size: 15px; }
        .summary-row.total { font-weight: bold; font-size: 18px; color: #000000; border-top: 1px solid #e2e0d6; padding-top: 10px; margin-top: 10px; }
        .summary-row.balance { color: #c08a1e; font-weight: bold; }
        .badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; text-transform: uppercase; background: #f1f5f9; color: #000000; }
        .footer { font-size: 12px; color: #9a9d94; text-align: center; margin-top: 30px; border-top: 1px solid #e2e0d6; padding-top: 15px; }
        .btn { display: inline-block; background: #000000; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 15px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>${companyName}</h2>
          <div class="subtext">Invoice ${invoice.invoice_number}</div>
        </div>

        <p>Dear ${invoice.client_name || 'Valued Client'},</p>
        <p>Please find attached your invoice <strong>${invoice.invoice_number}</strong> from ${companyName}.</p>

        ${customNote ? `<blockquote style="background:#f4f6f5; padding:12px 15px; border-left:4px solid #000000; margin:15px 0;">${customNote}</blockquote>` : ''}

        <div class="summary-card">
          <div class="summary-row">
            <span>Invoice Number:</span>
            <strong>${invoice.invoice_number}</strong>
          </div>
          <div class="summary-row">
            <span>Issue Date:</span>
            <span>${invoice.issue_date}</span>
          </div>
          <div class="summary-row">
            <span>Due Date:</span>
            <span>${invoice.due_date}</span>
          </div>
          <div class="summary-row">
            <span>Status:</span>
            <span class="badge">${invoice.status}</span>
          </div>
          <div class="summary-row total">
            <span>Total Amount:</span>
            <span>${currency}${formattedTotal}</span>
          </div>
          <div class="summary-row balance">
            <span>Balance Due:</span>
            <span>${currency}${balanceDue}</span>
          </div>
        </div>

        <p>The PDF copy of this invoice is attached to this email for your records.</p>
        <p>If you have any questions, please feel free to reply directly to this email.</p>

        <div class="footer">
          Sent by ${companyName} via Invoicing App.
        </div>
      </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `"${companyName}" <${user}>`,
    to: recipientEmail,
    subject: `Invoice ${invoice.invoice_number} from ${companyName}`,
    text: `Invoice ${invoice.invoice_number} from ${companyName}\nTotal: ${currency}${formattedTotal}\nBalance Due: ${currency}${balanceDue}\nDue Date: ${invoice.due_date}`,
    html: htmlBody,
    attachments: [
      {
        filename: pdfFilename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  };

  const info = await transporter.sendMail(mailOptions);

  return {
    success: true,
    configured,
    info,
    message: configured
      ? `Invoice ${invoice.invoice_number} successfully emailed to ${recipientEmail}`
      : `SMTP credentials not configured in .env. Email simulated to ${recipientEmail} (logged to server console).`,
  };
}

/**
 * Sends a subscription / payment confirmation email receipt.
 */
async function sendPaymentConfirmationEmail({ recipientEmail, orgName, plan, amount, reference, cardBrand, cardLast4, nextBillingDate }) {
  const { transporter, configured, user } = createTransporter();

  const formattedAmount = typeof amount === 'number' ? amount.toFixed(2) : amount;
  const isTrial = amount === 0 || amount === '0' || amount === '0.00';
  const planName = plan === 'pro_yearly' ? 'Ledger Pro (Yearly Plan)' : 'Ledger Pro (30-Day Free Trial)';

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 20px; }
        .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
        .badge { display: inline-block; background: #0f172a; color: #ffffff; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; padding: 4px 10px; border-radius: 9999px; }
        .receipt-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 24px 0; }
        .receipt-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; color: #475569; border-bottom: 1px border #f1f5f9; }
        .receipt-row.total { font-weight: 800; font-size: 18px; color: #0f172a; border-top: 2px solid #e2e8f0; border-bottom: none; padding-top: 12px; margin-top: 8px; }
        .footer { font-size: 12px; color: #94a3b8; text-align: center; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 24px;">
          <h2 style="margin:0; font-size: 22px; font-weight: 900; color: #0f172a;">Ledger Pro</h2>
          <span class="badge">${isTrial ? '30-Day Free Trial' : 'Payment Received'}</span>
        </div>

        <p style="font-size: 15px; font-weight: 600; color: #0f172a;">Hi ${orgName || 'Valued Customer'},</p>
        <p style="font-size: 14px; color: #475569; line-height: 1.6;">
          ${isTrial 
            ? 'Your <strong>30-Day Free Trial</strong> for Ledger Pro has been activated successfully! You now have full unlimited access to generate invoices and manage billing.'
            : 'Thank you for your payment! Your subscription to <strong>Ledger Pro</strong> is active and up to date.'}
        </p>

        <div class="receipt-card">
          <div class="receipt-row">
            <span>Transaction Ref:</span>
            <strong style="font-family: monospace; color: #0f172a;">${reference}</strong>
          </div>
          <div class="receipt-row">
            <span>Selected Plan:</span>
            <strong style="color: #0f172a;">${planName}</strong>
          </div>
          <div class="receipt-row">
            <span>Payment Method:</span>
            <span>${cardBrand || 'Card'} •••• ${cardLast4 || '4242'}</span>
          </div>
          <div class="receipt-row">
            <span>Next Renewal Date:</span>
            <span>${nextBillingDate || 'In 30 Days'}</span>
          </div>
          <div class="receipt-row total">
            <span>Amount Charged Today:</span>
            <span>₦${formattedAmount}</span>
          </div>
        </div>

        <p style="font-size: 13px; color: #64748b;">
          You can view and download your full payment receipt anytime directly from your <a href="/billing" style="color: #2563eb; font-weight: 600; text-decoration: none;">Billing Settings</a> page.
        </p>

        <div class="footer">
          &copy; ${new Date().getFullYear()} Ledger Pro Invoicing Platform. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Ledger Pro Billing" <${user}>`,
      to: recipientEmail,
      subject: isTrial ? `30-Day Free Trial Confirmation - Ledger Pro` : `Payment Receipt [Ref: ${reference}] - Ledger Pro`,
      html: htmlBody,
    });
    return { success: true, info, configured };
  } catch (err) {
    console.error('[Mailer Error]: Failed to send payment confirmation email:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Sends an email verification link to a newly registered user.
 */
async function sendVerificationEmail({ recipientEmail, name, token, baseUrl }) {
  const { transporter, configured, user } = createTransporter();
  const appBaseUrl = baseUrl || process.env.APP_BASE_URL || 'http://localhost:3000';
  const verifyUrl = `${appBaseUrl}/verify-email?token=${token}`;

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 24px; }
        .container { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 20px; padding: 40px; border: 1px solid #e2e8f0; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05); }
        .brand { font-size: 20px; font-weight: 900; text-transform: uppercase; letter-spacing: -0.025em; color: #0f172a; margin-bottom: 32px; display: inline-block; }
        .title { font-size: 24px; font-weight: 800; color: #0f172a; margin-top: 0; margin-bottom: 12px; }
        .text { font-size: 15px; color: #475569; line-height: 1.6; margin-bottom: 24px; }
        .btn { display: inline-block; background-color: #0f172a; color: #ffffff !important; font-weight: 700; font-size: 14px; padding: 14px 32px; border-radius: 9999px; text-decoration: none; text-align: center; }
        .btn-wrapper { margin: 32px 0; text-align: left; }
        .subtext { font-size: 13px; color: #64748b; margin-top: 32px; padding-top: 20px; border-top: 1px solid #f1f5f9; word-break: break-all; }
        .footer { font-size: 12px; color: #94a3b8; margin-top: 24px; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="brand">Ledger</div>
        <h1 class="title">Verify your email address</h1>
        <p class="text">Hi ${name || 'there'},</p>
        <p class="text">Welcome to Ledger! Please verify your email address to complete your account registration and access your workspace.</p>
        
        <div class="btn-wrapper">
          <a href="${verifyUrl}" class="btn">Verify Email Address</a>
        </div>

        <p class="text">This verification link will expire in 24 hours.</p>

        <div class="subtext">
          If the button above doesn't work, copy and paste this URL into your web browser:<br>
          <a href="${verifyUrl}" style="color: #0f172a; text-decoration: underline;">${verifyUrl}</a>
        </div>

        <div class="footer">
          If you didn't create an account with Ledger, you can safely ignore this email.
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Ledger" <${user}>`,
      to: recipientEmail,
      subject: `Verify your email address - Ledger`,
      html: htmlBody,
    });
    return { success: true, info, configured, verifyUrl };
  } catch (err) {
    console.error('[Mailer Error]: Failed to send verification email:', err.message);
    return { success: false, error: err.message, verifyUrl };
  }
}

module.exports = { sendInvoiceEmail, sendPaymentConfirmationEmail, sendVerificationEmail, createTransporter };

