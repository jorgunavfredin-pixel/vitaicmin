const db = require('../models/db');

const CACHE_TTL_MS = 60_000;
const membershipCache = new Map();

const mode = () => {
  const value = String(process.env.ACCESS_GATE_MODE || '').trim().toLowerCase();
  return ['join', 'approval'].includes(value) ? value : 'off';
};

const admins = () => new Set(String(process.env.ADMIN_ID || '').split(',').map(x => x.trim()).filter(Boolean));
const target = (kind) => ({
  id: String(process.env[`REQUIRED_${kind}_ID`] || '').trim(),
  url: String(process.env[`REQUIRED_${kind}_URL`] || '').trim()
});
const getJoinConfig = () => {
  const configured = [target('CHANNEL'), target('GROUP')];
  const invalid = configured.some(x => Boolean(x.id) !== Boolean(x.url));
  return { targets: configured.filter(x => x.id && x.url), invalid };
};
const joinTargets = () => getJoinConfig().targets;

const isJoined = member => !['left', 'kicked'].includes(member?.status);
const checkJoin = async (telegram, userId, force = false) => {
  const config = getJoinConfig();
  const targets = config.targets;
  if (config.invalid || !targets.length) return { allowed: false, configError: true, targets };
  const key = String(userId);
  const cached = membershipCache.get(key);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return { ...cached.result, cached: true };
  const checks = [];
  for (const item of targets) {
    try { checks.push({ ...item, joined: isJoined(await telegram.getChatMember(item.id, userId)) }); }
    catch (_) { return { allowed: false, configError: true, targets }; }
  }
  const result = { allowed: checks.every(x => x.joined), targets: checks };
  membershipCache.set(key, { at: Date.now(), result });
  return result;
};

const checkAccess = async ({ telegram, user, force = false }) => {
  const userId = String(user.id);
  const gateMode = mode();
  if (gateMode === 'off' || admins().has(userId)) return { allowed: true, mode: gateMode };
  if (gateMode === 'join') return { mode: gateMode, ...(await checkJoin(telegram, userId, force)) };
  const request = db.getAccessRequest(userId);
  return { allowed: request?.status === 'approved', mode: gateMode, status: request?.status || 'new', request };
};

const clearMembershipCache = userId => membershipCache.delete(String(userId));
module.exports = { mode, joinTargets, checkAccess, clearMembershipCache };
