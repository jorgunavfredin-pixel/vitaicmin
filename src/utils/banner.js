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
 * Edit the current navigation message in place.
 * Photo messages use captions; text-only fallback messages use normal text edits.
 */
const editBannerCaption = async (ctx, caption, extra = {}) => {
    const message = ctx.callbackQuery?.message || ctx.message || {};
    const options = { parse_mode: 'HTML', ...extra };
    try {
        if (message.photo || message.caption !== undefined) {
            return await ctx.editMessageCaption(caption, options);
        }
        if (message.text !== undefined) {
            return await ctx.editMessageText(caption, options);
        }
        // Unknown message shape: try caption first for backward compatibility.
        return await ctx.editMessageCaption(caption, options);
    } catch (e) {
        if (/message is not modified/i.test(String(e?.description || e?.message || ''))) return;
        // Last-resort compatibility fallback for non-editable/legacy message types.
        try { await ctx.deleteMessage(); } catch (_) { }
        return replyWithBanner(ctx, caption, extra);
    }
};

// Backward-compat export (some code references BANNER_PATH)
const BANNER_PATH = path.join(ASSETS_DIR, 'banner.png');

module.exports = { replyWithBanner, editBannerCaption, hasBanner, isBannerEnabled, resolveBannerPath, resetBannerCache, BANNER_PATH };
