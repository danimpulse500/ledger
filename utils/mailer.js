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

module.exports = { sendInvoiceEmail, createTransporter };
