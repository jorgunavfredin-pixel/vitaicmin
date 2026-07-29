const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const db = require('../models/db');

const ROOT = path.join(__dirname, '../../assets/qris-custom');
const PRESET_DIR = path.join(ROOT, 'presets');
const CUSTOM_FILE = path.join(ROOT, 'custom.png');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const DEFAULT_LAYOUT = Object.freeze({ x: 23.4375, y: 23.4375, size: 53.125 });
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const ensureDirs = () => fs.mkdirSync(PRESET_DIR, { recursive: true });
const safeId = (value) => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n)));

const normalizeLayout = (layout = {}) => {
  const size = clamp(Number(layout.size) || DEFAULT_LAYOUT.size, 10, 90);
  const max = 100 - size;
  return {
    x: clamp(Number.isFinite(Number(layout.x)) ? Number(layout.x) : DEFAULT_LAYOUT.x, 0, max),
    y: clamp(Number.isFinite(Number(layout.y)) ? Number(layout.y) : DEFAULT_LAYOUT.y, 0, max),
    size
  };
};

const listPresets = () => {
  ensureDirs();
  return fs.readdirSync(PRESET_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
    .map(e => {
      const rawId = path.basename(e.name, path.extname(e.name));
      const id = safeId(rawId);
      if (!id) return null;
      let meta = {};
      const jsonPath = path.join(PRESET_DIR, `${rawId}.json`);
      try { if (fs.existsSync(jsonPath)) meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (_) { }
      return {
        id,
        name: String(meta.name || id.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())),
        file: e.name,
        layout: normalizeLayout(meta.layout || meta)
      };
    }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
};

const getConfig = () => {
  let saved = db.getConfig('qris_custom_config', null, null) || null;
  if (!saved && fs.existsSync(CONFIG_FILE)) {
    try { saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) { saved = null; }
  }
  saved = saved || {};
  const presets = listPresets();
  const customExists = fs.existsSync(CUSTOM_FILE);
  let source = saved.source || (presets[0] ? 'preset' : 'custom');
  let presetId = saved.preset_id || presets[0]?.id || null;
  if (source === 'preset' && !presets.some(p => p.id === presetId)) presetId = presets[0]?.id || null;
  if (source === 'custom' && !customExists && presets[0]) { source = 'preset'; presetId = presets[0].id; }
  return {
    enabled: saved.enabled !== false,
    source,
    preset_id: presetId,
    layout: normalizeLayout(saved.layout),
    custom_exists: customExists,
    updated_at: saved.updated_at || null
  };
};

const getTemplatePath = (source, presetId) => {
  ensureDirs();
  if (source === 'custom') return fs.existsSync(CUSTOM_FILE) ? CUSTOM_FILE : null;
  const wanted = safeId(presetId);
  const preset = listPresets().find(p => p.id === wanted);
  return preset ? path.join(PRESET_DIR, preset.file) : null;
};

const resolveActiveTemplate = () => {
  const config = getConfig();
  if (!config.enabled) return null;
  const templatePath = getTemplatePath(config.source, config.preset_id);
  return templatePath ? { templatePath, config } : null;
};

const decodeDataUrl = (value) => {
  const match = String(value || '').match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('Format gambar tidak valid');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw new Error('Ukuran gambar maksimal 5 MB');
  return buffer;
};

const saveCustomTemplate = async (dataUrl) => {
  ensureDirs();
  const buffer = decodeDataUrl(dataUrl);
  const image = sharp(buffer, { limitInputPixels: 20_000_000 }).rotate();
  const meta = await image.metadata();
  if (!meta.width || !meta.height || meta.width < 300 || meta.height < 300) throw new Error('Resolusi minimal 300×300 px');
  if (meta.width > 4096 || meta.height > 4096) throw new Error('Resolusi maksimal 4096×4096 px');
  await image.png().toFile(CUSTOM_FILE);
  return { width: meta.width, height: meta.height };
};

const saveConfig = (input = {}) => {
  const source = input.source === 'custom' ? 'custom' : 'preset';
  const presetId = source === 'preset' ? safeId(input.preset_id) : null;
  const templatePath = getTemplatePath(source, presetId);
  if (!templatePath) throw new Error(source === 'custom' ? 'Twibbon custom belum diupload' : 'Tema bawaan tidak ditemukan');
  const config = {
    enabled: input.enabled !== false,
    source,
    preset_id: presetId,
    layout: normalizeLayout(input.layout),
    updated_at: new Date().toISOString()
  };
  db.updateSettings({ qris_custom_config: config });
  ensureDirs();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  return { ...config, custom_exists: fs.existsSync(CUSTOM_FILE) };
};

const fetchImageBuffer = async (source) => {
  if (Buffer.isBuffer(source)) return source;
  const response = await axios.get(String(source), { responseType: 'arraybuffer', timeout: 12_000, maxContentLength: 5 * 1024 * 1024 });
  return Buffer.from(response.data);
};

const renderWithTemplate = async (templatePath, qrSource, layout) => {
  const template = sharp(templatePath).rotate();
  const meta = await template.metadata();
  if (!meta.width || !meta.height) throw new Error('Template tidak valid');
  const pos = normalizeLayout(layout);
  const box = Math.max(64, Math.min(meta.width, meta.height, Math.round(meta.width * pos.size / 100)));
  const left = Math.max(0, Math.min(meta.width - box, Math.round(meta.width * pos.x / 100)));
  const top = Math.max(0, Math.min(meta.height - box, Math.round(meta.width * pos.y / 100)));
  const qrInput = await fetchImageBuffer(qrSource);
  const qr = await sharp(qrInput).resize(box, box, { fit: 'contain', kernel: sharp.kernel.nearest, background: '#ffffff' }).png().toBuffer();
  const white = await sharp({ create: { width: box, height: box, channels: 4, background: '#ffffff' } }).png().toBuffer();
  return template.composite([{ input: white, left, top }, { input: qr, left, top }]).png().toBuffer();
};

const renderActive = async (qrSource) => {
  const active = resolveActiveTemplate();
  if (!active) return null;
  return renderWithTemplate(active.templatePath, qrSource, active.config.layout);
};

const getPlainQR = async (paymentData = {}) => {
  if (paymentData.qris_string) {
    const QRCode = require('qrcode');
    return QRCode.toBuffer(String(paymentData.qris_string), {
      type: 'png', width: 600, margin: 0, errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' }
    });
  }
  if (paymentData.qr_image) return fetchImageBuffer(paymentData.qr_image);
  throw new Error('Data QRIS tidak tersedia');
};

const renderPaymentImage = async (paymentData = {}) => {
  const plainQR = await getPlainQR(paymentData);
  const custom = await renderActive(plainQR);
  return { buffer: custom || plainQR, custom: !!custom, plainQR };
};

module.exports = {
  ROOT, PRESET_DIR, CUSTOM_FILE, CONFIG_FILE, DEFAULT_LAYOUT,
  normalizeLayout, listPresets, getConfig, getTemplatePath, resolveActiveTemplate,
  saveCustomTemplate, saveConfig, renderWithTemplate, renderActive, getPlainQR, renderPaymentImage
};
