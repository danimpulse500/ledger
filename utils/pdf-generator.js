const fs = require('fs');
const PDFDocument = require('pdfkit');

function generateInvoicePDF(invoice, items, settings = {}) {
  return new Promise((resolve, reject) => {
    try {
      // ----- Font size preferences -----
      const FONT_COMPANY = 16;          // company name (14–18)
      const FONT_TITLE = 18;            // "INVOICE" (14–18)
      const FONT_INVOICE_NUM = 12;      // invoice number (12–14)
      const FONT_TABLE_HEADER = 10;     // table column headers (10–12)
      const FONT_BODY = 10;             // item descriptions, qty, prices (10–12)
      const FONT_TOTALS_LABEL = 11;     // "Subtotal:", "Discount:" etc. (12–14)
      const FONT_TOTAL_AMOUNT = 14;     // "Total:" amount (bold 14–18)
      const FONT_BALANCE = 12;          // "Balance Due:" (bold 12–14)
      const FONT_FINE = 8;              // notes, footer, tax id (8–10)

      const rowHeight = FONT_BODY * 1.6; // ≈16pt for FONT_BODY=10, adjust as needed

      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const leftMargin = 50;
      const rightMargin = 50;
      const cellPadding = 10;
      const pageWidth = doc.page.width; // 595.28
      const rightEdge = pageWidth - rightMargin; // 545.28
      const tableWidth = rightEdge - leftMargin; // 495.28
      const rightColX = 350;
      const rightColWidth = rightEdge - rightColX; // 195.28

      const contentRightEdge = rightEdge - cellPadding; // 535.28 for inner table text & totals alignment

      const buffers = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const currency = settings.currency_symbol === '₦' ? 'NGN ' : (settings.currency_symbol || '$');

      // --- Header: Company Name & Contact ---
      const hasLogo = settings.invoice_logo_enabled && settings.invoice_logo_path && fs.existsSync(settings.invoice_logo_path);
      const showCompanyName = settings.invoice_company_name_enabled !== 0;
      if (hasLogo) doc.image(settings.invoice_logo_path, leftMargin, 45, { fit: [120, 40] });
      const companyNameY = hasLogo ? 92 : 45;
      const companyDetailsY = hasLogo ? (showCompanyName ? 117 : 92) : (showCompanyName ? 70 : 45);
      if (showCompanyName) {
        doc.fillColor('#000000')
           .fontSize(FONT_COMPANY)
           .font('Helvetica-Bold')
           .text(settings.company_name || 'My Company', leftMargin, companyNameY);
      }
      doc.fillColor('#63696a').fontSize(FONT_FINE).font('Helvetica');
      if (settings.address) doc.text(settings.address, leftMargin, companyDetailsY, { width: 260 });
      const contactLine = [settings.email, settings.phone].filter(Boolean).join(' · ');
      if (contactLine) doc.text(contactLine, leftMargin, doc.y + 2);
      const companyHeaderBottomY = doc.y;

      // --- Header: Invoice Title & Number ---
      doc.fillColor('#1f2421')
         .fontSize(FONT_TITLE)
         .font('Helvetica-Bold')
         .text('INVOICE', rightColX, 45, { align: 'right', width: rightColWidth });
      doc.fillColor('#000000')
         .fontSize(FONT_INVOICE_NUM)
         .font('Helvetica-Bold')
         .text(invoice.invoice_number, rightColX, 72, { align: 'right', width: rightColWidth });
      const invoiceHeaderBottomY = doc.y;

      const topDividerY = Math.max(companyHeaderBottomY + 15, invoiceHeaderBottomY + 15, 110);
      doc.moveTo(leftMargin, topDividerY).lineTo(rightEdge, topDividerY).strokeColor('#e2e0d6').lineWidth(1).stroke();

      // --- Party Details (Billed To & Invoice Metadata) ---
      const partyY = topDividerY + 15;

      // Billed To (Left Column)
      doc.fillColor('#63696a').fontSize(FONT_FINE).font('Helvetica-Bold').text('BILLED TO', leftMargin, partyY);
      doc.fillColor('#1f2421').fontSize(FONT_BODY + 1).font('Helvetica-Bold').text(invoice.client_name || 'Client Name', leftMargin, partyY + 14);
      doc.fillColor('#63696a').fontSize(FONT_BODY).font('Helvetica');
      let currentClientY = partyY + 28;
      if (invoice.client_address) {
        doc.text(invoice.client_address, leftMargin, currentClientY, { width: 250 });
        currentClientY = doc.y + 2;
      }
      if (invoice.client_email) {
        doc.text(invoice.client_email, leftMargin, currentClientY);
        currentClientY = doc.y + 2;
      }
      if (invoice.client_tax_id) {
        doc.fillColor('#9a9d94').fontSize(FONT_FINE).font('Helvetica')
           .text(`Tax ID: ${invoice.client_tax_id}`, leftMargin, currentClientY);
      }

      // Details (Right Column)
      doc.fillColor('#63696a').fontSize(FONT_FINE).font('Helvetica-Bold')
         .text('DETAILS', rightColX, partyY, { align: 'right', width: rightColWidth });
      doc.fillColor('#1f2421').fontSize(FONT_BODY).font('Helvetica')
         .text(`Issue Date: ${invoice.issue_date || 'N/A'}`, rightColX, partyY + 14, { align: 'right', width: rightColWidth })
         .text(`Due Date: ${invoice.due_date || 'N/A'}`, rightColX, partyY + 28, { align: 'right', width: rightColWidth });

      // --- Table Header ---
      let tableY = Math.max(currentClientY + 25, partyY + 70);
      const descX = leftMargin + cellPadding; // 60
      const amountWidth = contentRightEdge - 450; // 535.28 - 450 = 85.28

      // Header background (black)
      doc.rect(leftMargin, tableY, tableWidth, rowHeight).fill('#000000');
      doc.fillColor('#ffffff').fontSize(FONT_TABLE_HEADER).font('Helvetica-Bold')
         .text('Description', descX, tableY + (rowHeight - FONT_TABLE_HEADER) / 2 + 1, { width: 215 })
         .text('Qty', 275, tableY + (rowHeight - FONT_TABLE_HEADER) / 2 + 1, { width: 55, align: 'center' })
         .text('Unit Price', 330, tableY + (rowHeight - FONT_TABLE_HEADER) / 2 + 1, { width: 65, align: 'right' })
         .text('Discount', 395, tableY + (rowHeight - FONT_TABLE_HEADER) / 2 + 1, { width: 55, align: 'center' })
         .text('Amount', 450, tableY + (rowHeight - FONT_TABLE_HEADER) / 2 + 1, { width: amountWidth, align: 'right' });

      tableY += rowHeight; // move below header

      // --- Table Items ---
      doc.font('Helvetica').fontSize(FONT_BODY);
      (items || []).forEach((item, index) => {
        // Alternate shading
        if (index % 2 === 1) {
          doc.rect(leftMargin, tableY, tableWidth, rowHeight).fill('#f9f8f4');
        }
        const qty = parseFloat(item.quantity) || 0;
        const unitPrice = parseFloat(item.unit_price) || 0;
        const taxRate = parseFloat(item.tax_rate) || 0;
        const lineTotal = parseFloat(item.line_total) || (qty * unitPrice * (1 - taxRate / 100));

        // Vertical center the text within the row
        const textY = tableY + (rowHeight - FONT_BODY) / 2 + 1;

        doc.fillColor('#1f2421').font('Helvetica')
           .text(item.description || '', descX, textY, { width: 215, height: FONT_BODY * 1.2, ellipsis: true })
           .text(String(qty), 275, textY, { width: 55, align: 'center' })
           .text(`${currency}${unitPrice.toFixed(2)}`, 330, textY, { width: 65, align: 'right' })
           .text(`${taxRate}%`, 395, textY, { width: 55, align: 'center' })
           .text(`${currency}${lineTotal.toFixed(2)}`, 450, textY, { width: amountWidth, align: 'right' });

        tableY += rowHeight;
      });

      // Bottom divider of the table – drawn exactly at the last row's bottom
      doc.moveTo(leftMargin, tableY).lineTo(rightEdge, tableY).strokeColor('#e2e0d6').lineWidth(1).stroke();

      // --- Totals Section ---
      let totalsY = tableY + 15;
      const rightLabelX = 350;
      const valX = 450;
      const valWidth = contentRightEdge - valX; // 85.28

      const subtotal = parseFloat(invoice.subtotal) || 0;
      const taxTotal = parseFloat(invoice.tax_total) || 0;
      const grandTotal = parseFloat(invoice.total) || (subtotal - taxTotal);
      const paid = parseFloat(invoice.amount_paid) || 0;
      const balance = grandTotal - paid;

      // Labels (12–14pt)
      doc.fillColor('#63696a').fontSize(FONT_TOTALS_LABEL).font('Helvetica')
         .text('Subtotal:', rightLabelX, totalsY, { width: 95, align: 'right' })
         .text(`${currency}${subtotal.toFixed(2)}`, valX, totalsY, { width: valWidth, align: 'right' });

      totalsY += 18;
      doc.text('Discount:', rightLabelX, totalsY, { width: 95, align: 'right' })
         .text(`${currency}${taxTotal.toFixed(2)}`, valX, totalsY, { width: valWidth, align: 'right' });

      totalsY += 20;
      doc.font('Helvetica-Bold').fillColor('#1f2421').fontSize(FONT_TOTAL_AMOUNT)
         .text('Total:', rightLabelX, totalsY, { width: 95, align: 'right' })
         .text(`${currency}${grandTotal.toFixed(2)}`, valX, totalsY, { width: valWidth, align: 'right' });

      totalsY += 20;
      doc.font('Helvetica').fillColor('#63696a').fontSize(FONT_TOTALS_LABEL)
         .text('Amount Paid:', rightLabelX, totalsY, { width: 95, align: 'right' })
         .text(`${currency}${paid.toFixed(2)}`, valX, totalsY, { width: valWidth, align: 'right' });

      totalsY += 20;
      doc.font('Helvetica-Bold').fillColor('#1f2421').fontSize(FONT_BALANCE)
         .text('Balance Due:', rightLabelX, totalsY, { width: 95, align: 'right' })
         .text(`${currency}${balance.toFixed(2)}`, valX, totalsY, { width: valWidth, align: 'right' });

      // --- Notes & Footer (fine print) ---
      if (invoice.notes) {
        let notesY = Math.max(tableY + 15, totalsY - 60);
        doc.fillColor('#63696a').fontSize(FONT_FINE).font('Helvetica-Bold')
           .text('NOTES / TERMS', leftMargin, notesY);
        doc.fillColor('#1f2421').fontSize(FONT_BODY).font('Helvetica')
           .text(invoice.notes, leftMargin, notesY + 12, { width: 280 });
      }

      const footerY = 780;
      doc.fillColor('#9a9d94').fontSize(FONT_FINE).font('Helvetica')
        .text(`Thank you for doing business with ${showCompanyName ? (settings.company_name || 'us') : 'us'}!`, leftMargin, footerY, { align: 'center', width: tableWidth });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateInvoicePDF };