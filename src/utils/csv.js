// Prevent spreadsheet formula execution while preserving normal text exports.
const safeCsvCell = (value) => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
};

module.exports = { safeCsvCell };
