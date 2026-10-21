/**
 * CSV Generation utility with CSV injection (formula injection) defense
 */

function sanitizeForCsv(value) {
  if (value === null || value === undefined) {
    return '';
  }
  let str = String(value);

  // Prevent formula injection in spreadsheet software (Excel, Google Sheets, Calc)
  // If the cell begins with =, +, -, @, \t, \r, prepend a single quote
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // Escape double quotes by doubling them
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    str = `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

function generateCsv(headers, rows) {
  const headerLine = headers.map(sanitizeForCsv).join(',');
  const rowLines = rows.map((row) => row.map(sanitizeForCsv).join(','));
  const csvContent = [headerLine, ...rowLines].join('\r\n');
  return Buffer.from(csvContent, 'utf-8');
}

module.exports = {
  sanitizeForCsv,
  generateCsv,
};

