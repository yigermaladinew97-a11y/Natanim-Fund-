const test = require('node:test');
const assert = require('node:assert');
const { generatePaymentReceiptPdf } = require('../src/services/receiptService');

test('Digital PDF Church Contribution Receipt Tests', async (suite) => {
  await suite.test('1. Generates valid PDF Buffer starting with %PDF-1. and ending with %%EOF', async () => {
    const pdfBuffer = await generatePaymentReceiptPdf({
      txId: 'TX-20261024-TEST01',
      memberName: 'Brother Daniel Bekele',
      memberId: 1,
      phone: '+251911223344',
      amountCents: 15000,
      currency: 'ETB',
      paymentMethod: 'bank_transfer',
      referenceNumber: 'FT26298AB12C',
      monthsCovered: ['2026-10'],
      status: 'FULLY_PAID',
      verifiedBy: 'Staff Brother Thomas',
    });

    assert.ok(Buffer.isBuffer(pdfBuffer));
    assert.ok(pdfBuffer.length > 5000, `PDF buffer length should be substantial, was ${pdfBuffer.length}`);

    // Check PDF magic header
    const header = pdfBuffer.slice(0, 5).toString('ascii');
    assert.strictEqual(header, '%PDF-');

    // Check PDF EOF marker
    const tail = pdfBuffer.slice(-200).toString('binary');
    assert.ok(tail.includes('%%EOF'), 'PDF should end with standard %%EOF marker');
  });

  await suite.test('2. Multi-month payment receipt generates correctly', async () => {
    const pdfBuffer = await generatePaymentReceiptPdf({
      txId: 'TX-20261024-MULTI',
      memberName: 'Sister Martha Gebre',
      memberId: 4,
      phone: '+251922334455',
      amountCents: 45000,
      currency: 'ETB',
      paymentMethod: 'mobile_money',
      referenceNumber: 'CI7102983749',
      monthsCovered: ['2026-10', '2026-11', '2026-12'],
      status: 'FULLY_PAID',
    });

    assert.ok(Buffer.isBuffer(pdfBuffer));
    assert.ok(pdfBuffer.length > 5000);
    assert.strictEqual(pdfBuffer.slice(0, 5).toString('ascii'), '%PDF-');
  });

  await suite.test('3. Generates receipt with minimal optional fields without crashing', async () => {
    const pdfBuffer = await generatePaymentReceiptPdf({
      amountCents: 5000,
    });

    assert.ok(Buffer.isBuffer(pdfBuffer));
    assert.ok(pdfBuffer.length > 3000);
    assert.strictEqual(pdfBuffer.slice(0, 5).toString('ascii'), '%PDF-');
  });
});
