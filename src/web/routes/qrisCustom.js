const express = require('express');
const fs = require('fs');
const qrisCustom = require('../../services/qrisCustom');
const gateway = require('../../payments/gateway');

const registerQrisCustomRoutes = (router) => {
  const r = express.Router();

  r.get('/', (req, res) => {
    try {
      const presets = qrisCustom.listPresets().map(p => ({ ...p, image_url: `/api/admin/qris-custom/preset/${encodeURIComponent(p.id)}` }));
      res.json({ config: qrisCustom.getConfig(), presets, defaults: qrisCustom.DEFAULT_LAYOUT, preset_dir: qrisCustom.PRESET_DIR });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  r.get('/preset/:id', (req, res) => {
    const file = qrisCustom.getTemplatePath('preset', req.params.id);
    if (!file) return res.status(404).end();
    res.sendFile(file);
  });

  r.get('/custom', (req, res) => {
    if (!fs.existsSync(qrisCustom.CUSTOM_FILE)) return res.status(404).end();
    res.sendFile(qrisCustom.CUSTOM_FILE);
  });

  r.post('/upload', async (req, res) => {
    try {
      const meta = await qrisCustom.saveCustomTemplate(req.body?.image);
      res.json({ ok: true, message: 'Twibbon custom berhasil diupload', meta, image_url: `/api/admin/qris-custom/custom?v=${Date.now()}` });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });

  r.post('/preview', async (req, res) => {
    try {
      const source = req.body?.source === 'custom' ? 'custom' : 'preset';
      const file = qrisCustom.getTemplatePath(source, req.body?.preset_id);
      if (!file) return res.status(400).json({ error: 'Template tidak ditemukan' });
      const qr = await gateway.generateQRImageBuffer('QRIS-PREVIEW-VITAICMIN', 600);
      const output = await qrisCustom.renderWithTemplate(file, qr, req.body?.layout);
      res.type('png').send(output);
    } catch (error) { res.status(400).json({ error: error.message }); }
  });

  r.put('/', (req, res) => {
    try {
      const config = qrisCustom.saveConfig(req.body || {});
      res.json({ ok: true, message: 'Konfigurasi QRIS Custom disimpan', config });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });

  router.use('/qris-custom', r);
};

module.exports = { registerQrisCustomRoutes };
