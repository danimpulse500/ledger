const fs = require('fs');
const { generateInvoicePDF } = require('./utils/pdf-generator');

async function test() {
  const invoice = {
    invoice_number: 'INV-123',
    client_name: 'Test Client',
    client_address: '123 Test St',
    issue_date: '2026-09-05',
    due_date: '2026-09-20',
    subtotal: 100,
    tax_total: 10,
    total: 110,
    amount_paid: 0,
    notes: 'Test notes'
  };
  const items = [
    { description: 'Test Item', quantity: 1, unit_price: 100, tax_rate: 10, line_total: 110 }
  ];
  const settings = {
    company_name: 'Test Company',
    currency_symbol: '$',
    address: '456 Company St'
  };

  const buffer = await generateInvoicePDF(invoice, items, settings);
  fs.writeFileSync('test.pdf', buffer);
  console.log('PDF generated, size:', buffer.length);
}

test().catch(console.error);
