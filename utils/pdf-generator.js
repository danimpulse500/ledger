const fs = require('fs');
const PDFDocument = require('pdfkit');

// Helper to sanitize unicode text into standard WinAnsi / ASCII safe characters for PDFKit Helvetica font
function sanitizeText(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/₦/g, 'NGN ')
    .replace(/€/g, 'EUR ')
    .replace(/£/g, 'GBP ')
    .replace(/₹/g, 'INR ')
    .replace(/₵/g, 'GHS ')
    .replace(/—/g, '-')
    .replace(/–/g, '-')
    .replace(/’/g, "'")
    .replace(/‘/g, "'")
    .replace(/“/g, '"')
    .replace(/”/g, '"')
    .replace(/•/g, '*')
    .replace(/[^\x00-\x7F]/g, ''); // strip any remaining non-ASCII characters
}

function generateInvoicePDF(invoice, items, settings = {}) {
  return new Promise((resolve, reject) => {
    try {
      // Font size design tokens
      const FONT_COMPANY = 16;
      const FONT_TITLE = 18;
      const FONT_INVOICE_NUM = 12;
      const FONT_TABLE_HEADER = 10;
      const FONT_BODY = 10;
      const FONT_TOTALS_LABEL = 11;
      const FONT_TOTAL_AMOUNT = 13;
      const FONT_BALANCE = 12;
      const FONT_FINE = 8;

      const rowHeight = 22;

      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const rawCurrency = settings.currency_symbol || '$';
      const currency = sanitizeText(rawCurrency.trim()) || '$ ';

      const leftMargin = 50;
      const rightMargin = 50;
      const cellPadding = 10;
      const pageWidth = doc.page.width; // 595.28
      const rightEdge = pageWidth - rightMargin; // 545.28
      const tableWidth = rightEdge - leftMargin; // 495.28
      const rightColX = 330;
      const rightColWidth = rightEdge - rightColX; // 215.28

      // --- Header: Company Name & Contact ---
      const hasLogo = settings.invoice_logo_enabled && settings.invoice_logo_path && fs.existsSync(settings.invoice_logo_path);
      const showCompanyName = settings.invoice_company_name_enabled !== 0;

      if (hasLogo) {
        try {
          doc.image(settings.invoice_logo_path, leftMargin, 45, { fit: [120, 40] });
        } catch (e) {
          // ignore invalid logo image
        }
      }

      const companyNameY = hasLogo ? 92 : 45;
      const companyDetailsY = hasLogo ? (showCompanyName ? 117 : 92) : (showCompanyName ? 70 : 45);

      if (showCompanyName) {
        doc.fillColor('#000000')
           .fontSize(FONT_COMPANY)
           .font('Helvetica-Bold')
           .text(sanitizeText(settings.company_name || 'My Company'), leftMargin, companyNameY);
      }

      doc.fillColor('#63696a').fontSize(FONT_FINE).font('Helvetica');
      if (settings.address) {
        doc.text(sanitizeText(settings.address), leftMargin, companyDetailsY, { width: 260 });
      }

      const contactLine = [settings.email, settings.phone].filter(Boolean).map(sanitizeText).join(' * ');
      if (contactLine) {
        doc.text(contactLine, leftMargin, doc.y + 2);
      }
      const companyHeaderBottomY = doc.y;

      // --- Header: Invoice Title & Number ---
      doc.fillColor('#1f2421')
         .fontSize(FONT_TITLE)
         .font('Helvetica-Bold')
         .text('INVOICE', rightColX, 45, { align: 'right', width: rightColWidth });

      doc.fillColor('#000000')
         .fontSize(FONT_INVOICE_NUM)
         .font('Helvetica-Bold')
         .text(sanitizeText(invoice.invoice_number || 'INV-0000'), rightColX, 72, { align: 'right', width: rightColWidth });

      const invoiceHeaderBottomY = doc.y;
      const topDividerY = Math.max(companyHeaderBottomY + 15, invoiceHeaderBottomY + 15, 110);

      doc.moveTo(leftMargin, topDividerY).lineTo(rightEdge, topDividerY).strokeColor('#e2e0d6').lineWidth(1).stroke();

      // --- Party Details (Billed To & Invoice Dates) ---
      const partyY = topDividerY + 15;

      // Billed To (Left Column)
      doc.fillColor('#63696a').fontSize(FONT_FINE).font('Helvetica-Bold').text('BILLED TO', leftMargin, partyY);
      doc.fillColor('#1f2421').fontSize(FONT_BODY + 1).font('Helvetica-Bold').text(sanitizeText(invoice.client_name || 'Client Name'), leftMargin, partyY + 14);

      doc.fillColor('#63696a').fontSize(FONT_BODY).font('Helvetica');
      let currentClientY = partyY + 28;

      if (invoice.client_address) {
        doc.text(sanitizeText(invoice.client_address), leftMargin, currentClientY, { width: 250 });
        currentClientY = doc.y + 2;
      }
      if (invoice.client_email) {
        doc.text(sanitizeText(invoice.client_email), leftMargin, currentClientY);
        currentClientY = doc.y + 2;
      }
      if (invoice.client_tax_id) {
        doc.fillColor('#9a9d94').fontSize(FONT_FINE).font('Helvetica')
           .text(`Tax ID: ${sanitizeText(invoice.client_tax_id)}`, leftMargin, currentClientY);
        currentClientY = doc.y + 2;
      }

      // Details (Right Column)
      doc.fillColor('#63696a').fontSize(FONT_FINE).font('Helvetica-Bold')
         .text('DETAILS', rightColX, partyY, { align: 'right', width: rightColWidth });
      doc.fillColor('#1f2421').fontSize(FONT_BODY).font('Helvetica')
         .text(`Issue Date: ${sanitizeText(invoice.issue_date || 'N/A')}`, rightColX, partyY + 14, { align: 'right', width: rightColWidth })
         .text(`Due Date: ${sanitizeText(invoice.due_date || 'N/A')}`, rightColX, partyY + 28, { align: 'right', width: rightColWidth });

      // --- Table Header ---
      let tableY = Math.max(currentClientY + 20, partyY + 70);
      const descX = leftMargin + cellPadding; // 60

      // Header background
      doc.rect(leftMargin, tableY, tableWidth, rowHeight).fill('#000000');

      doc.fillColor('#ffffff').fontSize(FONT_TABLE_HEADER).font('Helvetica-Bold');
      doc.text('Description', descX, tableY + 6, { width: 215 });
      doc.text('Qty', 275, tableY + 6, { width: 55, align: 'center' });
      doc.text('Unit Price', 335, tableY + 6, { width: 70, align: 'right' });
      doc.text('Discount', 410, tableY + 6, { width: 50, align: 'center' });
      doc.text('Amount', 465, tableY + 6, { width: 70, align: 'right' });

      tableY += rowHeight;

      // --- Table Items ---
      doc.font('Helvetica').fontSize(FONT_BODY);
      (items || []).forEach((item, index) => {
        if (index % 2 === 1) {
          doc.rect(leftMargin, tableY, tableWidth, rowHeight).fill('#f9f8f4');
        }

        const qty = parseFloat(item.quantity) || 0;
        const unitPrice = parseFloat(item.unit_price) || 0;
        const taxRate = parseFloat(item.tax_rate) || 0;
        const lineTotal = parseFloat(item.line_total) || (qty * unitPrice * (1 - taxRate / 100));
        const textY = tableY + 6;

        doc.fillColor('#1f2421').font('Helvetica');
        doc.text(sanitizeText(item.description || ''), descX, textY, { width: 215, height: rowHeight - 6, ellipsis: true });
        doc.text(String(qty), 275, textY, { width: 55, align: 'center' });
        doc.text(`${currency}${unitPrice.toFixed(2)}`, 335, textY, { width: 70, align: 'right' });
        doc.text(`${taxRate}%`, 410, textY, { width: 50, align: 'center' });
        doc.text(`${currency}${lineTotal.toFixed(2)}`, 465, textY, { width: 70, align: 'right' });

        tableY += rowHeight;
      });

      // Bottom border line
      doc.moveTo(leftMargin, tableY).lineTo(rightEdge, tableY).strokeColor('#e2e0d6').lineWidth(1).stroke();

      // --- Totals Section ---
      let totalsY = tableY + 15;
      const rightLabelX = 300;
      const valX = 420;
      const valWidth = rightEdge - valX; // 125.28 pt

      const subtotal = parseFloat(invoice.subtotal) || 0;
      const taxTotal = parseFloat(invoice.tax_total) || 0;
      const grandTotal = parseFloat(invoice.total) || (subtotal - taxTotal);
      const paid = parseFloat(invoice.amount_paid) || 0;
      const balance = grandTotal - paid;

      doc.fillColor('#63696a').fontSize(FONT_TOTALS_LABEL).font('Helvetica');
      doc.text('Subtotal:', rightLabelX, totalsY, { width: 110, align: 'right' });
      doc.text(`${currency}${subtotal.toFixed(2)}`, valX, totalsY, { width: valWidth, align: 'right' });

      totalsY += 18;
      doc.text('Discount:', rightLabelX, totalsY, { width: 110, align: 'right' });
      doc.text(`${currency}${taxTotal.toFixed(2)}`, valX, totalsY, { width: valWidth, align: 'right' });

      totalsY += 20;
      doc.font('Helvetica-Bold').fillColor('#1f2421').fontSize(FONT_TOTAL_AMOUNT);
      doc.text('Total:', rightLabelX, totalsY, { width: 110, align: 'right' });
      doc.text(`${currency}${grandTotal.toFixed(2)}`, valX, totalsY, { width: valWidth, align: 'right' });

      totalsY += 20;
      doc.font('Helvetica').fillColor('#63696a').fontSize(FONT_TOTALS_LABEL);
      doc.text('Amount Paid:', rightLabelX, totalsY, { width: 110, align: 'right' });
      doc.text(`${currency}${paid.toFixed(2)}`, valX, totalsY, { width: valWidth, align: 'right' });

      totalsY += 20;
      doc.font('Helvetica-Bold').fillColor('#1f2421').fontSize(FONT_BALANCE);
      doc.text('Balance Due:', rightLabelX, totalsY, { width: 110, align: 'right' });
      doc.text(`${currency}${balance.toFixed(2)}`, valX, totalsY, { width: valWidth, align: 'right' });

      // --- Notes / Terms ---
      if (invoice.notes) {
        let notesY = Math.max(tableY + 15, totalsY - 65);
        doc.fillColor('#63696a').fontSize(FONT_FINE).font('Helvetica-Bold').text('NOTES / TERMS', leftMargin, notesY);
        doc.fillColor('#1f2421').fontSize(FONT_BODY).font('Helvetica').text(sanitizeText(invoice.notes), leftMargin, notesY + 12, { width: 260 });
      }

      // Footer
      const footerY = 780;
      doc.fillColor('#9a9d94').fontSize(FONT_FINE).font('Helvetica')
         .text(`Thank you for doing business with ${sanitizeText(showCompanyName ? (settings.company_name || 'us') : 'us')}!`, leftMargin, footerY, { align: 'center', width: tableWidth });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateInvoicePDF };