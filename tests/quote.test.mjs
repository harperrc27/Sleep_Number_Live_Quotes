/**
 * Sleep Number Quote Studio — Unit Tests
 *
 * Run with: node --experimental-vm-modules tests/quote.test.mjs
 * Or:       node tests/quote.test.mjs   (uses built-in assert)
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root      = path.join(__dirname, '..');

// ── Load catalog for integration-style tests ──────────────────────────────────
const catalog = JSON.parse(readFileSync(path.join(root, 'data', 'catalog.json'), 'utf8'));

// ── Inline the pure functions under test ─────────────────────────────────────
// (Mirrors the logic in app.js without requiring a DOM)

const money = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(v || 0));

function addonByIdCat(id, cat) { return cat?.addons?.find(a => a.id === id); }
function minPrice(pricingObj)   { if (!pricingObj) return 0; const vals = Object.values(pricingObj).filter(v => v > 0); return vals.length ? Math.min(...vals) : 0; }

function selectedCategorySetFor(q, cat) {
  const set = new Set();
  if (q.productId) set.add('mattress');
  const base = addonByIdCat(q.baseId, cat); if (base) set.add(base.category);
  const plan = addonByIdCat(q.planId, cat); if (plan) set.add(plan.category);
  for (const bucket of ['furniture', 'hardware', 'bedding'])
    Object.keys(q[bucket] || {}).forEach(id => { const item = addonByIdCat(id, cat); if (item) set.add(item.category); });
  return set;
}

function promoQualifies(promo, q, cats, subtotal) {
  const rules = promo.conditions || {};
  if (rules.minimumSubtotal && subtotal < rules.minimumSubtotal) return false;
  if (rules.requiresProduct && !q.productId) return false;
  if (rules.requiresCategories && !rules.requiresCategories.every(c => cats.has(c))) return false;
  return true;
}

function resolvePromo(promo, subtotal) {
  const amt = promo.discountAmount
    ? promo.discountAmount
    : Math.round(subtotal * ((promo.discountPercent || 0) / 100));
  return { ...promo, amount: Math.min(amt, subtotal) };
}

function getAppliedPromosFor(q, cat, subtotal) {
  if (!cat) return { automatic: [], toggles: [] };
  const cats = selectedCategorySetFor(q, cat);
  const automatic = [], toggles = [];
  for (const promo of (cat.promos || [])) {
    if (promo.type === 'automatic' && promoQualifies(promo, q, cats, subtotal))
      automatic.push(resolvePromo(promo, subtotal));
    if (promo.type === 'toggle' && q.toggles?.[promo.id])
      toggles.push(resolvePromo(promo, subtotal));
  }
  return { automatic, toggles };
}

function calculateQuote(q, cat) {
  if (!cat) return { lines: [], subtotal: 0, savings: 0, total: 0, automaticPromos: [], togglePromos: [] };
  const lines = []; let subtotal = 0; let savings = 0;

  const product = cat.products?.find(p => p.id === q.productId);
  if (product && q.size) {
    const saleP   = product.pricing?.[q.size];
    const retailP = product.retailPricing?.[q.size];
    if (saleP) {
      lines.push({ label: `${product.name} (${q.size})`, amount: saleP });
      subtotal += saleP;
      if (retailP && retailP > saleP) savings += retailP - saleP;
    }
  }

  const base = addonByIdCat(q.baseId, cat);
  if (base && base.id !== 'none' && base.price) {
    lines.push({ label: base.name, amount: base.price });
    subtotal += base.price;
  }

  for (const bucket of ['furniture', 'hardware', 'bedding']) {
    Object.entries(q[bucket] || {}).forEach(([id, qty]) => {
      const item = addonByIdCat(id, cat);
      if (item && qty && item.price) {
        lines.push({ label: `${item.name} × ${qty}`, amount: item.price * qty });
        subtotal += item.price * qty;
      }
    });
  }

  const plan = addonByIdCat(q.planId, cat);
  if (plan && plan.id !== 'none' && plan.price) {
    lines.push({ label: plan.name, amount: plan.price });
    subtotal += plan.price;
  }

  const { automatic, toggles } = getAppliedPromosFor(q, cat, subtotal);
  const promoDisc = [...automatic, ...toggles].reduce((s, p) => s + p.amount, 0);
  const customDisc = Number(q.customDiscount || 0);
  if (customDisc > 0) lines.push({ label: 'Approved discount', amount: -customDisc });

  const taxRate = Number(q.taxRate || 0) / 100;
  const taxable = Math.max(0, subtotal - promoDisc - customDisc);
  const tax     = Math.round(taxable * taxRate);
  if (tax > 0) lines.push({ label: 'Estimated tax', amount: tax });

  const total = Math.max(0, taxable + tax);
  return { lines, subtotal, savings: savings + promoDisc + customDisc, total, automaticPromos: automatic, togglePromos: toggles };
}

function getHardwareRecommendations(q, cat) {
  if (!cat) return [];
  const hw      = q.hw || {};
  const base    = addonByIdCat(q.baseId, cat);
  const noBase  = !q.baseId || q.baseId === 'none';
  const sz      = q.size || '';
  const recs    = [];
  const rules   = cat.hardwareRules || [];

  for (const rule of rules) {
    const c = rule.conditions || {};
    let match = true;
    if (c.baseCategories) { const bc = base?.category; if (!c.baseCategories.includes(bc)) match = false; }
    if (c.hasHeadboard !== undefined && hw.hasHeadboard !== (c.hasHeadboard ? 'yes' : 'no')) match = false;
    if (c.headboardType !== undefined && hw.headboardType !== c.headboardType) match = false;
    if (c.hasFootboard  !== undefined && hw.hasFootboard  !== (c.hasFootboard  ? 'yes' : 'no')) match = false;
    if (c.noBase && !noBase) match = false;
    if (c.isPlatformBed !== undefined && hw.isPlatformBed !== (c.isPlatformBed ? 'yes' : 'no')) match = false;
    if (c.heightConcern !== undefined && hw.heightConcern !== c.heightConcern) match = false;
    if (c.sizes && !c.sizes.includes(sz)) match = false;
    if (match) recs.push({ ...rule });
  }
  return recs;
}

// ── Test helpers ──────────────────────────────────────────────────────────────
let pass = 0; let fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); fail++; }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Catalog schema validation
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1. Catalog schema');
test('catalog has required fields', () => {
  assert.ok(Array.isArray(catalog.products), 'products must be an array');
  assert.ok(Array.isArray(catalog.addons),   'addons must be an array');
  assert.ok(Array.isArray(catalog.promos),   'promos must be an array');
  assert.ok(catalog.schemaVersion >= 2,       'schemaVersion must be >= 2');
});
test('catalog has at least 1 mattress product', () => {
  const mattresses = catalog.products.filter(p => p.category === 'mattress');
  assert.ok(mattresses.length >= 1, `expected >= 1 mattress, got ${mattresses.length}`);
});
test('no product has NaN price', () => {
  for (const p of catalog.products) {
    if (p.pricing) {
      for (const [size, price] of Object.entries(p.pricing)) {
        assert.ok(!isNaN(price) && price > 0, `NaN/zero price in ${p.id} size ${size}: ${price}`);
      }
    }
  }
});
test('every product has an id', () => {
  for (const p of catalog.products) {
    assert.ok(p.id, `product missing id: ${JSON.stringify(p).slice(0, 60)}`);
  }
});
test('every addon has an id and category', () => {
  for (const a of catalog.addons) {
    assert.ok(a.id,       `addon missing id: ${JSON.stringify(a).slice(0, 60)}`);
    assert.ok(a.category, `addon missing category: ${a.id}`);
  }
});
test('hardwareRules array exists', () => {
  assert.ok(Array.isArray(catalog.hardwareRules), 'hardwareRules must be an array');
  assert.ok(catalog.hardwareRules.length > 0, 'expected at least 1 hardware rule');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Quote math
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2. Quote math');

const emptyQuote = { productId: null, size: null, baseId: 'none', furniture: {}, hardware: {}, bedding: {}, planId: 'none', toggles: {}, customDiscount: 0, taxRate: 0, hw: {} };

test('empty quote totals $0', () => {
  const calc = calculateQuote(emptyQuote, catalog);
  assert.equal(calc.total, 0);
  assert.equal(calc.subtotal, 0);
});

test('mattress + size calculates correctly', () => {
  const q = { ...emptyQuote, productId: 'c2', size: 'Queen' };
  const calc = calculateQuote(q, catalog);
  const expected = catalog.products.find(p => p.id === 'c2').pricing.Queen;
  assert.equal(calc.subtotal, expected, `expected subtotal ${expected}, got ${calc.subtotal}`);
  assert.ok(calc.total > 0);
});

test('mattress + adjustable base sums correctly', () => {
  const q = { ...emptyQuote, productId: 'p5', size: 'Queen', baseId: 'flexfit-1' };
  const calc = calculateQuote(q, catalog);
  const mattressPrice = catalog.products.find(p => p.id === 'p5').pricing.Queen;
  const basePrice     = catalog.addons.find(a => a.id === 'flexfit-1').price;
  assert.equal(calc.subtotal, mattressPrice + basePrice);
});

test('custom discount reduces total', () => {
  const q = { ...emptyQuote, productId: 'c4', size: 'Queen', customDiscount: 100 };
  const withDisc    = calculateQuote(q, catalog);
  const withoutDisc = calculateQuote({ ...q, customDiscount: 0 }, catalog);
  assert.equal(withDisc.total, withoutDisc.total - 100);
  assert.ok(withDisc.savings >= 100);
});

test('tax rate applies correctly', () => {
  const q = { ...emptyQuote, productId: 'c2', size: 'Queen', taxRate: 10 };
  const calc = calculateQuote(q, catalog);
  const baseTotal = catalog.products.find(p => p.id === 'c2').pricing.Queen;
  const expected  = Math.round(baseTotal * 1.10);
  assert.equal(calc.total, expected, `expected ${expected} with 10% tax, got ${calc.total}`);
});

test('total never goes below $0 with large custom discount', () => {
  const q = { ...emptyQuote, productId: 'c2', size: 'Twin', customDiscount: 99999 };
  const calc = calculateQuote(q, catalog);
  assert.ok(calc.total >= 0, 'total should not be negative');
});

test('addon qty multiplies correctly', () => {
  const q = { ...emptyQuote, hardware: { 'headboard-bracket-kit': 2 } };
  const calc = calculateQuote(q, catalog);
  const bracketPrice = catalog.addons.find(a => a.id === 'headboard-bracket-kit').price;
  assert.equal(calc.subtotal, bracketPrice * 2);
});

test('retail savings are captured', () => {
  const q = { ...emptyQuote, productId: 'c2', size: 'Queen' };
  const p = catalog.products.find(x => x.id === 'c2');
  const calc = calculateQuote(q, catalog);
  const expectedSavings = p.retailPricing.Queen - p.pricing.Queen;
  assert.ok(calc.savings >= expectedSavings, `savings ${calc.savings} should be >= ${expectedSavings}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Promo engine
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3. Promo engine');

test('automatic bundle promo fires when mattress+base qualify', () => {
  // Find a promo that requires mattress+adjustable-base
  const bundlePromo = catalog.promos.find(p => p.type === 'automatic' && p.conditions?.requiresCategories?.includes('adjustable-base'));
  if (!bundlePromo) { console.log('    (skipped: no bundle promo in catalog)'); return; }
  const q = { ...emptyQuote, productId: 'i8', size: 'Queen', baseId: 'flexfit-1' };
  const calc = calculateQuote(q, catalog);
  assert.ok(calc.automaticPromos.some(p => p.id === bundlePromo.id), 'bundle promo should fire');
});

test('automatic promo does not fire below minimum subtotal', () => {
  const bundlePromo = catalog.promos.find(p => p.type === 'automatic' && p.conditions?.minimumSubtotal > 0);
  if (!bundlePromo) { console.log('    (skipped: no minimum-subtotal promo)'); return; }
  const q = { ...emptyQuote }; // empty = $0
  const calc = calculateQuote(q, catalog);
  assert.ok(!calc.automaticPromos.some(p => p.id === bundlePromo.id), 'promo should not fire on $0 quote');
});

test('toggle promo is inactive by default', () => {
  const q = { ...emptyQuote, productId: 'p5', size: 'Queen' };
  const calc = calculateQuote(q, catalog);
  assert.equal(calc.togglePromos.length, 0);
});

test('toggle promo applies when enabled', () => {
  const togglePromo = catalog.promos.find(p => p.type === 'toggle' && (p.discountPercent || p.discountAmount));
  if (!togglePromo) { console.log('    (skipped: no toggle promo)'); return; }
  const q = { ...emptyQuote, productId: 'p5', size: 'Queen', toggles: { [togglePromo.id]: true } };
  const calc = calculateQuote(q, catalog);
  assert.ok(calc.togglePromos.some(p => p.id === togglePromo.id), 'toggle promo should apply');
  assert.ok(calc.savings > 0, 'savings should be > 0 with toggle promo');
});

test('resolvePromo discountAmount caps at subtotal', () => {
  const promo = { id: 'test', type: 'toggle', discountAmount: 99999, conditions: {} };
  const resolved = resolvePromo(promo, 500);
  assert.equal(resolved.amount, 500, 'discount should be capped at subtotal');
});

test('discountPercent resolves correctly', () => {
  const promo = { id: 'pct', type: 'toggle', discountPercent: 10, conditions: {} };
  const resolved = resolvePromo(promo, 1000);
  assert.equal(resolved.amount, 100);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Hardware rules engine
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4. Hardware rules');

test('adjustable base + headboard triggers headboard bracket recommendation', () => {
  const q = { ...emptyQuote, baseId: 'flexfit-1', hw: { hasHeadboard: 'yes' } };
  const recs = getHardwareRecommendations(q, catalog);
  assert.ok(recs.some(r => r.productId === 'headboard-bracket-kit'), 'headboard bracket should be recommended');
});

test('adjustable base + footboard triggers compatibility warning', () => {
  const q = { ...emptyQuote, baseId: 'flexfit-2', hw: { hasFootboard: 'yes' } };
  const recs = getHardwareRecommendations(q, catalog);
  assert.ok(recs.some(r => r.recommendation === 'warning'), 'footboard warning should fire');
});

test('third-party headboard triggers verify recommendation', () => {
  const q = { ...emptyQuote, hw: { headboardType: 'third-party' } };
  const recs = getHardwareRecommendations(q, catalog);
  assert.ok(recs.some(r => r.recommendation === 'verify'), 'third-party headboard should trigger verify');
});

test('no base selected triggers base recommendation', () => {
  const q = { ...emptyQuote, baseId: 'none' };
  const recs = getHardwareRecommendations(q, catalog);
  assert.ok(recs.some(r => r.id === 'rule-no-base'), 'no-base rule should fire');
});

test('height concern "higher" triggers tall legs recommendation', () => {
  const q = { ...emptyQuote, hw: { heightConcern: 'higher' } };
  const recs = getHardwareRecommendations(q, catalog);
  assert.ok(recs.some(r => r.productId === 'modular-base-legs-tall'), 'tall legs should be recommended');
});

test('height concern "lower" triggers low legs recommendation', () => {
  const q = { ...emptyQuote, hw: { heightConcern: 'lower' } };
  const recs = getHardwareRecommendations(q, catalog);
  assert.ok(recs.some(r => r.productId === 'modular-base-legs-low'), 'low legs should be recommended');
});

test('adjustable base triggers retainer bar recommendation', () => {
  const q = { ...emptyQuote, baseId: 'flexfit-3' };
  const recs = getHardwareRecommendations(q, catalog);
  assert.ok(recs.some(r => r.productId === 'retainer-bar'), 'retainer bar should be recommended for adjustable base');
});

test('Split King triggers center support bar recommendation', () => {
  const q = { ...emptyQuote, size: 'Split King' };
  const recs = getHardwareRecommendations(q, catalog);
  assert.ok(recs.some(r => r.productId === 'support-bar'), 'support bar should be recommended for Split King');
});

test('no recommendations for minimal valid quote', () => {
  // Just mattress + foundation + no headboard/footboard concerns
  const q = { ...emptyQuote, productId: 'c2', size: 'Queen', baseId: 'modular-base-standard', hw: { hasHeadboard: 'no', hasFootboard: 'no', heightConcern: 'standard' } };
  const recs = getHardwareRecommendations(q, catalog);
  // no-base rule should NOT fire; retainer bar should not fire (non-adjustable)
  assert.ok(!recs.some(r => r.id === 'rule-no-base'), 'no-base rule should not fire when base is set');
  const warnings = recs.filter(r => r.recommendation === 'warning');
  assert.equal(warnings.length, 0, 'no warnings for clean setup');
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests complete: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);