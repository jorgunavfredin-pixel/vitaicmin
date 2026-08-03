const { Markup } = require('telegraf');
const db = require('../models/db');
const gate = require('../services/accessGate');
const { escapeHtml } = require('../utils/helpers');

const editOrReply = async (ctx, text, keyboard) => {
  const options = { parse_mode: 'HTML', ...keyboard, disable_web_page_preview: true };
  if (ctx.callbackQuery) {
    try { return await ctx.editMessageText(text, options); } catch (_) { }
  }
  return ctx.reply(text, options);
};

const showJoinGate = async (ctx, result) => {
  const rows = [];
  for (const [i, item] of (result.targets || []).entries()) {
    const label = i === 0 && process.env.REQUIRED_CHANNEL_ID === item.id ? '▣ Gabung Channel' : '♟ Gabung Group';
    rows.push([Markup.button.url(label, item.url)]);
  }
  rows.push([Markup.button.callback('↻ Cek Akses', 'gate_check_join')]);
  const text = result.configError
    ? '<blockquote>⚠️ <b>Akses Store Belum Tersedia</b></blockquote>\n\nKonfigurasi channel/group bermasalah. Hubungi admin store.'
    : '<blockquote>🔒 <b>Akses Store</b></blockquote>\n\nBergabunglah ke channel/group yang tersedia, lalu tekan <b>Cek Akses</b>.';
  await editOrReply(ctx, text, Markup.inlineKeyboard(rows));
};

const notifyApproval = async (ctx, request) => {
  const name = escapeHtml(ctx.from.first_name || '-');
  const username = ctx.from.username ? `@${escapeHtml(ctx.from.username)}` : '-';
  const text = `<blockquote>🔐 <b>Permintaan Akses Baru</b></blockquote>\n\nUser: <b>${name}</b>\nUsername: ${username}\nTelegram ID: <code>${ctx.from.id}</code>`;
  const keyboard = Markup.inlineKeyboard([[Markup.button.callback('✓ Setujui', `gate_approve_${request.user_id}`), Markup.button.callback('× Tolak', `gate_reject_${request.user_id}`)]]);
  for (const adminId of String(process.env.ADMIN_ID || '').split(',').map(x => x.trim()).filter(Boolean)) {
    await ctx.telegram.sendMessage(adminId, text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
  }
};

const showApprovalGate = async (ctx, result) => {
  const previous = db.getAccessRequest(ctx.from.id);
  if (!previous || previous.status === 'rejected') {
    const request = db.requestAccess(ctx.from);
    await notifyApproval(ctx, request);
  }
  const text = '<blockquote>⏳ <b>Menunggu Persetujuan</b></blockquote>\n\nPermintaan aksesmu sudah dikirim ke admin. Tekan <b>Cek Status</b> setelah disetujui.';
  await editOrReply(ctx, text, Markup.inlineKeyboard([[Markup.button.callback('↻ Cek Status', 'gate_check_approval')]]));
};

const showGate = async (ctx, result) => result.mode === 'join' ? showJoinGate(ctx, result) : showApprovalGate(ctx, result);

const accessGateMiddleware = async (ctx, next) => {
  if (!ctx.from || ctx.chat?.type !== 'private') return next();
  const callback = String(ctx.callbackQuery?.data || '');
  if (/^gate_(check_join|check_approval|approve_|reject_)/.test(callback)) return next();
  const result = await gate.checkAccess({ telegram: ctx.telegram, user: ctx.from });
  if (result.allowed) return next();
  await showGate(ctx, result);
};

const registerAccessGateHandlers = bot => {
  bot.action('gate_check_join', async ctx => {
    gate.clearMembershipCache(ctx.from.id);
    const result = await gate.checkAccess({ telegram: ctx.telegram, user: ctx.from, force: true });
    await ctx.answerCbQuery(result.allowed ? '✓ Akses diberikan' : 'Belum memenuhi syarat');
    if (result.allowed) {
      await ctx.deleteMessage().catch(() => {});
      return ctx.reply('✓ Akses diberikan. Kirim /start untuk membuka store.');
    }
    await showJoinGate(ctx, result);
  });
  bot.action('gate_check_approval', async ctx => {
    const result = await gate.checkAccess({ telegram: ctx.telegram, user: ctx.from, force: true });
    await ctx.answerCbQuery(result.allowed ? '✓ Akses diberikan' : 'Masih menunggu admin');
    if (result.allowed) {
      await ctx.deleteMessage().catch(() => {});
      return ctx.reply('✓ Akses diberikan. Kirim /start untuk membuka store.');
    }
    await showApprovalGate(ctx, result);
  });
  bot.action(/^gate_(approve|reject)_(.+)$/, async ctx => {
    const adminIds = String(process.env.ADMIN_ID || '').split(',').map(x => x.trim());
    if (!adminIds.includes(String(ctx.from.id))) return ctx.answerCbQuery('Tidak diizinkan', { show_alert: true });
    const status = ctx.match[1] === 'approve' ? 'approved' : 'rejected';
    const request = db.decideAccess(ctx.match[2], status, ctx.from.id);
    await ctx.answerCbQuery(request ? (status === 'approved' ? '✓ Disetujui' : '× Ditolak') : 'Request tidak ditemukan');
    if (request) await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    if (request) await ctx.telegram.sendMessage(request.user_id, status === 'approved' ? '✓ Akses store kamu sudah disetujui. Kirim /start untuk membuka store.' : '× Permintaan akses store kamu ditolak.').catch(() => {});
  });
};

module.exports = { accessGateMiddleware, registerAccessGateHandlers, showGate };
