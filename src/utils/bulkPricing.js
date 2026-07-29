const normalizeBulkTiers = (raw, basePrice = 0) => {
  let tiers = raw;
  if (typeof raw === 'string') {
    try { tiers = JSON.parse(raw || '[]'); } catch (_) { tiers = []; }
  }
  if (!Array.isArray(tiers)) return [];

  return tiers.map(t => {
    const minQty = Number.parseInt(t.min_qty, 10);
    const inferredType = t.type || (t.price != null ? 'fixed_price' : 'percent');
    if (!Number.isInteger(minQty) || minQty < 2) return null;
    if (inferredType === 'fixed_price') {
      const price = Number.parseInt(t.price ?? t.value, 10);
      if (!Number.isInteger(price) || price <= 0 || (basePrice > 0 && price >= basePrice)) return null;
      return { min_qty: minQty, type: 'fixed_price', price };
    }
    const percent = Number.parseInt(t.percent ?? t.value, 10);
    if (!Number.isInteger(percent) || percent <= 0 || percent >= 100) return null;
    return { min_qty: minQty, type: 'percent', percent };
  }).filter(Boolean).sort((a, b) => a.min_qty - b.min_qty);
};

const calculateBulkPrice = (baseUnitPrice, quantity, rawTiers, disabled = false) => {
  const base = Math.max(0, Number.parseInt(baseUnitPrice, 10) || 0);
  const qty = Math.max(1, Number.parseInt(quantity, 10) || 1);
  const tiers = disabled ? [] : normalizeBulkTiers(rawTiers, base);
  const matchedTier = [...tiers].reverse().find(t => qty >= t.min_qty) || null;
  const subtotal = base * qty;
  let unitPrice = base;
  let total = subtotal;
  if (matchedTier?.type === 'fixed_price') {
    unitPrice = matchedTier.price;
    total = unitPrice * qty;
  }
  if (matchedTier?.type === 'percent') {
    // Preserve legacy behaviour: percentage is calculated on the subtotal once.
    const discount = Math.floor(subtotal * matchedTier.percent / 100);
    total = subtotal - discount;
    unitPrice = Math.floor(total / qty);
  }
  return { base_unit_price: base, unit_price: unitPrice, quantity: qty, subtotal, total, discount_amount: subtotal - total, tier: matchedTier, tiers };
};

module.exports = { normalizeBulkTiers, calculateBulkPrice };
