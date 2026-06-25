export function isPromoActive(promo, now = Date.now()) {
  const nowTs = typeof now === 'number' ? now : new Date(now).getTime();
  if (promo.startDate && nowTs < new Date(promo.startDate).getTime()) return false;
  if (promo.endDate && nowTs > new Date(promo.endDate).getTime()) return false;
  return true;
}

export function deriveHardwareOutcome(answers = {}, catalog = {}) {
  const warnings = [];
  const recommendationIds = new Set();
  const notes = [];
  const usingAdjustable = !!answers.usingAdjustableBase;
  const usingIntegrated = !!answers.usingIntegratedBase;

  if (usingAdjustable && answers.addingHeadboard) {
    recommendationIds.add('headboard-bracket-kit');
    notes.push('Recommended: add a headboard bracket kit for adjustable base setups.');
  }
  if (usingAdjustable && (answers.hasFootboard || answers.hasSideRails)) {
    warnings.push('Compatibility warning: adjustable bases may conflict with footboards or side rails.');
  }
  if (answers.furnitureType === 'third-party') {
    warnings.push('Verify in store: confirm bolt spacing, clearance, and bracket compatibility with third-party furniture.');
  }
  if (!usingAdjustable && !usingIntegrated && !answers.hasExistingFrame && !answers.usingPlatformSlats) {
    recommendationIds.add('integrated-base');
    notes.push('Likely needed: integrated base or integrated base + frame for proper support.');
  }
  if (answers.heightPreference && answers.heightPreference !== 'standard') {
    recommendationIds.add('modular-base-legs');
    notes.push('Recommended: check modular base leg options for height preference.');
  }
  if (answers.missingRetainerBar) recommendationIds.add('retainer-bar');
  if (answers.missingRemote) recommendationIds.add('replacement-remote');
  if (answers.missingPowerCord) recommendationIds.add('replacement-power-cord');

  return {
    recommendations: [...recommendationIds],
    warnings,
    notes
  };
}

function promoQualifies(promo, state) {
  const {
    selectedCategories,
    selectedProductId,
    subtotal
  } = state;

  if (!isPromoActive(promo, state.now)) return false;
  const rules = promo || {};
  if (rules.requiredMinimum && subtotal < rules.requiredMinimum) return false;
  if (rules.requiredProducts?.length && !rules.requiredProducts.includes(selectedProductId)) return false;
  if (rules.requiredCategories?.length && !rules.requiredCategories.every((c) => selectedCategories.has(c))) return false;
  if (rules.excludedCategories?.length && rules.excludedCategories.some((c) => selectedCategories.has(c))) return false;
  if (rules.excludedProducts?.length && rules.excludedProducts.includes(selectedProductId)) return false;
  return true;
}

function promoAmount(promo, subtotal) {
  if (typeof promo.discountAmount === 'number') return Math.max(0, Math.min(subtotal, promo.discountAmount));
  if (typeof promo.discountPercent === 'number') return Math.max(0, Math.min(subtotal, Math.round(subtotal * (promo.discountPercent / 100))));
  return 0;
}

export function calculateQuote(quote, catalog, now = Date.now()) {
  const lines = [];
  const warnings = [];
  const selectedCategories = new Set();
  let subtotal = 0;
  let productSavings = 0;

  const product = catalog.products.find((p) => p.id === quote.productId);
  if (product) {
    selectedCategories.add(product.category);
    const basePrice = Number(product.price ?? product.salePrice ?? product.regularPrice ?? 0);
    const regular = Number(product.regularPrice ?? basePrice);
    if (!Number.isFinite(basePrice) || basePrice <= 0) {
      warnings.push(`Verification required: ${product.name} does not have a verified price.`);
    }
    lines.push({ label: product.name, amount: Math.max(0, basePrice) });
    subtotal += Math.max(0, basePrice);
    productSavings += Math.max(0, regular - basePrice);
    if (product.warnings?.length) warnings.push(...product.warnings);
  }

  const addFromBucket = (bucket, field) => {
    const entries = Object.entries(quote[field] || {});
    for (const [id, qty] of entries) {
      const item = bucket.find((x) => x.id === id);
      if (!item || !qty) continue;
      selectedCategories.add(item.category);
      const amount = Number(item.price || 0) * qty;
      lines.push({ label: `${item.name} × ${qty}`, amount });
      subtotal += amount;
      if (item.warnings?.length) warnings.push(...item.warnings);
    }
  };

  const base = catalog.options.bases.find((b) => b.id === quote.baseId);
  if (base && base.id !== 'none') {
    selectedCategories.add(base.category);
    lines.push({ label: base.name, amount: Number(base.price || 0) });
    subtotal += Number(base.price || 0);
  }

  const plan = catalog.protectionPlans.find((p) => p.id === quote.planId);
  if (plan && plan.id !== 'none') {
    selectedCategories.add('protection-plan');
    lines.push({ label: plan.name, amount: Number(plan.price || 0) });
    subtotal += Number(plan.price || 0);
  }

  addFromBucket(catalog.options.furniture, 'furniture');
  addFromBucket(catalog.options.hardware, 'hardware');
  addFromBucket(catalog.options.bedding, 'bedding');
  addFromBucket(catalog.options.pillows, 'pillows');

  const autoPromos = [];
  const togglePromos = [];
  const blockedPromos = [];
  const promoWarnings = [];
  let hasNonStackableApplied = false;

  const promoState = { selectedCategories, selectedProductId: quote.productId, subtotal, now };

  for (const promo of catalog.promotions) {
    if (!promoQualifies(promo, promoState)) continue;
    if (promo.verificationRequired && promo.type === 'automatic') {
      blockedPromos.push({ ...promo, reason: 'Verification required' });
      continue;
    }
    if (hasNonStackableApplied && promo.stackable === false) {
      blockedPromos.push({ ...promo, reason: 'Not stackable with another applied promo' });
      continue;
    }
    if (promo.stackable == null) promoWarnings.push(`Verify stackability for promo: ${promo.name}.`);

    const resolved = { ...promo, amount: promoAmount(promo, subtotal) };
    if (!resolved.amount) continue;

    if (promo.type === 'automatic') autoPromos.push(resolved);
    if ((promo.type === 'toggle' || promo.type === 'manual') && quote.toggles?.[promo.id]) togglePromos.push(resolved);
    if (promo.stackable === false && (promo.type === 'automatic' || quote.toggles?.[promo.id])) hasNonStackableApplied = true;
  }

  const promoDiscount = [...autoPromos, ...togglePromos].reduce((sum, p) => sum + p.amount, 0);
  const customDiscount = Math.max(0, Number(quote.customDiscount || 0));
  const taxable = Math.max(0, subtotal - promoDiscount - customDiscount);
  const tax = taxable * (Math.max(0, Number(quote.taxRate || 0)) / 100);
  const total = Math.max(0, taxable + tax);

  if (customDiscount) lines.push({ label: 'Manager/price-match adjustment', amount: -customDiscount });
  if (tax) lines.push({ label: 'Estimated tax', amount: tax });

  warnings.push(...promoWarnings);

  return {
    lines,
    subtotal,
    savings: productSavings + promoDiscount + customDiscount,
    total,
    automaticPromos: autoPromos,
    togglePromos,
    blockedPromos,
    warnings
  };
}

export function validateCatalogShape(catalog) {
  const requiredTopLevel = [
    'metadata', 'sources', 'sourceHealth', 'products', 'categories', 'options',
    'promotions', 'promoRules', 'compatibilityRules', 'hardwareRules', 'warnings',
    'financing', 'delivery', 'protectionPlans'
  ];
  for (const key of requiredTopLevel) {
    if (!(key in catalog)) throw new Error(`Catalog missing required key: ${key}`);
  }
  if (!Array.isArray(catalog.products) || !Array.isArray(catalog.promotions)) {
    throw new Error('Catalog requires products and promotions arrays.');
  }
  for (const p of catalog.products) {
    for (const field of ['id', 'name', 'category', 'sourceUrls']) {
      if (!p[field] || (Array.isArray(p[field]) && !p[field].length)) {
        throw new Error(`Product ${p.id || 'unknown'} missing field ${field}`);
      }
    }
    if (Number.isNaN(Number(p.price ?? p.salePrice ?? 0))) {
      throw new Error(`Product ${p.id} has NaN price`);
    }
  }
}
