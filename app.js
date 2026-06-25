const CATALOG_URL = 'data/catalog.json';
const CACHE_KEY = 'sleep_quote_catalog_v1';
const QUOTE_KEY = 'sleep_quote_draft_v1';

const steps = [
  { id: 'brand', title: 'Pick a collection', sub: 'Tap a Sleep Number series to start', pill: 'Series', single: true },
  { id: 'mattress', title: 'Pick the smart bed', sub: 'Choose a size, then tap a bed', pill: 'Bed', single: true },
  { id: 'base', title: 'Add a base', sub: 'Adjustable or integrated — or skip', pill: 'Base', single: true, optional: true },
  { id: 'furniture', title: 'Add furniture', sub: 'Optional pieces — tap to add', pill: 'Furniture', optional: true },
  { id: 'layers', title: 'Layers & protection', sub: 'Optional comfort + protection', pill: 'Layers', optional: true },
  { id: 'bedding', title: 'Bedding & pillows', sub: 'Optional bedding — tap to add', pill: 'Bedding', optional: true },
  { id: 'review', title: 'Discounts & quote', sub: 'Apply discounts and copy the quote', pill: 'Quote' }
];

const INCLUDED_PERKS = [
  '100-night in-home trial',
  '15-year limited warranty',
  'Free in-home delivery & setup (value $199.99)'
];

let catalog = null;
let currentStep = 0;
let quote = loadQuote();
let deferredInstallPrompt = null;
let advanceTimer = null;

const $ = (id) => document.getElementById(id);

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $('installBtn').classList.remove('hidden');
});

$('installBtn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $('installBtn').classList.add('hidden');
});

$('refreshCatalogBtn').addEventListener('click', () => refreshCatalog(true));
$('backBtn').addEventListener('click', back);
$('nextBtn').addEventListener('click', advance);
$('copyQuoteBtn').addEventListener('click', copyQuote);
$('barNext').addEventListener('click', () => { if (currentStep === steps.length - 1) copyQuote(); else advance(); });
$('resetBtn').addEventListener('click', () => {
  quote = defaultQuote();
  currentStep = 0;
  saveQuote();
  render();
  toast('Quote reset');
});

document.addEventListener('keydown', onKeydown);

init();

function onKeydown(e) {
  const tag = (document.activeElement?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); advance(); }
  else if (e.key === 'Backspace' || e.key === 'ArrowLeft') { e.preventDefault(); back(); }
  else if (/^[1-9]$/.test(e.key)) {
    const cards = [...document.querySelectorAll('#stepBody [data-pick]')];
    const card = cards[Number(e.key) - 1];
    if (card) { e.preventDefault(); card.click(); }
  }
}

function advance() {
  clearTimeout(advanceTimer);
  if (currentStep < steps.length - 1) { currentStep += 1; render(); }
}
function back() {
  clearTimeout(advanceTimer);
  if (currentStep > 0) { currentStep -= 1; render(); }
}
function goToStep(index) {
  clearTimeout(advanceTimer);
  currentStep = Math.max(0, Math.min(steps.length - 1, index));
  render();
}

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
  catalog = readSavedCatalog();
  updateCatalogStatus(catalog ? 'saved' : 'empty');
  render();
  await refreshCatalog(false);
}

async function refreshCatalog(showToast) {
  try {
    updateCatalogStatus('loading');
    const res = await fetch(`${CATALOG_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Catalog request failed: ${res.status}`);
    const nextCatalog = await res.json();
    validateCatalog(nextCatalog);
    catalog = nextCatalog;
    localStorage.setItem(CACHE_KEY, JSON.stringify(nextCatalog));
    updateCatalogStatus('fresh');
    normalizeQuoteAgainstCatalog();
    render();
    if (showToast) toast('Catalog refreshed and saved for offline use');
  } catch (error) {
    updateCatalogStatus(catalog ? 'saved' : 'error', error.message);
    if (showToast) toast(catalog ? 'Could not refresh. Using saved catalog.' : 'No catalog available yet.');
  }
}

function readSavedCatalog() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function validateCatalog(data) {
  if (!data || !Array.isArray(data.brands) || !Array.isArray(data.products)) {
    throw new Error('Catalog is missing brands/products');
  }
}

function defaultQuote() {
  return {
    brandId: null,
    productId: null,
    baseId: 'none',
    furniture: {},
    layers: {},
    bedding: {},
    planId: 'none',
    toggles: {},
    customDiscount: 0,
    taxRate: 0
  };
}

function loadQuote() {
  try {
    return { ...defaultQuote(), ...(JSON.parse(localStorage.getItem(QUOTE_KEY)) || {}) };
  } catch {
    return defaultQuote();
  }
}

function saveQuote() {
  localStorage.setItem(QUOTE_KEY, JSON.stringify(quote));
}

function normalizeQuoteAgainstCatalog() {
  if (!catalog) return;
  if (quote.brandId && !catalog.brands.some((b) => b.id === quote.brandId)) quote.brandId = null;
  if (quote.productId && !catalog.products.some((p) => p.id === quote.productId)) quote.productId = null;
  saveQuote();
}

function render() {
  if (!catalog) {
    $('stepBody').innerHTML = `<div class="empty-state"><h3>No catalog yet</h3><p>Press Refresh catalog while you are on unrestricted internet. After that, this app works offline.</p></div>`;
    updateChrome();
    renderSummary();
    return;
  }
  updateChrome();
  const step = steps[currentStep].id;
  const renderers = { brand: renderBrand, mattress: renderMattress, base: renderBase, furniture: renderFurniture, layers: renderLayers, bedding: renderBedding, review: renderReview };
  $('stepBody').innerHTML = renderers[step]();
  bindStepEvents(step);
  renderSummary();
}

function updateChrome() {
  const step = steps[currentStep];
  $('stepCounter').textContent = `Step ${currentStep + 1} of ${steps.length}`;
  $('stepTitle').textContent = step.title;
  $('stepSub').textContent = step.sub || '';
  $('progressBar').style.width = `${((currentStep + 1) / steps.length) * 100}%`;
  $('backBtn').disabled = currentStep === 0;
  const last = currentStep === steps.length - 1;
  $('nextBtn').textContent = last ? 'Done' : (step.optional ? 'Skip →' : 'Next →');
  $('nextBtn').disabled = last;
  renderPills();
}

function renderPills() {
  const host = $('stepPills');
  if (!host) return;
  host.innerHTML = steps.map((s, i) => {
    const done = isStepComplete(s.id);
    const cls = ['pill', i === currentStep ? 'active' : '', done ? 'done' : ''].filter(Boolean).join(' ');
    return `<button class="${cls}" data-step="${i}"><span class="pill-num">${done ? '✓' : i + 1}</span>${escapeHtml(s.pill)}</button>`;
  }).join('');
  host.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => goToStep(Number(b.dataset.step))));
}

function isStepComplete(id) {
  switch (id) {
    case 'brand': return !!quote.brandId;
    case 'mattress': return !!quote.productId;
    case 'base': return !!quote.baseId && quote.baseId !== 'none';
    case 'furniture': return Object.values(quote.furniture || {}).some(Boolean);
    case 'layers': return Object.values(quote.layers || {}).some(Boolean);
    case 'bedding': return Object.values(quote.bedding || {}).some(Boolean);
    default: return false;
  }
}

function updateCatalogStatus(mode, detail = '') {
  const dot = $('statusDot');
  dot.className = 'status-dot';
  const meta = $('catalogMeta');
  if (mode === 'loading') {
    $('catalogStatus').textContent = 'Refreshing catalog...';
    meta.textContent = 'Trying to load the latest static catalog.';
  } else if (mode === 'fresh') {
    dot.classList.add('good');
    $('catalogStatus').textContent = 'Catalog ready';
    meta.textContent = `Updated ${formatDate(catalog?.lastUpdated)} • ${catalog?.products?.length || 0} beds priced live`;
  } else if (mode === 'saved') {
    dot.classList.add('good');
    $('catalogStatus').textContent = 'Saved catalog';
    meta.textContent = `Saved ${formatDate(catalog?.lastUpdated)} • Works offline`;
  } else if (mode === 'error') {
    dot.classList.add('bad');
    $('catalogStatus').textContent = 'No catalog loaded';
    meta.textContent = detail || 'Refresh once on normal internet.';
  } else {
    $('catalogStatus').textContent = 'No saved catalog';
    meta.textContent = 'Refresh once before relying on this at work.';
  }
}

function renderBrand() {
  return `<div class="grid three">${catalog.brands.map((brand, i) => optionCard({
    id: brand.id,
    index: i,
    title: brand.name,
    subtitle: brand.description || 'Tap to view smart beds.',
    selected: quote.brandId === brand.id,
    extra: `<div class="logo-mark">${brand.logoUrl ? `<img alt="${escapeHtml(brand.name)} logo" src="${brand.logoUrl}">` : escapeHtml(brand.logoText || brand.name)}</div>${brand.badge ? `<span class="badge">${escapeHtml(brand.badge)}</span>` : ''}`
  })).join('')}</div>`;
}

function renderMattress() {
  if (!quote.brandId) return `<p class="helper">Pick a collection first so only those smart beds appear. <button class="linkbtn" data-jump="0">Choose a collection →</button></p>`;
  const all = catalog.products.filter(p => p.brandId === quote.brandId);
  const sizes = unique(all.map(p => p.size));
  const active = quote.sizeFilter || 'All';
  const products = all.filter(p => active === 'All' || p.size === active);
  const chips = ['All', ...sizes].map(s => `<button class="chip ${s === active ? 'active' : ''}" data-size="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');
  const cards = products.map((product, i) => optionCard({
    id: product.id,
    index: i,
    title: product.model,
    subtitle: `${product.size} • ${product.type}`,
    selected: quote.productId === product.id,
    extra: priceBlock(product)
  })).join('');
  return `
    <div class="chips" id="sizeChips">${chips}</div>
    <div class="grid">${cards}</div>`;
}

function renderBase() {
  return groupedAddons(['adjustable-base', 'foundation'], 'baseId', true);
}

function renderFurniture() {
  return quantityGrid(catalog.addons.filter(a => a.category === 'furniture'), 'furniture');
}

function renderLayers() {
  return quantityGrid(catalog.addons.filter(a => ['protection-layer', 'comfort-layer'].includes(a.category)), 'layers');
}

function renderBedding() {
  return quantityGrid(catalog.addons.filter(a => ['bedding', 'pillow'].includes(a.category)), 'bedding');
}

function renderReview() {
  const military = catalog.promos.find(p => p.id === 'military-first-responder');
  const perks = INCLUDED_PERKS.map(p => `<li>${escapeHtml(p)}</li>`).join('');
  const militaryRow = military ? `
    <label class="toggle-row big">
      <input type="checkbox" data-promo-toggle="${military.id}" ${quote.toggles[military.id] ? 'checked' : ''}>
      <span><strong>${escapeHtml(military.name)} — ${military.discountPercent}% off</strong><p>${escapeHtml(military.description || '')}</p></span>
    </label>` : '';
  return `
    <div class="review-grid">
      <div class="included-card">
        <p class="eyebrow">Included free</p>
        <ul class="perks">${perks}</ul>
      </div>
      <div>
        <h3 class="mini-title">Discounts</h3>
        ${militaryRow || '<p class="helper">No optional discounts available.</p>'}
        <details class="advanced">
          <summary>Advanced (manager use)</summary>
          <div class="form-grid" style="margin-top:.8rem">
            <label class="field"><span>Approved $ discount</span><input type="number" min="0" step="1" data-field="customDiscount" value="${quote.customDiscount || 0}"></label>
            <label class="field"><span>Estimated tax %</span><input type="number" min="0" step=".01" data-field="taxRate" value="${quote.taxRate || 0}"></label>
          </div>
        </details>
        <button class="wide" id="reviewCopyBtn">Copy quote</button>
      </div>
    </div>`;
}

function groupedAddons(categories, key, includeNone = false) {
  const items = catalog.addons.filter(a => categories.includes(a.category));
  const all = includeNone ? [{ id: 'none', name: 'Skip — no base', description: 'Continue without a base.', price: 0, category: 'none' }, ...items] : items;
  return `<div class="grid">${all.map((item, i) => optionCard({
    id: item.id,
    index: i,
    title: item.name,
    subtitle: item.description || item.category,
    selected: quote[key] === item.id,
    extra: `<span class="badge">${item.price ? money(item.price) : 'No charge'}</span>`
  })).join('')}</div>`;
}

function quantityGrid(items, bucket) {
  if (!items.length) return '<p class="helper">No items in this section yet.</p>';
  return `<div class="grid">${items.map((item, i) => {
    const qty = quote[bucket]?.[item.id] || 0;
    return `<div class="card-option qty-card ${qty ? 'selected' : ''}" data-pick data-qty-add="${bucket}:${item.id}">
      <kbd class="pick-key">${i + 1}</kbd>
      <span class="badge">${money(item.price)} each</span>
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.description || item.category)}</p>
      <div class="qty-row">
        <button data-qty-minus="${bucket}:${item.id}" class="secondary">−</button>
        <span>${qty}</span>
        <button data-qty-plus="${bucket}:${item.id}">+</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function optionCard({ id, title, subtitle, selected, extra = '', index = null }) {
  const key = index != null && index < 9 ? `<kbd class="pick-key">${index + 1}</kbd>` : '';
  const check = `<span class="check">✓</span>`;
  return `<div class="card-option ${selected ? 'selected' : ''}" data-id="${id}" data-pick>${key}${check}${extra}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle || '')}</p></div>`;
}

function priceBlock(product) {
  const sale = product.salePrice ?? product.retailPrice;
  const save = Math.max(0, product.retailPrice - sale);
  const pct = save ? Math.round((save / product.retailPrice) * 100) : 0;
  const strike = save ? `<span class="was">${money(product.retailPrice)}</span>` : '';
  const saveTag = save ? `<span class="save-tag">Save ${money(save)}${pct ? ` · ${pct}%` : ''}</span>` : '';
  return `<div class="price-block"><span class="now">${money(sale)}</span>${strike}${saveTag}</div>`;
}

function bindStepEvents(step) {
  document.querySelectorAll('.card-option[data-id]').forEach(card => {
    card.addEventListener('click', () => selectSingle(step, card.dataset.id));
  });
  document.querySelectorAll('#sizeChips .chip').forEach(chip => {
    chip.addEventListener('click', () => { quote.sizeFilter = chip.dataset.size; saveQuote(); render(); });
  });
  document.querySelectorAll('[data-qty-add]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-qty-minus],[data-qty-plus]')) return;
      changeQty(card.dataset.qtyAdd, 1);
    });
  });
  document.querySelectorAll('[data-qty-plus]').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); changeQty(e.currentTarget.dataset.qtyPlus, 1); }));
  document.querySelectorAll('[data-qty-minus]').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); changeQty(e.currentTarget.dataset.qtyMinus, -1); }));
  document.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      const key = input.dataset.field;
      quote[key] = input.type === 'number' ? Number(input.value || 0) : input.value;
      saveQuote();
      renderSummary();
    });
  });
  document.querySelectorAll('[data-promo-toggle]').forEach(input => {
    input.addEventListener('change', () => {
      quote.toggles[input.dataset.promoToggle] = input.checked;
      saveQuote();
      renderSummary();
    });
  });
  document.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => goToStep(Number(b.dataset.jump))));
  const reviewCopy = $('reviewCopyBtn');
  if (reviewCopy) reviewCopy.addEventListener('click', copyQuote);
}

function selectSingle(step, id) {
  if (step === 'brand') {
    if (quote.brandId !== id) { quote.brandId = id; quote.productId = null; delete quote.sizeFilter; }
  } else if (step === 'mattress') {
    quote.productId = id;
  } else if (step === 'base') {
    quote.baseId = id;
  }
  saveQuote();
  render();
  if (steps[currentStep].single) {
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(advance, 220);
  }
}

function changeQty(token, delta) {
  const [bucket, id] = token.split(':');
  quote[bucket] ||= {};
  quote[bucket][id] = Math.max(0, (quote[bucket][id] || 0) + delta);
  if (!quote[bucket][id]) delete quote[bucket][id];
  saveQuote();
  render();
}

function renderSummary() {
  const calc = calculateQuote();
  const product = catalog?.products?.find(p => p.id === quote.productId);
  $('totalDue').textContent = money(calc.total);
  $('savingsPill').textContent = `${money(calc.savings)} saved`;
  $('savingsPill').classList.toggle('hidden', calc.savings <= 0);
  pulse($('totalDue'));

  $('miniSummary').innerHTML = calc.lines.length
    ? calc.lines.map(line => `<div class="summary-line"><span>${escapeHtml(line.label)}</span><strong>${money(line.amount)}</strong></div>`).join('')
    : '<p class="helper">Tap a collection to start your quote.</p>';

  const promoItems = [...calc.automaticPromos, ...calc.togglePromos]
    .map(p => `<div class="promo-item"><strong>${escapeHtml(p.name)}</strong><span>-${money(p.amount)}</span></div>`).join('');
  const perks = product ? `<div class="promo-item perk"><strong>Included free</strong><span>${INCLUDED_PERKS.length} perks</span></div>` : '';
  $('promoList').innerHTML = (promoItems || perks)
    ? `${promoItems}${perks}`
    : '<div class="promo-item">Discounts &amp; perks appear here.</div>';

  const bar = $('barTotal');
  if (bar) bar.textContent = money(calc.total);
  const barNext = $('barNext');
  if (barNext) {
    const last = currentStep === steps.length - 1;
    barNext.textContent = last ? 'Copy quote' : 'Next →';
  }
}

function pulse(el) {
  if (!el) return;
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}

function calculateQuote() {
  const lines = [];
  let subtotal = 0;
  let savings = 0;
  const product = catalog?.products?.find(p => p.id === quote.productId);
  if (product) {
    const price = product.salePrice ?? product.retailPrice;
    lines.push({ label: `${product.model} (${product.size})`, amount: price });
    subtotal += price;
    savings += Math.max(0, product.retailPrice - price);
  }
  const base = addonById(quote.baseId);
  if (base && base.id !== 'none') { lines.push({ label: base.name, amount: base.price }); subtotal += base.price; }
  for (const bucket of ['furniture', 'layers', 'bedding']) {
    Object.entries(quote[bucket] || {}).forEach(([id, qty]) => {
      const item = addonById(id);
      if (item && qty) { lines.push({ label: `${item.name} × ${qty}`, amount: item.price * qty }); subtotal += item.price * qty; }
    });
  }

  const { automatic, toggles } = getAppliedPromos(subtotal);
  const promoDiscount = [...automatic, ...toggles].reduce((sum, promo) => sum + promo.amount, 0);
  const customDiscount = Number(quote.customDiscount || 0);
  const taxRate = Number(quote.taxRate || 0) / 100;
  const taxable = Math.max(0, subtotal - promoDiscount - customDiscount);
  const tax = taxable * taxRate;
  if (customDiscount) lines.push({ label: 'Approved discount', amount: -customDiscount });
  if (tax) lines.push({ label: 'Estimated tax', amount: tax });
  const total = Math.max(0, taxable + tax);
  return { lines, subtotal, savings: savings + promoDiscount + customDiscount, total, automaticPromos: automatic, togglePromos: toggles };
}

function getAppliedPromos(currentSubtotal = null) {
  if (!catalog) return { automatic: [], toggles: [] };
  const subtotal = currentSubtotal ?? calculateBareSubtotal();
  const product = catalog.products.find(p => p.id === quote.productId);
  const selectedCategories = selectedCategorySet();
  const automatic = [];
  const toggles = [];
  for (const promo of catalog.promos) {
    if (promo.type === 'automatic' && qualifies(promo, product, selectedCategories, subtotal)) automatic.push(resolvePromo(promo, subtotal));
    if ((promo.type === 'toggle' || promo.type === 'manual') && quote.toggles[promo.id]) toggles.push(resolvePromo(promo, subtotal));
  }
  return { automatic, toggles };
}

function calculateBareSubtotal() {
  let total = 0;
  const p = catalog?.products?.find(x => x.id === quote.productId);
  if (p) total += p.salePrice ?? p.retailPrice;
  const base = addonById(quote.baseId); if (base && base.id !== 'none') total += base.price;
  for (const bucket of ['furniture', 'layers', 'bedding']) Object.entries(quote[bucket] || {}).forEach(([id, qty]) => { const item = addonById(id); if (item) total += item.price * qty; });
  return total;
}

function qualifies(promo, product, categories, subtotal) {
  const rules = promo.conditions || {};
  if (rules.brandId && product?.brandId !== rules.brandId) return false;
  if (rules.minimumSubtotal && subtotal < rules.minimumSubtotal) return false;
  if (rules.requiresProduct && !product) return false;
  if (rules.requiresCategories && !rules.requiresCategories.every(c => categories.has(c))) return false;
  return true;
}

function resolvePromo(promo, subtotal) {
  const amount = promo.discountAmount ?? Math.round(subtotal * ((promo.discountPercent || 0) / 100));
  return { ...promo, amount: Math.min(amount, subtotal) };
}

function selectedCategorySet() {
  const set = new Set();
  if (quote.productId) set.add('mattress');
  const base = addonById(quote.baseId); if (base) set.add(base.category);
  for (const bucket of ['furniture', 'layers', 'bedding']) Object.keys(quote[bucket] || {}).forEach(id => { const item = addonById(id); if (item) set.add(item.category); });
  return set;
}

function addonById(id) { return catalog?.addons?.find(a => a.id === id); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function money(value) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0)); }
function formatDate(value) { return value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown'; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function toast(message) { const el = $('toast'); el.textContent = message; el.classList.remove('hidden'); clearTimeout(window.__toast); window.__toast = setTimeout(() => el.classList.add('hidden'), 2800); }

async function copyQuote() {
  const calc = calculateQuote();
  const product = catalog?.products?.find(p => p.id === quote.productId);
  const text = [
    'Sleep Number Quote',
    product ? `Bed: ${product.series} ${product.model} (${product.size})` : 'Bed: Not selected',
    ...calc.lines.map(l => `${l.label}: ${money(l.amount)}`),
    '',
    `Estimated total: ${money(calc.total)}`,
    `Estimated savings: ${money(calc.savings)}`,
    'Included free: 100-night trial, 15-year warranty, in-home delivery & setup',
    `Catalog updated: ${formatDate(catalog?.lastUpdated)}`,
    '',
    'Final pricing/eligibility may depend on verification and current store policy.'
  ].join('\n');
  try { await navigator.clipboard.writeText(text); toast('Quote copied'); }
  catch { toast('Copy not available'); }
}
