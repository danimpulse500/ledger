const PDFDocument = require('pdfkit');
const fs = require('fs');

/**
 * Generates a PDF buffer for an invoice.
 * @param {Object} invoice - Invoice database object
 * @param {Array} items - Array of invoice line items
 * @param {Object} settings - Organization company settings
 * @returns {Promise<Buffer>} Resolves to a PDF Buffer
 */
function generateInvoicePDF(invoice, items, settings = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const currency = settings.currency_symbol === '₦' ? 'NGN ' : (settings.currency_symbol || '$');

      // --- Header: Company Name & Contact ---
      const hasLogo = settings.invoice_logo_enabled && settings.invoice_logo_path && fs.existsSync(settings.invoice_logo_path);
      const showCompanyName = settings.invoice_company_name_enabled !== 0;
      if (hasLogo) doc.image(settings.invoice_logo_path, 50, 45, { fit: [120, 40] });
      const companyNameY = hasLogo ? 92 : 45;
      const companyDetailsY = hasLogo ? (showCompanyName ? 117 : 92) : (showCompanyName ? 70 : 45);
      if (showCompanyName) {
        doc.fillColor('#000000').fontSize(20).font('Helvetica-Bold').text(settings.company_name || 'My Company', 50, companyNameY);
      }
      doc.fillColor('#63696a').fontSize(9).font('Helvetica');
      if (settings.address) doc.text(settings.address, 50, companyDetailsY, { width: 260 });
      const contactLine = [settings.email, settings.phone].filter(Boolean).join(' · ');
      if (contactLine) doc.text(contactLine, 50, doc.y + 2);
      const companyHeaderBottomY = doc.y;

      // --- Header: Invoice Title & Number ---
      doc.fillColor('#1f2421').fontSize(22).font('Helvetica-Bold').text('INVOICE', 350, 45, { align: 'right', width: 190 });
      doc.fillColor('#000000').fontSize(12).font('Helvetica-Bold').text(invoice.invoice_number, 350, 72, { align: 'right', width: 190 });
      const invoiceHeaderBottomY = doc.y;

      const topDividerY = Math.max(companyHeaderBottomY + 15, invoiceHeaderBottomY + 15, 110);
      doc.moveTo(50, topDividerY).lineTo(540, topDividerY).strokeColor('#e2e0d6').lineWidth(1).stroke();

      // --- Party Details (Billed To & Invoice Metadata) ---
      const partyY = topDividerY + 15;
      
      // Billed To (Left Column)
      doc.fillColor('#63696a').fontSize(8).font('Helvetica-Bold').text('BILLED TO', 50, partyY);
      doc.fillColor('#1f2421').fontSize(11).font('Helvetica-Bold').text(invoice.client_name || 'Client Name', 50, partyY + 14);
      doc.fillColor('#63696a').fontSize(9).font('Helvetica');
      let currentClientY = partyY + 28;
      if (invoice.client_address) {
        doc.text(invoice.client_address, 50, currentClientY, { width: 250 });
        currentClientY = doc.y + 2;
      }
      if (invoice.client_email) {
        doc.text(invoice.client_email, 50, currentClientY);
        currentClientY = doc.y + 2;
      }
      if (invoice.client_tax_id) {
        doc.fillColor('#9a9d94').fontSize(8).font('Helvetica').text(`Tax ID: ${invoice.client_tax_id}`, 50, currentClientY);
      }

      // Details (Right Column)
      doc.fillColor('#63696a').fontSize(8).font('Helvetica-Bold').text('DETAILS', 350, partyY, { align: 'right', width: 190 });
      doc.fillColor('#1f2421').fontSize(9).font('Helvetica')
         .text(`Issue Date: ${invoice.issue_date || 'N/A'}`, 350, partyY + 14, { align: 'right', width: 190 })
        .text(`Due Date: ${invoice.due_date || 'N/A'}`, 350, partyY + 28, { align: 'right', width: 190 });

      // --- Table Header ---
      let tableY = Math.max(currentClientY + 25, partyY + 70);
      doc.rect(50, tableY, 490, 22).fill('#000000');
      doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
         .text('Description', 60, tableY + 6, { width: 220 })
         .text('Qty', 285, tableY + 6, { width: 40, align: 'center' })
         .text('Unit Price', 330, tableY + 6, { width: 65, align: 'right' })
         .text('Discount', 395, tableY + 6, { width: 55, align: 'right' })
         .text('Amount', 450, tableY + 6, { width: 90, align: 'right' });

      // --- Table Items ---
      tableY += 22;
      doc.font('Helvetica').fontSize(9);
      (items || []).forEach((item, index) => {
        if (index % 2 === 1) {
          doc.rect(50, tableY, 490, 22).fill('#f9f8f4');
        }
        const qty = parseFloat(item.quantity) || 0;
        const unitPrice = parseFloat(item.unit_price) || 0;
        const taxRate = parseFloat(item.tax_rate) || 0;
        const lineTotal = parseFloat(item.line_total) || (qty * unitPrice * (1 - taxRate / 100));

        doc.fillColor('#1f2421').font('Helvetica')
           .text(item.description || '', 60, tableY + 6, { width: 220, height: 14, ellipsis: true })
           .text(String(qty), 285, tableY + 6, { width: 40, align: 'center' })
           .text(`${currency}${unitPrice.toFixed(2)}`, 330, tableY + 6, { width: 65, align: 'right' })
           .text(`${taxRate}%`, 395, tableY + 6, { width: 55, align: 'right' })
           .text(`${currency}${lineTotal.toFixed(2)}`, 450, tableY + 6, { width: 90, align: 'right' });

        tableY += 22;
      });

      doc.moveTo(50, tableY + 4).lineTo(540, tableY + 4).strokeColor('#e2e0d6').lineWidth(1).stroke();

      // --- Totals Section ---
      let totalsY = tableY + 15;
      const rightLabelX = 360;
      const valX = 450;

      const subtotal = parseFloat(invoice.subtotal) || 0;
      const taxTotal = parseFloat(invoice.tax_total) || 0;
      const grandTotal = parseFloat(invoice.total) || (subtotal - taxTotal);
      const paid = parseFloat(invoice.amount_paid) || 0;
      const balance = grandTotal - paid;

      doc.fillColor('#63696a').fontSize(9).font('Helvetica')
         .text('Subtotal:', rightLabelX, totalsY, { width: 90, align: 'right' })
         .text(`${currency}${subtotal.toFixed(2)}`, valX, totalsY, { width: 90, align: 'right' });

      totalsY += 16;
      doc.text('Discount:', rightLabelX, totalsY, { width: 90, align: 'right' })
         .text(`${currency}${taxTotal.toFixed(2)}`, valX, totalsY, { width: 90, align: 'right' });

      totalsY += 18;
      doc.font('Helvetica-Bold').fillColor('#1f2421').fontSize(11)
         .text('Total:', rightLabelX, totalsY, { width: 90, align: 'right' })
         .text(`${currency}${grandTotal.toFixed(2)}`, valX, totalsY, { width: 90, align: 'right' });

      totalsY += 18;
      doc.font('Helvetica').fillColor('#63696a').fontSize(9)
         .text('Amount Paid:', rightLabelX, totalsY, { width: 90, align: 'right' })
         .text(`${currency}${paid.toFixed(2)}`, valX, totalsY, { width: 90, align: 'right' });

      totalsY += 18;
      doc.font('Helvetica-Bold').fillColor('#1f2421').fontSize(10)
         .text('Balance Due:', rightLabelX, totalsY, { width: 90, align: 'right' })
         .text(`${currency}${balance.toFixed(2)}`, valX, totalsY, { width: 90, align: 'right' });

      // --- Notes & Footer ---
      if (invoice.notes) {
        let notesY = Math.max(tableY + 15, totalsY - 60);
        doc.fillColor('#63696a').fontSize(8).font('Helvetica-Bold').text('NOTES / TERMS', 50, notesY);
        doc.fillColor('#1f2421').fontSize(9).font('Helvetica').text(invoice.notes, 50, notesY + 12, { width: 280 });
      }

      const footerY = 780;
      doc.fillColor('#9a9d94').fontSize(8).font('Helvetica')
        .text(`Thank you for doing business with ${showCompanyName ? (settings.company_name || 'us') : 'us'}!`, 50, footerY, { align: 'center', width: 490 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateInvoicePDF };
