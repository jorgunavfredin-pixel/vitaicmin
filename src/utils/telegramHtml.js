const escapeAttr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ALLOWED = new Set(['b','strong','i','em','u','ins','s','strike','del','code','pre','blockquote','a','tg-spoiler','tg-emoji']);
const safeUrl = (value) => {
  try {
    const url = new URL(String(value));
    return ['http:','https:','tg:'].includes(url.protocol) ? url.href : null;
  } catch (_) { return null; }
};
const attr = (raw, name) => {
  const m = String(raw).match(new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return m ? m[2] : null;
};

const sanitizeTelegramHtml = (html) => String(html || '').replace(/<\/?[a-z][^>]*>/gi, token => {
  const m = token.match(/^<(\/)?([a-z-]+)([^>]*)>$/i);
  if (!m) return '';
  const closing = !!m[1], tag = m[2].toLowerCase(), raw = m[3] || '';
  if (!ALLOWED.has(tag)) return '';
  if (closing) return `</${tag}>`;
  if (tag === 'a') {
    const href = safeUrl(attr(raw, 'href'));
    return href ? `<a href="${escapeAttr(href)}">` : '';
  }
  if (tag === 'tg-emoji') {
    const id = attr(raw, 'emoji-id');
    return id && /^\d+$/.test(id) ? `<tg-emoji emoji-id="${id}">` : '';
  }
  if (tag === 'blockquote') return /\bexpandable\b/i.test(raw) ? '<blockquote expandable>' : '<blockquote>';
  if (tag === 'code') {
    const cls = attr(raw, 'class');
    return cls && /^language-[a-z0-9_+-]+$/i.test(cls) ? `<code class="${cls}">` : '<code>';
  }
  return `<${tag}>`;
});

module.exports = { sanitizeTelegramHtml, safeUrl };
