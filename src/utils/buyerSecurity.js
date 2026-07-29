const db = require('../models/db');

const isPrivateChat = (ctx) => ctx?.chat?.type === 'private';

const isOwnedOrder = (order, ctx, options = {}) => {
  if (!order || !ctx?.from?.id) return false;
  if (String(order.user_id) !== String(ctx.from.id)) return false;
  if (options.productId !== undefined && order.product_id !== options.productId) return false;
  if (Array.isArray(options.statuses) && options.statuses.length && !options.statuses.includes(order.status)) return false;
  return true;
};

const getOwnedOrder = (ctx, orderId, options = {}) => {
  const order = db.getOrderById(orderId);
  return isOwnedOrder(order, ctx, options) ? order : null;
};

const rejectOrderAccess = async (ctx, lang = 'id') => {
  const message = lang === 'en'
    ? '❌ Order not found or no longer available.'
    : '❌ Order tidak ditemukan atau sudah tidak tersedia.';
  try {
    if (ctx.callbackQuery) await ctx.answerCbQuery(message, { show_alert: true });
    else await ctx.reply(message);
  } catch (_) { }
};

const privateChatOnly = async (ctx, next) => {
  if (!ctx.chat || isPrivateChat(ctx)) return next();
  const message = '🔒 Demi keamanan transaksi, gunakan bot melalui chat pribadi.';
  try {
    if (ctx.callbackQuery) await ctx.answerCbQuery(message, { show_alert: true });
    else await ctx.reply(message);
  } catch (_) { }
};

module.exports = { isPrivateChat, isOwnedOrder, getOwnedOrder, rejectOrderAccess, privateChatOnly };
