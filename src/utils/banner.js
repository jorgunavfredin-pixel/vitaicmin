const path = require('path');
const fs = require('fs');
const db = require('../models/db');

const ASSETS_DIR = path.join(__dirname, '../../assets');
// Accepted banner image formats, in priority order (first match wins)
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

let cachedFileId = null;

/**
 * Find a banner image in assets/ named "banner.<ext>" for any supported format.
 * Returns the file path, or null if no banner image exists.
 */
const resolveBannerPath = () => {
    try {
        for (const ext of IMAGE_EXTS) {
            const p = path.join(ASSETS_DIR, `banner${ext}`);
            if (fs.existsSync(p)) return p;
        }
    } catch (e) { /* ignore */ }
    return null;
};

/**
 * Whether a banner image is available.
 */
const hasBanner = () => resolveBannerPath() !== null;
const isBannerEnabled = () => db.getConfig('banner_enabled', null, true) !== false;
const resetBannerCache = () => { cachedFileId = null; };

/**
 * Get banner source - cached file_id after first upload, else {source: path}, else null.
 */
const getBannerSource = () => {
    if (!isBannerEnabled()) return null;
    if (cachedFileId) return cachedFileId;
    const p = resolveBannerPath();
    return p ? { source: p } : null;
};

/**
 * Send photo with banner, caching file_id for speed.
 * If no banner image exists, falls back to a plain text message so menus still work.
 * @param {Object} ctx - Telegraf context
 * @param {string} caption - Message text
 * @param {Object} extra - Extra options (parse_mode, reply_markup, etc)
 */
const replyWithBanner = async (ctx, caption, extra = {}) => {
    const source = getBannerSource();

    // No banner asset — show text only so the menu still appears
    if (!source) {
        return ctx.reply(caption, { parse_mode: 'HTML', ...extra });
    }

    const sent = await ctx.replyWithPhoto(source, {
        caption,
        parse_mode: 'HTML',
        ...extra
    });
    // Cache file_id after first upload
    if (!cachedFileId && sent.photo && sent.photo.length > 0) {
        cachedFileId = sent.photo[sent.photo.length - 1].file_id;
    }
    return sent;
};

/**
 * Edit existing photo message caption (banner stays, text changes).
 * Falls back to delete + resend (photo or text) if current message is not a photo.
 */
const editBannerCaption = async (ctx, caption, extra = {}) => {
    try {
        await ctx.editMessageCaption(caption, {
            parse_mode: 'HTML',
            ...extra
        });
    } catch (e) {
        // Fallback: current message is text, not a photo
        try { await ctx.deleteMessage(); } catch (e2) { }
        await replyWithBanner(ctx, caption, extra);
    }
};

// Backward-compat export (some code references BANNER_PATH)
const BANNER_PATH = path.join(ASSETS_DIR, 'banner.png');

module.exports = { replyWithBanner, editBannerCaption, hasBanner, isBannerEnabled, resolveBannerPath, resetBannerCache, BANNER_PATH };
