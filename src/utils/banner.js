const path = require('path');

const BANNER_PATH = path.join(__dirname, '../../assets/banner.png');
let cachedFileId = null;

/**
 * Get banner source - uses cached file_id after first upload for instant display
 * @returns {string|Object} file_id string or {source: path} for first upload
 */
const getBannerSource = () => {
    return cachedFileId || { source: BANNER_PATH };
};

/**
 * Send photo with banner, caching file_id for speed
 * @param {Object} ctx - Telegraf context
 * @param {string} caption - Message text
 * @param {Object} extra - Extra options (parse_mode, reply_markup, etc)
 */
const replyWithBanner = async (ctx, caption, extra = {}) => {
    const sent = await ctx.replyWithPhoto(getBannerSource(), {
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
 * Edit existing photo message caption (banner stays, text changes)
 * Falls back to delete+replyWithPhoto if current message is not a photo
 */
const editBannerCaption = async (ctx, caption, extra = {}) => {
    try {
        await ctx.editMessageCaption(caption, {
            parse_mode: 'HTML',
            ...extra
        });
    } catch (e) {
        // Fallback: current message is text, not photo
        try { await ctx.deleteMessage(); } catch (e2) { }
        await replyWithBanner(ctx, caption, extra);
    }
};

module.exports = { replyWithBanner, editBannerCaption, BANNER_PATH };
