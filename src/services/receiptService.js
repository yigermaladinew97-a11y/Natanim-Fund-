const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { formatMoney, formatDualMonth, formatPaymentMethod, getEthiopianToday } = require('../utils/formatters');
const { getCurrency } = require('./accounting');

/**
 * Locate best available font for rendering Ethiopic (Ge'ez) and Latin script.
 */
function getFontPath() {
  const candidates = [
    path.join(__dirname, '../../assets/fonts/EthiopianFont.ttf'),
    path.join(__dirname, '../assets/fonts/EthiopianFont.ttf'),
    path.join(process.cwd(), 'assets', 'fonts', 'EthiopianFont.ttf'),
    'C:/Windows/Fonts/nyala.ttf',
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Generate a high-resolution, beautifully styled PDF church receipt.
 * Resolves with a Buffer containing the complete PDF document.
 * 
 * @param {Object} data Receipt information
 * @returns {Promise<Buffer>}
 */
function generatePaymentReceiptPdf(data) {
  return new Promise((resolve, reject) => {
    try {
      const fontPath = getFontPath();
      const hasEthiopicFont = !!fontPath;

      // A5 Portrait: 419.53 x 595.28 pt
      const doc = new PDFDocument({
        size: 'A5',
        margin: 28,
        info: {
          Title: `Natanim Church Fund Receipt - ${data.txId || 'Official'}`,
          Author: 'Natanim Church Fund Management System',
          Subject: 'Monthly Contribution Receipt',
          Keywords: 'church, donation, receipt, natanim, ethiopia',
        },
      });

      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      // Register font or fallback
      if (hasEthiopicFont) {
        doc.font(fontPath);
      } else {
        doc.font('Helvetica');
      }

      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const margin = 28;
      const contentWidth = pageWidth - margin * 2;

      // ==========================================
      // 1. Decorative Borders (Double Luxury Border)
      // ==========================================
      doc.rect(margin - 8, margin - 8, contentWidth + 16, pageHeight - (margin * 2) + 16)
        .lineWidth(2)
        .strokeColor('#1B365D') // Navy
        .stroke();

      doc.rect(margin - 4, margin - 4, contentWidth + 8, pageHeight - (margin * 2) + 8)
        .lineWidth(0.8)
        .strokeColor('#C59B27') // Church Gold
        .stroke();

      // ==========================================
      // 2. Header & Branding Banner
      // ==========================================
      let y = margin + 8;

      // Church Cross & Title
      doc.fontSize(20).fillColor('#C59B27').text('✝', { align: 'center' });
      y += 18;

      doc.fontSize(14).fillColor('#1B365D')
        .text('ናታኒም የወንጌላውያን አማኞች ቤተክርስቲያን ፈንድ', { align: 'center' });
      y += 18;

      doc.fontSize(10.5).fillColor('#4A5568')
        .text('NATANIM EVANGELICAL CHURCH MONTHLY CONTRIBUTION FUND', { align: 'center' });
      y += 15;

      doc.fontSize(11).fillColor('#975A16')
        .text('ይፋዊ የክፍያ ማረጋገጫ ደረሰኝ • OFFICIAL PAYMENT RECEIPT', { align: 'center' });
      y += 18;

      // Thin separator line
      doc.moveTo(margin + 20, y).lineTo(pageWidth - margin - 20, y)
        .lineWidth(1)
        .strokeColor('#E2E8F0')
        .stroke();
      y += 10;

      // ==========================================
      // 3. Receipt Metadata Bar (Tx ID & Issue Date)
      // ==========================================
      const today = getEthiopianToday();
      const issueDateAm = data.dateFormatted || `${today.formattedAm} (${new Date().toISOString().slice(0, 10)})`;
      const txCode = data.txId || `TX-${Date.now().toString(36).toUpperCase()}`;

      // Left: TxID, Right: Date
      doc.fontSize(9).fillColor('#718096')
        .text('የደረሰኝ / ክፍያ መለያ (Transaction ID):', margin, y);
      doc.fontSize(9.5).fillColor('#1B365D')
        .text(txCode, margin, y + 12);

      doc.fontSize(9).fillColor('#718096')
        .text('የተሰጠበት ቀን (Issue Date):', margin + 190, y, { width: 160, align: 'right' });
      doc.fontSize(9).fillColor('#1B365D')
        .text(issueDateAm, margin + 190, y + 12, { width: 160, align: 'right' });

      y += 32;

      // ==========================================
      // 4. Member Profile Box
      // ==========================================
      doc.roundedRect(margin, y, contentWidth, 54, 5)
        .fillColor('#F7FAFC')
        .fillAndStroke('#E2E8F0');

      const memberName = data.memberName || 'Anonymous Member';
      const memberId = data.memberId ? `#${data.memberId}` : 'N/A';
      const memberPhone = data.phone || 'Not specified';

      doc.fontSize(9).fillColor('#718096')
        .text('የአባል ስም (Member Name):', margin + 12, y + 8);
      doc.fontSize(11).fillColor('#1A202C')
        .text(memberName, margin + 12, y + 22);

      doc.fontSize(9).fillColor('#718096')
        .text('የአባል መለያ (ID):', margin + 180, y + 8);
      doc.fontSize(10).fillColor('#1B365D')
        .text(memberId, margin + 180, y + 22);

      doc.fontSize(9).fillColor('#718096')
        .text('ስልክ (Phone):', margin + 260, y + 8);
      doc.fontSize(9.5).fillColor('#2D3748')
        .text(memberPhone, margin + 260, y + 22);

      y += 66;

      // ==========================================
      // 5. Payment Details Table
      // ==========================================
      const currency = data.currency || getCurrency();
      const amountFormatted = formatMoney(data.amountCents || 0, currency);
      const methodFormatted = formatPaymentMethod(data.paymentMethod || 'bank_transfer');
      const refNumber = data.referenceNumber || 'None / Direct';

      let coveredPeriodsStr = 'Current Month';
      if (Array.isArray(data.monthsCovered) && data.monthsCovered.length > 0) {
        coveredPeriodsStr = data.monthsCovered.map(formatDualMonth).join(', ');
      } else if (data.yearMonth) {
        coveredPeriodsStr = formatDualMonth(data.yearMonth);
      }

      // Table Header
      doc.rect(margin, y, contentWidth, 22)
        .fillColor('#1B365D')
        .fill();

      doc.fontSize(9.5).fillColor('#FFFFFF')
        .text('የመዋጮ ዝርዝር / Contribution Description', margin + 10, y + 6)
        .text('መጠን / Amount', margin + contentWidth - 95, y + 6, { width: 85, align: 'right' });
      y += 22;

      // Table Row 1: Periods Covered
      doc.rect(margin, y, contentWidth, 26)
        .fillColor('#FFFFFF')
        .fillAndStroke('#E2E8F0');
      doc.fontSize(9.5).fillColor('#2D3748')
        .text('የወርሃዊ መዋጮ ጊዜ (Period Covered):', margin + 10, y + 7)
        .text(coveredPeriodsStr, margin + 180, y + 7, { width: 170 });
      y += 26;

      // Table Row 2: Method & Bank Ref
      doc.rect(margin, y, contentWidth, 26)
        .fillColor('#F7FAFC')
        .fillAndStroke('#E2E8F0');
      doc.fontSize(9.5).fillColor('#2D3748')
        .text('የክፍያ ዘዴ (Method) / Ref:', margin + 10, y + 7)
        .text(`${methodFormatted} (Ref: ${refNumber})`, margin + 180, y + 7, { width: 170 });
      y += 26;

      // Table Row 3: Total Paid Highlight
      doc.rect(margin, y, contentWidth, 32)
        .fillColor('#EDF2F7')
        .fillAndStroke('#CBD5E0');
      doc.fontSize(11).fillColor('#1A202C')
        .text('ጠቅላላ የተከፈለ (TOTAL PAID):', margin + 10, y + 10);
      doc.fontSize(13).fillColor('#22543D')
        .text(amountFormatted, margin + contentWidth - 140, y + 9, { width: 130, align: 'right' });
      y += 40;

      // ==========================================
      // 6. Status Badge & Verification Seal
      // ==========================================
      const isFull = (data.status || 'FULLY_PAID').toUpperCase().includes('FULL');
      const badgeText = isFull ? '✓ ሙሉ በሙሉ ተከፍሏል • FULLY SETTLED' : 'PARTIALLY PAID • በከፊል ተከፍሏል';
      const badgeBg = isFull ? '#C6F6D5' : '#FEFCBF';
      const badgeBorder = isFull ? '#38A169' : '#D69E2E';
      const badgeTextColor = isFull ? '#22543D' : '#744210';

      doc.roundedRect(margin, y, 220, 24, 4)
        .fillColor(badgeBg)
        .fillAndStroke(badgeBorder);

      doc.fontSize(9).fillColor(badgeTextColor)
        .text(badgeText, margin + 6, y + 6, { width: 208, align: 'center' });

      // Verifier info on right
      const verifiedBy = data.verifiedBy || 'Church Treasury Office';
      doc.fontSize(8.5).fillColor('#718096')
        .text('ያረጋገጠው አካል (Verified By):', margin + 230, y + 2, { align: 'right' })
        .text(verifiedBy, margin + 230, y + 13, { align: 'right' });

      y += 34;

      // ==========================================
      // 7. Spiritual Verse & Blessings
      // ==========================================
      doc.fontSize(9).fillColor('#744210')
        .text('«እግዚአብሔር በደስታ የሚሰጠውን ይወዳልና እያንዳንዱ በልቡ እንዳሰበ ይስጥ።» (2ኛ ቆሮንቶስ 9:7)', {
          align: 'center',
          lineGap: 3,
        });
      y += 18;

      doc.fontSize(8).fillColor('#718096')
        .text('"Each of you should give what you have decided in your heart to give, for God loves a cheerful giver." (2 Corinthians 9:7)', {
          align: 'center',
        });
      y += 18;

      // ==========================================
      // 8. Electronic Authenticity Footer
      // ==========================================
      doc.moveTo(margin + 30, y).lineTo(pageWidth - margin - 30, y)
        .lineWidth(0.5)
        .strokeColor('#CBD5E0')
        .stroke();
      y += 6;

      doc.fontSize(7.5).fillColor('#A0AEC0')
        .text(
          'ይህ ደረሰኝ በናታኒም ፈንድ ሥርዓት በራስ-ሰር የተዘጋጀ ይፋዊ ማረጋገጫ ስለሆነ ያለ ማህተም ህጋዊ ነው።\n' +
          'Generated electronically by Natanim Church Fund Telegram System. Valid without physical signature.',
          { align: 'center', lineGap: 2 }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generatePaymentReceiptPdf,
};
