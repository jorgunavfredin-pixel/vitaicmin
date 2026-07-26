const sharp = require("sharp");
const axios = require("axios");

/**
 * Preset themes — buyer tinggal pilih THEME_PRESET di .env
 * Atau pakai custom THEME_COLOR + THEME_BG
 */
const PRESETS = {
  gold: { color: '#C9A44A', bg: '#16182A' },  // Emas + Navy gelap
  purple: { color: '#e95ee2', bg: '#0d0d1a' },  // Ungu/Pink + Hitam
  blue: { color: '#4A9FF5', bg: '#0a1628' },  // Biru + Navy gelap
  green: { color: '#2ECC71', bg: '#0a1a0f' },  // Hijau + Hijau tua
  red: { color: '#E74C3C', bg: '#1a0a0a' },  // Merah + Merah tua
  cyan: { color: '#00D4AA', bg: '#0a1a1a' },  // Cyan + Teal gelap
  orange: { color: '#F39C12', bg: '#1a1008' },  // Oranye + Coklat tua
  white: { color: '#FFFFFF', bg: '#1a1a2e' },  // Putih + Biru tua
  pink: { color: '#FF6B9D', bg: '#1a0a14' },  // Pink + Merah tua
  lime: { color: '#A8E652', bg: '#101a08' },  // Lime + Hijau tua
};

/**
 * Generate premium QRIS frame with proper spacing
 * @param {string} qrImageUrl
 * @returns {Promise<Buffer>}
 */
const generateQRISTwibbon = async (qrImageUrl) => {
  const response = await axios.get(qrImageUrl, { responseType: "arraybuffer" });
  const qrBuffer = Buffer.from(response.data);

  // Normalize hex: SVG only supports #RRGGBB, strip alpha from #RRGGBBAA
  const normalizeHex = (hex) => {
    if (!hex) return null;
    hex = hex.trim();
    if (hex.length === 9 && hex.startsWith('#')) return hex.slice(0, 7);
    return hex;
  };

  // Resolve theme: preset > custom > default
  const storeName = (process.env.STORE_NAME || 'STORE').toUpperCase();
  const preset = PRESETS[(process.env.THEME_PRESET || '').toLowerCase()];
  const themeColor = normalizeHex(process.env.THEME_COLOR) || (preset ? preset.color : '#C9A44A');
  const themeBg = normalizeHex(process.env.THEME_BG) || (preset ? preset.bg : '#16182A');

  // ===== Auto-contrast: hitung brightness background =====
  const getBrightness = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000; // 0-255
  };

  const bgBrightness = getBrightness(themeBg);
  // Subtitle warna otomatis: background gelap → abu terang, background terang → abu gelap
  const subtitleColor = bgBrightness > 128 ? '#4a4a5a' : '#8a8ea4';
  const noteColor = bgBrightness > 128 ? '#5a5a6a' : '#7a7e94';

  // Generate lighter shade for gradient
  const lighten = (hex) => {
    const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + 40);
    const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + 40);
    const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + 40);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };
  const themeLight = lighten(themeColor);

  // Darker BG shades
  const darken = (hex, amount) => {
    const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
    const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
    const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };
  const bgMid = darken(themeBg, 8);
  const bgDark = darken(themeBg, 14);

  // Canvas 1:1
  const S = 450;

  // Layout - explicit positions
  const qrSize = 240;
  const qrPad = 14;
  const qrCardW = qrSize + qrPad * 2;  // 268
  const qrX = Math.round((S - qrSize) / 2);  // 105
  const qrY = 105;
  const cardX = qrX - qrPad;   // 91
  const cardY = qrY - qrPad;   // 91
  const cardBottom = qrY + qrSize + qrPad; // 359

  const resizedQR = await sharp(qrBuffer)
    .resize(qrSize, qrSize)
    .png()
    .toBuffer();

  const svg = `
  <svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${themeBg}"/>
        <stop offset="60%" stop-color="${bgMid}"/>
        <stop offset="100%" stop-color="${bgDark}"/>
      </linearGradient>
      <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="${themeColor}"/>
        <stop offset="55%" stop-color="${themeLight}"/>
        <stop offset="100%" stop-color="${themeColor}"/>
      </linearGradient>
      <linearGradient id="border" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${themeColor}" stop-opacity="0.5"/>
        <stop offset="50%" stop-color="${themeLight}" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="${themeColor}" stop-opacity="0.5"/>
      </linearGradient>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="6" result="b"/>
        <feColorMatrix in="b" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0.18 0"/>
        <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="shadow" x="-20%" y="-10%" width="140%" height="140%">
        <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.5"/>
      </filter>
    </defs>

    <!-- Background -->
    <rect width="${S}" height="${S}" rx="18" fill="url(#bg)"/>
    <rect x="2" y="2" width="${S - 4}" height="${S - 4}" rx="16" fill="none" stroke="url(#border)" stroke-width="1.5" filter="url(#glow)"/>

    <!-- Top gold line -->
    <line x1="35" y1="28" x2="${S - 35}" y2="28" stroke="${themeColor}" stroke-width="1" opacity="0.35"/>

    <!-- Title -->
    <text x="${S / 2}" y="60" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700" fill="${themeColor}" letter-spacing="0.5">${storeName}</text>

    <!-- Subtitle -->
    <text x="${S / 2}" y="80" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="10" fill="${subtitleColor}" letter-spacing="3">PAYMENT GATEWAY</text>

    <!-- QR white card -->
    <g filter="url(#shadow)">
      <rect x="${cardX}" y="${cardY}" width="${qrCardW}" height="${qrCardW}" rx="14" fill="#FFFFFF"/>
    </g>

    <!-- Corner accents -->
    <path d="M${cardX + 8} ${cardY + 26} L${cardX + 8} ${cardY + 12} Q${cardX + 8} ${cardY + 8} ${cardX + 12} ${cardY + 8} L${cardX + 26} ${cardY + 8}" fill="none" stroke="${themeColor}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M${cardX + qrCardW - 8} ${cardY + 26} L${cardX + qrCardW - 8} ${cardY + 12} Q${cardX + qrCardW - 8} ${cardY + 8} ${cardX + qrCardW - 12} ${cardY + 8} L${cardX + qrCardW - 26} ${cardY + 8}" fill="none" stroke="${themeColor}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M${cardX + 8} ${cardY + qrCardW - 26} L${cardX + 8} ${cardY + qrCardW - 12} Q${cardX + 8} ${cardY + qrCardW - 8} ${cardX + 12} ${cardY + qrCardW - 8} L${cardX + 26} ${cardY + qrCardW - 8}" fill="none" stroke="${themeColor}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M${cardX + qrCardW - 8} ${cardY + qrCardW - 26} L${cardX + qrCardW - 8} ${cardY + qrCardW - 12} Q${cardX + qrCardW - 8} ${cardY + qrCardW - 8} ${cardX + qrCardW - 12} ${cardY + qrCardW - 8} L${cardX + qrCardW - 26} ${cardY + qrCardW - 8}" fill="none" stroke="${themeColor}" stroke-width="2.5" stroke-linecap="round"/>

    <!-- SCAN TO PAY -->
    <text x="${S / 2}" y="${cardBottom + 30}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="15" font-weight="700" fill="${themeColor}" letter-spacing="2.5">SCAN TO PAY</text>

    <!-- Note -->
    <text x="${S / 2}" y="${cardBottom + 52}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="10" fill="${noteColor}">Pastikan nominal sesuai sebelum bayar</text>

    <!-- Bottom gold line -->
    <line x1="35" y1="${S - 28}" x2="${S - 35}" y2="${S - 28}" stroke="${themeColor}" stroke-width="1" opacity="0.35"/>

    <!-- Sparkles -->
    <circle cx="28" cy="28" r="1.5" fill="${themeColor}" opacity="0.5"/>
    <circle cx="${S - 28}" cy="28" r="1" fill="${themeLight}" opacity="0.4"/>
    <circle cx="28" cy="${S - 28}" r="1" fill="${themeLight}" opacity="0.4"/>
    <circle cx="${S - 28}" cy="${S - 28}" r="1.5" fill="${themeColor}" opacity="0.5"/>
  </svg>`;

  const frame = await sharp(Buffer.from(svg)).png().toBuffer();

  return sharp(frame)
    .composite([{ input: resizedQR, top: qrY, left: qrX }])
    .png()
    .toBuffer();
};

module.exports = { generateQRISTwibbon, PRESETS };
