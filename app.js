import { calculateQuote, deriveHardwareOutcome, validateCatalogShape } from './src/quote-engine.mjs';

const CATALOG_URL = 'data/catalog.json';
const CACHE_KEY = 'sleep_quote_catalog_v2';
const QUOTE_KEY = 'sleep_quote_draft_v2';

const steps = [
  { id: 'customer', title: 'Customer basics (optional)' },
  { id: 'mattress', title: 'Mattress selection' },
  { id: 'size', title: 'Size and comfort' },
  { id: 'base', title: 'Base selection' },
  { id: 'hardware', title: 'Furniture and hardware setup' },
  { id: 'bedding', title: 'Bedding and pillows' },
  { id: 'protection', title: 'Protection plan' },
  { id: 'promos', title: 'Promotions and discounts' },
  { id: 'review', title: 'Review quote' },
  { id: 'summary', title: 'Customer-facing summary' },
  { id: 'admin', title: 'Admin / catalog health' }
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
$('newQuoteBtn').addEventListener('click', () => resetQuote('New quote started'));
$('backBtn').addEventListener('click', () => { currentStep = Math.max(0, currentStep - 1); render(); });
$('nextBtn').addEventListener('click', () => { currentStep = Math.min(steps.length - 1, currentStep + 1); render(); });
$('copyQuoteBtn').addEventListener('click', copyQuote);
$('resetBtn').addEventListener('click', () => resetQuote('Quote reset'));

init();

function defaultQuote() {
  return {
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    customerNotes: '',
    brandId: null,
    productId: null,
    baseId: 'none',
    planId: 'none',
    search: '',
    sizeFilter: 'All',
    comfortFilter: 'All',
    furniture: {},
    hardware: {},
    bedding: {},
    pillows: {},
    hardwareAnswers: {
      completeSetup: true,
      addingHeadboard: false,
      hasExistingFrame: false,
      furnitureType: 'sleep-number',
      hasFootboard: false,
      hasSideRails: false,
      usingAdjustableBase: false,
      usingIntegratedBase: false,
      usingPlatformSlats: false,
      heightPreference: 'standard',
      missingRetainerBar: false,
      missingRemote: false,
      missingPowerCord: false
    },
    toggles: {},
    customDiscount: 0,
    taxRate: 0,
    estimatedMonthlyPayment: ''
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

function resetQuote(message) {
  quote = defaultQuote();
  currentStep = 0;
  saveQuote();
  render();
  toast(message);
}

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
  catalog = normalizeCatalog(readSavedCatalog());
  updateCatalogStatus(catalog ? 'saved' : 'empty');
  render();
  await refreshCatalog(false);
}

function readSavedCatalog() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function normalizeCatalog(data) {
  if (!data) return null;

  if (data.metadata && data.options) {
    try {
      validateCatalogShape(data);
      return data;
    } catch {
      return null;
    }
  }

  const addons = data.addons || [];
  const products = (data.products || []).map((p) => ({
    id: p.id,
    name: `${p.series} ${p.model}`.trim(),
    brand: (data.brands || []).find((b) => b.id === p.brandId)?.name || p.brandId,
    category: 'mattress',
    subcategory: p.type || 'Mattress',
    series: p.series,
    model: p.model,
    size: p.size,
    price: p.salePrice ?? p.retailPrice,
    regularPrice: p.retailPrice ?? p.salePrice,
    salePrice: p.salePrice,
    priceLabel: p.salePrice ? 'Sale price' : 'Current price',
    availability: 'unknown',
    imageUrl: p.imageUrl || null,
    productUrl: p.productUrl || null,
    description: p.description || `${p.series} ${p.type || ''}`.trim(),
    tags: [p.comfort, p.type].filter(Boolean),
    compatibleWith: [],
    requires: [],
    warnings: [],
    sourceUrls: [p.sourceUrl || 'data/catalog.json'],
    lastVerified: data.lastUpdated,
    confidenceScore: 0.65
  }));

  const toOption = (item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    description: item.description || '',
    price: item.price || 0,
    warnings: []
  });

  return {
    metadata: {
      schemaVersion: 2,
      lastUpdated: data.lastUpdated,
      generatedAt: data.lastUpdated,
      sourceNotes: data.sourceNotes || 'Legacy catalog converted to normalized model.'
    },
    sources: (data.sourceResults || []).map((s, i) => ({ id: `source-${i + 1}`, name: s.name, url: s.url, status: s.ok ? 'ok' : 'failed', lastChecked: data.lastUpdated, error: s.error || null })),
    sourceHealth: {
      total: (data.sourceResults || []).length,
      ok: (data.sourceResults || []).filter((s) => s.ok).length,
      failed: (data.sourceResults || []).filter((s) => !s.ok).length
    },
    products,
    categories: ['mattress', 'base', 'furniture', 'hardware', 'bedding', 'pillows', 'protection-plan'],
    options: {
      bases: [{ id: 'none', name: 'None', category: 'none', description: 'Skip this section', price: 0 }, ...addons.filter((a) => ['foundation', 'adjustable-base', 'integrated-base'].includes(a.category)).map(toOption)],
      furniture: addons.filter((a) => a.category === 'furniture').map(toOption),
      hardware: addons.filter((a) => ['hardware', 'replacement-part'].includes(a.category)).map(toOption),
      bedding: addons.filter((a) => a.category === 'bedding').map(toOption),
      pillows: addons.filter((a) => a.category === 'pillow').map(toOption)
    },
    promotions: (data.promos || []).map((p) => ({
      ...p,
      verificationRequired: p.verificationRequired ?? p.type !== 'automatic',
      stackable: p.stackable ?? null,
      requiredMinimum: p.conditions?.minimumSubtotal,
      requiredCategories: p.conditions?.requiresCategories || [],
      requiredProducts: p.conditions?.requiresProduct ? ['*'] : [],
      sourceUrl: p.sourceUrl || 'data/catalog.json',
      confidenceScore: p.confidenceScore ?? 0.6
    })),
    promoRules: [],
    compatibilityRules: [],
    hardwareRules: [],
    warnings: [],
    financing: { notes: 'Financing promos should be verified at time of quote.' },
    delivery: { notes: 'Delivery/setup pricing may vary by market and service scope.' },
    protectionPlans: [{ id: 'none', name: 'None', price: 0 }, ...addons.filter((a) => a.category === 'protection-plan').map(toOption)]
  };
}

async function refreshCatalog(showToast) {
  try {
    updateCatalogStatus('loading');
    const res = await fetch(`${CATALOG_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Catalog request failed: ${res.status}`);
    const nextCatalog = normalizeCatalog(await res.json());
    if (!nextCatalog) throw new Error('Catalog normalization failed');
    validateCatalogShape(nextCatalog);
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

function normalizeQuoteAgainstCatalog() {
  if (!catalog) return;
  if (quote.productId && !catalog.products.some((p) => p.id === quote.productId)) quote.productId = null;
  if (quote.baseId && !catalog.options.bases.some((b) => b.id === quote.baseId)) quote.baseId = 'none';
  if (quote.planId && !catalog.protectionPlans.some((p) => p.id === quote.planId)) quote.planId = 'none';
  saveQuote();
}

function render() {
  if (!catalog) {
    $('stepBody').innerHTML = `<div class="empty-state"><h3>No catalog yet</h3><p>Press Refresh catalog on unrestricted internet once. After that this app can quote offline from local cache.</p></div>`;
    updateChrome();
    renderSummary();
    return;
  }

  updateChrome();
  const step = steps[currentStep].id;
  const renderers = {
    customer: renderCustomer,
    mattress: renderMattress,
    size: renderSize,
    base: renderBase,
    hardware: renderHardware,
    bedding: renderBedding,
    protection: renderProtection,
    promos: renderPromos,
    review: renderReview,
    summary: renderCustomerSummary,
    admin: renderAdmin
  };
  $('stepBody').innerHTML = renderers[step]();
  bindStepEvents(step);
  renderSummary();
}

function updateChrome() {
  $('stepCounter').textContent = `Step ${currentStep + 1} of ${steps.length}`;
  $('stepTitle').textContent = steps[currentStep].title;
  $('progressBar').style.width = `${((currentStep + 1) / steps.length) * 100}%`;
  $('backBtn').disabled = currentStep === 0;
  $('nextBtn').textContent = currentStep === steps.length - 1 ? 'Done' : 'Continue';
}

function updateCatalogStatus(mode, detail = '') {
  const dot = $('statusDot');
  dot.className = 'status-dot';
  const meta = $('catalogMeta');
  const lastUpdated = formatDate(catalog?.metadata?.lastUpdated);
  if (mode === 'loading') {
    $('catalogStatus').textContent = 'Refreshing catalog...';
    meta.textContent = 'Loading latest committed catalog snapshot.';
  } else if (mode === 'fresh') {
    dot.classList.add('good');
    $('catalogStatus').textContent = 'Catalog ready';
    meta.textContent = `Last updated: ${lastUpdated} • ${catalog?.products?.length || 0} products`;
  } else if (mode === 'saved') {
    dot.classList.add('good');
    $('catalogStatus').textContent = 'Using saved catalog';
    meta.textContent = `Saved update: ${lastUpdated} • Works offline`;
  } else if (mode === 'error') {
    dot.classList.add('bad');
    $('catalogStatus').textContent = 'No catalog loaded';
    meta.textContent = detail || 'Refresh once on unrestricted internet.';
  } else {
    $('catalogStatus').textContent = 'No saved catalog';
    meta.textContent = 'Refresh once before relying on this tool at work.';
  }
}

function renderCustomer() {
  return `
    <div class="form-grid">
      <label class="field"><span>Customer name (optional)</span><input data-field="customerName" value="${escapeHtml(quote.customerName)}"></label>
      <label class="field"><span>Phone (optional)</span><input data-field="customerPhone" value="${escapeHtml(quote.customerPhone)}"></label>
      <label class="field"><span>Email (optional)</span><input data-field="customerEmail" value="${escapeHtml(quote.customerEmail)}"></label>
      <label class="field"><span>Estimated monthly payment (optional)</span><input data-field="estimatedMonthlyPayment" placeholder="e.g. $89/mo" value="${escapeHtml(quote.estimatedMonthlyPayment)}"></label>
    </div>
    <label class="field" style="margin-top:1rem"><span>Delivery/setup notes</span><textarea data-field="customerNotes" rows="3">${escapeHtml(quote.customerNotes)}</textarea></label>
    <p class="helper">Tip: leave fields blank for a fast under-60-second quote.</p>`;
}

function filteredProducts() {
  return catalog.products.filter((p) => {
    if (quote.search && !(`${p.name} ${p.series} ${p.model}`.toLowerCase().includes(quote.search.toLowerCase()))) return false;
    if (quote.sizeFilter !== 'All' && p.size !== quote.sizeFilter) return false;
    if (quote.comfortFilter !== 'All' && !p.tags?.includes(quote.comfortFilter)) return false;
    return true;
  });
}

function renderMattress() {
  const list = filteredProducts();
  return `
    <label class="field"><span>Search mattress</span><input data-field="search" placeholder="Series, model, size" value="${escapeHtml(quote.search || '')}"></label>
    <div class="grid">${list.map((product) => optionCard({
      id: product.id,
      title: product.name,
      subtitle: `${product.size || 'Size n/a'} • ${product.subcategory || 'Mattress'}`,
      selected: quote.productId === product.id,
      badges: product.confidenceScore < 0.8 ? ['Requires verification'] : [],
      extra: `${product.imageUrl ? `<img class="card-image" alt="${escapeHtml(product.name)}" src="${product.imageUrl}">` : ''}<span class="badge">${money(product.price)}</span>`
    })).join('')}</div>`;
}

function renderSize() {
  const sizes = unique(catalog.products.map((p) => p.size));
  const comfort = unique(catalog.products.flatMap((p) => p.tags || []));
  const selected = catalog.products.find((p) => p.id === quote.productId);
  return `
    <div class="form-grid">
      <label class="field"><span>Size filter</span><select data-field="sizeFilter">${options(['All', ...sizes], quote.sizeFilter)}</select></label>
      <label class="field"><span>Comfort filter</span><select data-field="comfortFilter">${options(['All', ...comfort], quote.comfortFilter)}</select></label>
    </div>
    <div class="status-inline">${selected ? `Selected mattress: <strong>${escapeHtml(selected.name)}</strong>` : 'Select a mattress to continue.'}</div>`;
}

function renderBase() {
  return `<div class="grid">${catalog.options.bases.map((item) => optionCard({
    id: item.id,
    title: item.name,
    subtitle: item.description || item.category,
    selected: quote.baseId === item.id,
    badges: item.category === 'integrated-base' ? ['Recommended support'] : [],
    extra: `<span class="badge">${item.price ? money(item.price) : 'No charge'}</span>`
  })).join('')}</div>`;
}

function renderHardware() {
  const outcome = deriveHardwareOutcome(quote.hardwareAnswers, catalog);
  const recIds = new Set(outcome.recommendations);
  return `
    <div class="form-grid">
      ${yesNo('Using adjustable base?', 'usingAdjustableBase')}
      ${yesNo('Using integrated base?', 'usingIntegratedBase')}
      ${yesNo('Adding a headboard?', 'addingHeadboard')}
      ${yesNo('Has existing frame?', 'hasExistingFrame')}
      ${yesNo('Has footboard?', 'hasFootboard')}
      ${yesNo('Side rails involved?', 'hasSideRails')}
      ${yesNo('Using platform/slats?', 'usingPlatformSlats')}
      ${yesNo('Missing retainer bar?', 'missingRetainerBar')}
      ${yesNo('Missing remote?', 'missingRemote')}
      ${yesNo('Missing power cord?', 'missingPowerCord')}
      <label class="field"><span>Furniture type</span><select data-hardware="furnitureType">${options(['sleep-number', 'third-party'], quote.hardwareAnswers.furnitureType)}</select></label>
      <label class="field"><span>Height preference</span><select data-hardware="heightPreference">${options(['standard', 'higher', 'lower'], quote.hardwareAnswers.heightPreference)}</select></label>
    </div>
    <div class="promo-list" style="margin-top:1rem">${outcome.notes.map((x) => `<div class="promo-item"><strong>Recommended</strong><span>${escapeHtml(x)}</span></div>`).join('') || '<div class="promo-item">Answer a few setup questions to unlock hardware recommendations.</div>'}</div>
    <div class="promo-list" style="margin-top:.7rem">${outcome.warnings.map((x) => `<div class="promo-item warning"><strong>Compatibility warning</strong><span>${escapeHtml(x)}</span></div>`).join('')}</div>
    <h3>Hardware / replacement parts</h3>
    <div class="grid">${catalog.options.hardware.map((item) => {
      const qty = quote.hardware[item.id] || 0;
      const badges = [];
      if (recIds.has(item.id)) badges.push('Recommended');
      if (item.warnings?.length) badges.push('Requires verification');
      return quantityCard('hardware', item, qty, badges);
    }).join('')}</div>`;
}

function renderBedding() {
  return `<h3>Bedding</h3><div class="grid">${catalog.options.bedding.map((item) => quantityCard('bedding', item, quote.bedding[item.id] || 0, [])).join('')}</div>
  <h3>Pillows</h3><div class="grid">${catalog.options.pillows.map((item) => quantityCard('pillows', item, quote.pillows[item.id] || 0, [])).join('')}</div>`;
}

function renderProtection() {
  return `<div class="grid">${catalog.protectionPlans.map((item) => optionCard({
    id: item.id,
    title: item.name,
    subtitle: item.description || 'Protection option',
    selected: quote.planId === item.id,
    extra: `<span class="badge">${item.price ? money(item.price) : 'No charge'}</span>`
  })).join('')}</div>`;
}

function renderPromos() {
  const calc = calculateQuote(quote, catalog);
  const toggles = catalog.promotions.filter((p) => p.type !== 'automatic');
  return `
    <div class="promo-list">${calc.automaticPromos.map((p) => `<div class="promo-item"><strong>Promo applied</strong><span>${escapeHtml(p.name)} • -${money(p.amount)}</span></div>`).join('') || '<div class="promo-item">No automatic promos currently qualify.</div>'}</div>
    <h3>Optional / qualification promos</h3>
    <div class="toggle-list">${toggles.map((promo) => `
      <label class="toggle-row">
        <input type="checkbox" data-promo-toggle="${promo.id}" ${quote.toggles[promo.id] ? 'checked' : ''}>
        <span>
          <strong>${escapeHtml(promo.name)}</strong>
          <p>${escapeHtml(promo.description || 'Use only when customer qualifies.')}</p>
          <p class="meta-note">${promo.verificationRequired ? 'Verification required' : 'Can be applied if qualified'}${promo.stackable == null ? ' • Stackability unknown' : ''}</p>
        </span>
      </label>`).join('')}</div>
    <div class="form-grid" style="margin-top:1rem">
      <label class="field"><span>Manual manager/price-match amount</span><input type="number" min="0" step="1" data-field="customDiscount" value="${quote.customDiscount || 0}"></label>
      <label class="field"><span>Estimated tax %</span><input type="number" min="0" step=".01" data-field="taxRate" value="${quote.taxRate || 0}"></label>
    </div>
    ${calc.blockedPromos.length ? `<div class="promo-item warning" style="margin-top:.75rem"><strong>Verification required</strong><span>${calc.blockedPromos.map((p) => `${escapeHtml(p.name)} (${escapeHtml(p.reason)})`).join(' • ')}</span></div>` : ''}`;
}

function renderReview() {
  const calc = calculateQuote(quote, catalog);
  const hardware = deriveHardwareOutcome(quote.hardwareAnswers, catalog);
  return `
    <div class="mini-summary">${calc.lines.map((line) => `<div class="summary-line"><span>${escapeHtml(line.label)}</span><strong>${money(line.amount)}</strong></div>`).join('')}</div>
    <div class="promo-list">${[...calc.warnings, ...hardware.warnings].map((w) => `<div class="promo-item warning"><strong>Compatibility warning</strong><span>${escapeHtml(w)}</span></div>`).join('') || '<div class="promo-item">No compatibility warnings currently flagged.</div>'}</div>
    <div class="status-inline">Subtotal ${money(calc.subtotal)} • Savings ${money(calc.savings)} • Estimated total ${money(calc.total)}</div>`;
}

function renderCustomerSummary() {
  const calc = calculateQuote(quote, catalog);
  const product = catalog.products.find((p) => p.id === quote.productId);
  const base = catalog.options.bases.find((b) => b.id === quote.baseId);
  const plan = catalog.protectionPlans.find((p) => p.id === quote.planId);
  const hardware = deriveHardwareOutcome(quote.hardwareAnswers, catalog);
  return `<div class="summary-export"><pre>${escapeHtml(summaryText(calc, product, base, plan, hardware))}</pre></div>`;
}

function renderAdmin() {
  const lowConfidence = catalog.products.filter((p) => Number(p.confidenceScore || 0) < 0.8);
  const failedSources = (catalog.sources || []).filter((s) => s.status !== 'ok');
  return `
    <div class="promo-list">
      <div class="promo-item"><strong>Last refresh</strong><span>${formatDate(catalog.metadata.lastUpdated)}</span></div>
      <div class="promo-item"><strong>Catalog age</strong><span>${catalogAgeHours()} hours</span></div>
      <div class="promo-item"><strong>Products</strong><span>${catalog.products.length}</span></div>
      <div class="promo-item"><strong>Promotions</strong><span>${catalog.promotions.length}</span></div>
      <div class="promo-item"><strong>Source health</strong><span>${catalog.sourceHealth.ok || 0} ok / ${catalog.sourceHealth.failed || 0} failed</span></div>
      <div class="promo-item"><strong>Low-confidence products</strong><span>${lowConfidence.length}</span></div>
      <div class="promo-item"><strong>Failed sources</strong><span>${failedSources.length}</span></div>
    </div>
    <div class="promo-list" style="margin-top:.75rem">${(catalog.warnings || []).map((w) => `<div class="promo-item warning"><strong>Warning</strong><span>${escapeHtml(w)}</span></div>`).join('') || '<div class="promo-item">No catalog warnings.</div>'}</div>`;
}

function bindStepEvents(step) {
  document.querySelectorAll('.card-option[data-id]').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      if (step === 'mattress') quote.productId = id;
      if (step === 'base') quote.baseId = id;
      if (step === 'protection') quote.planId = id;
      saveQuote();
      render();
    });
  });

  document.querySelectorAll('[data-field]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.field;
      quote[key] = input.type === 'number' ? Number(input.value || 0) : input.value;
      saveQuote();
      render();
    });
  });

  document.querySelectorAll('[data-hardware]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.hardware;
      quote.hardwareAnswers[key] = input.type === 'checkbox' ? input.checked : input.value;
      saveQuote();
      render();
    });
  });

  document.querySelectorAll('[data-promo-toggle]').forEach((input) => {
    input.addEventListener('change', () => {
      quote.toggles[input.dataset.promoToggle] = input.checked;
      saveQuote();
      render();
    });
  });

  document.querySelectorAll('[data-qty-plus]').forEach((btn) => btn.addEventListener('click', (e) => changeQty(e.currentTarget.dataset.qtyPlus, 1)));
  document.querySelectorAll('[data-qty-minus]').forEach((btn) => btn.addEventListener('click', (e) => changeQty(e.currentTarget.dataset.qtyMinus, -1)));
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
  if (!catalog) return;
  const calc = calculateQuote(quote, catalog);
  $('totalDue').textContent = money(calc.total);
  $('savingsPill').textContent = `${money(calc.savings)} saved`;
  $('miniSummary').innerHTML = calc.lines.map((line) => `<div class="summary-line"><span>${escapeHtml(line.label)}</span><strong>${money(line.amount)}</strong></div>`).join('') || '<p class="helper">Start selecting options to build a quote.</p>';
  $('promoList').innerHTML = [...calc.automaticPromos, ...calc.togglePromos].map((p) => `<div class="promo-item"><strong>${escapeHtml(p.name)}</strong><span>-${money(p.amount)}</span></div>`).join('') || '<div class="promo-item">Promos will appear here.</div>';
}

function summaryText(calc, product, base, plan, hardware) {
  return [
    'Sleep Number Quote Summary',
    quote.customerName ? `Customer: ${quote.customerName}` : 'Customer: (not provided)',
    product ? `Mattress: ${product.name}` : 'Mattress: Not selected',
    product?.size ? `Size: ${product.size}` : 'Size: Verification required',
    base?.id && base.id !== 'none' ? `Base: ${base.name}` : 'Base: none selected',
    plan?.id && plan.id !== 'none' ? `Protection: ${plan.name}` : 'Protection: none selected',
    `Subtotal: ${money(calc.subtotal)}`,
    `Savings: ${money(calc.savings)}`,
    `Estimated tax: ${money((Math.max(0, calc.total - (calc.subtotal - calc.savings))))}`,
    `Estimated total: ${money(calc.total)}`,
    quote.estimatedMonthlyPayment ? `Estimated monthly: ${quote.estimatedMonthlyPayment}` : 'Estimated monthly: (optional field)',
    quote.customerNotes ? `Delivery/setup notes: ${quote.customerNotes}` : 'Delivery/setup notes: none',
    hardware.notes.length ? `Hardware/setup recommendations: ${hardware.notes.join(' | ')}` : 'Hardware/setup recommendations: none',
    hardware.warnings.length ? `Compatibility warnings: ${hardware.warnings.join(' | ')}` : 'Compatibility warnings: none',
    `Catalog last updated: ${formatDate(catalog?.metadata?.lastUpdated)}`,
    'Verify before purchase: if any item or promo shows verification required, confirm in store before final sale.'
  ].join('\n');
}

function quantityCard(bucket, item, qty, badges = []) {
  return `<div class="card-option ${qty ? 'selected' : ''}">
      ${badges.map((b) => `<span class="badge badge-${slug(b)}">${escapeHtml(b)}</span>`).join('')}
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.description || item.category)}</p>
      <span class="badge">${money(item.price)} each</span>
      <div class="qty-row">
        <button data-qty-minus="${bucket}:${item.id}" class="secondary" type="button">−</button>
        <span>${qty}</span>
        <button data-qty-plus="${bucket}:${item.id}" type="button">+</button>
      </div>
    </div>`;
}

function optionCard({ id, title, subtitle, selected, extra = '', badges = [] }) {
  return `<div class="card-option ${selected ? 'selected' : ''}" data-id="${id}">${extra}${badges.map((b) => `<span class="badge badge-${slug(b)}">${escapeHtml(b)}</span>`).join('')}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle || '')}</p></div>`;
}

function yesNo(label, key) {
  return `<label class="field checkbox-field"><span>${escapeHtml(label)}</span><input type="checkbox" data-hardware="${key}" ${quote.hardwareAnswers[key] ? 'checked' : ''}></label>`;
}

function catalogAgeHours() {
  if (!catalog?.metadata?.lastUpdated) return 'unknown';
  return Math.floor((Date.now() - new Date(catalog.metadata.lastUpdated).getTime()) / 36e5);
}

async function copyQuote() {
  if (!catalog) return;
  const calc = calculateQuote(quote, catalog);
  const product = catalog.products.find((p) => p.id === quote.productId);
  const base = catalog.options.bases.find((b) => b.id === quote.baseId);
  const plan = catalog.protectionPlans.find((p) => p.id === quote.planId);
  const hardware = deriveHardwareOutcome(quote.hardwareAnswers, catalog);
  await navigator.clipboard.writeText(summaryText(calc, product, base, plan, hardware));
  toast('Quote copied');
}

function unique(values) { return [...new Set(values.filter(Boolean))]; }
function options(values, selected) { return values.map((v) => `<option ${v === selected ? 'selected' : ''}>${escapeHtml(v)}</option>`).join(''); }
function money(value) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0)); }
function formatDate(value) { return value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown'; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function slug(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
function toast(message) { const el = $('toast'); el.textContent = message; el.classList.remove('hidden'); clearTimeout(window.__toast); window.__toast = setTimeout(() => el.classList.add('hidden'), 2800); }
