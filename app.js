const CATALOG_URL = 'data/catalog.json';
const CACHE_KEY = 'sleep_quote_catalog_v1';
const QUOTE_KEY = 'sleep_quote_draft_v1';

const steps = [
  { id: 'brand', title: 'Choose Sleep Number series' },
  { id: 'mattress', title: 'Pick the mattress' },
  { id: 'base', title: 'Choose a base' },
  { id: 'furniture', title: 'Add furniture' },
  { id: 'layers', title: 'Protection and comfort layers' },
  { id: 'bedding', title: 'Bedding + pillows' },
  { id: 'plans', title: 'Protection plans' },
  { id: 'promos', title: 'Promos + discounts' }
];

let catalog = null;
let currentStep = 0;
let quote = loadQuote();
let deferredInstallPrompt = null;

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
$('backBtn').addEventListener('click', () => { currentStep = Math.max(0, currentStep - 1); render(); });
$('nextBtn').addEventListener('click', () => { currentStep = Math.min(steps.length - 1, currentStep + 1); render(); });
$('copyQuoteBtn').addEventListener('click', copyQuote);
$('resetBtn').addEventListener('click', () => {
  quote = defaultQuote();
  currentStep = 0;
  saveQuote();
  render();
  toast('Quote reset');
});

init();

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
    $('stepBody').innerHTML = `<div class="empty-state"><h3>No catalog yet</h3><p>Press Refresh catalog while you are on unrestricted internet. After that, this app will use saved data offline.</p></div>`;
    updateChrome();
    renderSummary();
    return;
  }
  updateChrome();
  const step = steps[currentStep].id;
  const renderers = { brand: renderBrand, mattress: renderMattress, base: renderBase, furniture: renderFurniture, layers: renderLayers, bedding: renderBedding, plans: renderPlans, promos: renderPromos };
  $('stepBody').innerHTML = renderers[step]();
  bindStepEvents(step);
  renderSummary();
}

function updateChrome() {
  $('stepCounter').textContent = `Step ${currentStep + 1} of ${steps.length}`;
  $('stepTitle').textContent = steps[currentStep].title;
  $('progressBar').style.width = `${((currentStep + 1) / steps.length) * 100}%`;
  $('backBtn').disabled = currentStep === 0;
  $('nextBtn').textContent = currentStep === steps.length - 1 ? 'Review quote' : 'Continue';
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
    meta.textContent = `Last updated: ${formatDate(catalog?.lastUpdated)} • ${catalog?.products?.length || 0} products`;
  } else if (mode === 'saved') {
    dot.classList.add('good');
    $('catalogStatus').textContent = 'Using saved catalog';
    meta.textContent = `Saved update: ${formatDate(catalog?.lastUpdated)} • Works offline`;
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
  return `<div class="grid three">${catalog.brands.map((brand) => optionCard({
    id: brand.id,
    title: brand.name,
    subtitle: brand.description || 'Tap to view series and mattress options.',
    selected: quote.brandId === brand.id,
    extra: `<div class="logo-mark">${brand.logoUrl ? `<img alt="${escapeHtml(brand.name)} logo" src="${brand.logoUrl}">` : escapeHtml(brand.logoText || brand.name)}</div>${brand.badge ? `<span class="badge">${escapeHtml(brand.badge)}</span>` : ''}`
  })).join('')}</div>`;
}

function renderMattress() {
  const products = filteredProducts();
  if (!quote.brandId) return `<p class="helper">Choose a Sleep Number series first so the mattress list stays clean.</p>`;
  return `
    <div class="form-grid">
      <label class="field"><span>Size</span><select data-field="sizeFilter">${options(['All', ...unique(products.map(p => p.size))], quote.sizeFilter || 'All')}</select></label>
      <label class="field"><span>Comfort</span><select data-field="comfortFilter">${options(['All', ...unique(products.map(p => p.comfort))], quote.comfortFilter || 'All')}</select></label>
    </div>
    <div class="grid">${products.map(product => optionCard({
      id: product.id,
      title: `${product.series} ${product.model}`,
      subtitle: `${product.size} • ${product.comfort} • ${product.type}`,
      selected: quote.productId === product.id,
      extra: priceBlock(product)
    })).join('')}</div>`;
}

function renderBase() {
  return groupedAddons(['foundation', 'adjustable-base'], 'baseId', true);
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

function renderPlans() {
  return groupedAddons(['protection-plan'], 'planId', true);
}

function renderPromos() {
  const toggles = catalog.promos.filter(p => p.type === 'toggle' || p.type === 'manual');
  return `
    <div class="promo-list">${getAppliedPromos().automatic.map(p => `<div class="promo-item"><strong>Auto applied: ${escapeHtml(p.name)}</strong><span>-${money(p.amount)}</span></div>`).join('') || '<div class="promo-item">No automatic promos currently qualify.</div>'}</div>
    <h3>Conditional promos and overrides</h3>
    <div class="toggle-list">${toggles.map(promo => `
      <label class="toggle-row">
        <input type="checkbox" data-promo-toggle="${promo.id}" ${quote.toggles[promo.id] ? 'checked' : ''}>
        <span><strong>${escapeHtml(promo.name)}</strong><p>${escapeHtml(promo.description || 'Use only when the customer qualifies.')}</p></span>
      </label>`).join('')}
    </div>
    <div class="form-grid" style="margin-top:1rem">
      <label class="field"><span>Custom approved discount</span><input type="number" min="0" step="1" data-field="customDiscount" value="${quote.customDiscount || 0}"></label>
      <label class="field"><span>Estimated tax %</span><input type="number" min="0" step=".01" data-field="taxRate" value="${quote.taxRate || 0}"></label>
    </div>`;
}

function groupedAddons(categories, key, includeNone = false) {
  const items = catalog.addons.filter(a => categories.includes(a.category));
  const all = includeNone ? [{ id: 'none', name: 'None', description: 'Skip this section.', price: 0, category: 'none' }, ...items] : items;
  return `<div class="grid">${all.map(item => optionCard({
    id: item.id,
    title: item.name,
    subtitle: item.description || item.category,
    selected: quote[key] === item.id,
    extra: `<span class="badge">${item.price ? money(item.price) : 'No charge'}</span>`
  })).join('')}</div>`;
}

function quantityGrid(items, bucket) {
  if (!items.length) return '<p class="helper">No items in this section yet.</p>';
  return `<div class="grid">${items.map(item => {
    const qty = quote[bucket]?.[item.id] || 0;
    return `<div class="card-option ${qty ? 'selected' : ''}">
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.description || item.category)}</p>
      <span class="badge">${money(item.price)} each</span>
      <div class="qty-row">
        <button data-qty-minus="${bucket}:${item.id}" class="secondary">−</button>
        <span>${qty}</span>
        <button data-qty-plus="${bucket}:${item.id}">+</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function bindStepEvents(step) {
  document.querySelectorAll('.card-option[data-id]').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      if (step === 'brand') { quote.brandId = id; quote.productId = null; }
      if (step === 'mattress') quote.productId = id;
      if (step === 'base') quote.baseId = id;
      if (step === 'plans') quote.planId = id;
      saveQuote();
      render();
    });
  });
  document.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      const key = input.dataset.field;
      quote[key] = input.type === 'number' ? Number(input.value || 0) : input.value;
      saveQuote();
      render();
    });
  });
  document.querySelectorAll('[data-promo-toggle]').forEach(input => {
    input.addEventListener('change', () => {
      quote.toggles[input.dataset.promoToggle] = input.checked;
      saveQuote();
      render();
    });
  });
  document.querySelectorAll('[data-qty-plus]').forEach(btn => btn.addEventListener('click', (e) => changeQty(e.currentTarget.dataset.qtyPlus, 1)));
  document.querySelectorAll('[data-qty-minus]').forEach(btn => btn.addEventListener('click', (e) => changeQty(e.currentTarget.dataset.qtyMinus, -1)));
}

function changeQty(token, delta) {
  const [bucket, id] = token.split(':');
  quote[bucket] ||= {};
  quote[bucket][id] = Math.max(0, (quote[bucket][id] || 0) + delta);
  if (!quote[bucket][id]) delete quote[bucket][id];
  saveQuote();
  render();
}

function filteredProducts() {
  return catalog.products.filter(p => {
    if (quote.brandId && p.brandId !== quote.brandId) return false;
    if (quote.sizeFilter && quote.sizeFilter !== 'All' && p.size !== quote.sizeFilter) return false;
    if (quote.comfortFilter && quote.comfortFilter !== 'All' && p.comfort !== quote.comfortFilter) return false;
    return true;
  });
}

function optionCard({ id, title, subtitle, selected, extra = '' }) {
  return `<div class="card-option ${selected ? 'selected' : ''}" data-id="${id}">${extra}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle || '')}</p></div>`;
}

function priceBlock(product) {
  const sale = product.salePrice ?? product.retailPrice;
  const save = Math.max(0, product.retailPrice - sale);
  return `<span class="badge">${money(sale)}${save ? ` • Save ${money(save)}` : ''}</span>`;
}

function renderSummary() {
  const calc = calculateQuote();
  $('totalDue').textContent = money(calc.total);
  $('savingsPill').textContent = `${money(calc.savings)} saved`;
  $('miniSummary').innerHTML = calc.lines.map(line => `<div class="summary-line"><span>${escapeHtml(line.label)}</span><strong>${money(line.amount)}</strong></div>`).join('') || '<p class="helper">Start selecting options to build a quote.</p>';
  $('promoList').innerHTML = [...calc.automaticPromos, ...calc.togglePromos].map(p => `<div class="promo-item"><strong>${escapeHtml(p.name)}</strong><span>-${money(p.amount)}</span></div>`).join('') || '<div class="promo-item">Promos will appear here.</div>';
}

function calculateQuote() {
  const lines = [];
  let subtotal = 0;
  let savings = 0;
  const product = catalog?.products?.find(p => p.id === quote.productId);
  if (product) {
    const price = product.salePrice ?? product.retailPrice;
    lines.push({ label: `${product.series} ${product.model}`, amount: price });
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
  const plan = addonById(quote.planId);
  if (plan && plan.id !== 'none') { lines.push({ label: plan.name, amount: plan.price }); subtotal += plan.price; }

  const { automatic, toggles } = getAppliedPromos(subtotal);
  const promoDiscount = [...automatic, ...toggles].reduce((sum, promo) => sum + promo.amount, 0);
  const customDiscount = Number(quote.customDiscount || 0);
  const taxRate = Number(quote.taxRate || 0) / 100;
  const taxable = Math.max(0, subtotal - promoDiscount - customDiscount);
  const tax = taxable * taxRate;
  if (customDiscount) lines.push({ label: 'Approved custom discount', amount: -customDiscount });
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
  const plan = addonById(quote.planId); if (plan && plan.id !== 'none') total += plan.price;
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
  const plan = addonById(quote.planId); if (plan) set.add(plan.category);
  for (const bucket of ['furniture', 'layers', 'bedding']) Object.keys(quote[bucket] || {}).forEach(id => { const item = addonById(id); if (item) set.add(item.category); });
  return set;
}

function addonById(id) { return catalog?.addons?.find(a => a.id === id); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function options(values, selected) { return values.map(v => `<option ${v === selected ? 'selected' : ''}>${escapeHtml(v)}</option>`).join(''); }
function money(value) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0)); }
function formatDate(value) { return value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown'; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function toast(message) { const el = $('toast'); el.textContent = message; el.classList.remove('hidden'); clearTimeout(window.__toast); window.__toast = setTimeout(() => el.classList.add('hidden'), 2800); }

async function copyQuote() {
  const calc = calculateQuote();
  const product = catalog?.products?.find(p => p.id === quote.productId);
  const text = [
    'Sleep Number Quick Quote',
    product ? `Mattress: ${product.series} ${product.model} (${product.size}, ${product.comfort})` : 'Mattress: Not selected',
    ...calc.lines.map(l => `${l.label}: ${money(l.amount)}`),
    '',
    `Estimated total: ${money(calc.total)}`,
    `Estimated savings: ${money(calc.savings)}`,
    `Catalog updated: ${formatDate(catalog?.lastUpdated)}`,
    '',
    'Final pricing/eligibility may depend on verification and current store policy.'
  ].join('\n');
  await navigator.clipboard.writeText(text);
  toast('Quote copied');
}
