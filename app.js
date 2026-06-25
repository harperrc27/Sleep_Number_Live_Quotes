// ─────────────────────────────────────────────────────────────────────────────
// Sleep Number Quote Studio — app.js
// ─────────────────────────────────────────────────────────────────────────────

const CATALOG_URL = 'data/catalog.json';
const CACHE_KEY   = 'sn_quote_catalog_v2';
const QUOTE_KEY   = 'sn_quote_draft_v2';

const SIZES = ['Twin', 'Twin XL', 'Full', 'Queen', 'King', 'Cal King', 'FlexTop King', 'Split King'];

const steps = [
  { id: 'customer',  title: 'Customer info' },
  { id: 'mattress',  title: 'Select mattress' },
  { id: 'size',      title: 'Select size' },
  { id: 'base',      title: 'Select base' },
  { id: 'hardware',  title: 'Furniture & hardware' },
  { id: 'bedding',   title: 'Bedding & pillows' },
  { id: 'plans',     title: 'Protection plan' },
  { id: 'promos',    title: 'Promos & discounts' },
];

let catalog = null;
let currentStep = 0;
let quote = loadQuote();
let deferredInstallPrompt = null;
let adminVisible = false;

const $ = (id) => document.getElementById(id);

// ── PWA install prompt ────────────────────────────────────────────────────────
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  $('installBtn').classList.remove('hidden');
});
$('installBtn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $('installBtn').classList.add('hidden');
});

// ── Navigation ────────────────────────────────────────────────────────────────
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
$('adminToggleBtn').addEventListener('click', () => {
  adminVisible = !adminVisible;
  $('adminPanel').classList.toggle('hidden', !adminVisible);
  $('adminToggleBtn').textContent = adminVisible ? 'Hide catalog health' : 'Catalog health';
  if (adminVisible) renderAdmin();
});

init();

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
  catalog = readSavedCatalog();
  updateCatalogStatus(catalog ? 'saved' : 'empty');
  render();
  await refreshCatalog(false);
}

// ── Catalog refresh ───────────────────────────────────────────────────────────
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
    if (adminVisible) renderAdmin();
    if (showToast) toast('Catalog refreshed and saved for offline use');
  } catch (err) {
    updateCatalogStatus(catalog ? 'saved' : 'error', err.message);
    if (showToast) toast(catalog ? 'Could not refresh. Using saved catalog.' : 'No catalog available yet.');
  }
}

function readSavedCatalog() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
}

function validateCatalog(data) {
  if (!data || !Array.isArray(data.products) || !Array.isArray(data.addons)) {
    throw new Error('Catalog missing required products/addons arrays');
  }
}

// ── Quote state ───────────────────────────────────────────────────────────────
function defaultQuote() {
  return {
    customerName: '',
    customerNotes: '',
    productId: null,
    size: null,
    baseId: 'none',
    hw: {
      completeBedSetup: null,
      hasHeadboard: null,
      headboardType: null,
      hasFootboard: null,
      hasSideRails: null,
      isPlatformBed: null,
      heightConcern: 'standard',
    },
    hardware: {},
    furniture: {},
    bedding: {},
    planId: 'none',
    toggles: {},
    customDiscount: 0,
    taxRate: 0,
  };
}

function loadQuote() {
  try { return { ...defaultQuote(), ...(JSON.parse(localStorage.getItem(QUOTE_KEY) || 'null') || {}) }; }
  catch { return defaultQuote(); }
}

function saveQuote() { localStorage.setItem(QUOTE_KEY, JSON.stringify(quote)); }

function normalizeQuoteAgainstCatalog() {
  if (!catalog) return;
  if (quote.productId && !catalog.products.some(p => p.id === quote.productId)) quote.productId = null;
  if (quote.baseId !== 'none' && !catalog.addons.some(a => a.id === quote.baseId)) quote.baseId = 'none';
  saveQuote();
}

// ── Main render ───────────────────────────────────────────────────────────────
function render() {
  if (!catalog) {
    $('stepBody').innerHTML = `<div class="empty-state"><h3>No catalog loaded</h3><p>Tap <strong>Refresh catalog</strong> while on unrestricted internet. The app will work offline after that.</p></div>`;
    updateChrome();
    renderSummary();
    return;
  }
  updateChrome();
  const step = steps[currentStep].id;
  const renderers = {
    customer:  renderCustomer,
    mattress:  renderMattress,
    size:      renderSize,
    base:      renderBase,
    hardware:  renderHardware,
    bedding:   renderBedding,
    plans:     renderPlans,
    promos:    renderPromos,
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
  $('nextBtn').textContent = currentStep === steps.length - 1 ? 'Review quote →' : 'Continue →';
}

function updateCatalogStatus(mode, detail = '') {
  const dot = $('statusDot');
  dot.className = 'status-dot';
  if (mode === 'loading') {
    $('catalogStatus').textContent = 'Refreshing catalog…';
    $('catalogMeta').textContent = 'Loading latest catalog snapshot.';
  } else if (mode === 'fresh') {
    dot.classList.add('good');
    $('catalogStatus').textContent = 'Catalog ready';
    $('catalogMeta').textContent = `Updated: ${formatDate(catalog?.lastUpdated)} · ${catalog?.products?.length ?? 0} mattresses`;
  } else if (mode === 'saved') {
    dot.classList.add('good');
    $('catalogStatus').textContent = 'Using saved catalog';
    $('catalogMeta').textContent = `Saved: ${formatDate(catalog?.lastUpdated)} · Works offline`;
  } else if (mode === 'error') {
    dot.classList.add('bad');
    $('catalogStatus').textContent = 'No catalog loaded';
    $('catalogMeta').textContent = detail || 'Refresh on unrestricted internet first.';
  } else {
    $('catalogStatus').textContent = 'No saved catalog';
    $('catalogMeta').textContent = 'Tap Refresh before going onto restricted Wi-Fi.';
  }
}

// ── Step: Customer ─────────────────────────────────────────────────────────────
function renderCustomer() {
  return `
    <p class="helper">Optional — enter customer name for quote summary.</p>
    <div class="form-grid">
      <label class="field">
        <span>Customer name</span>
        <input type="text" data-field="customerName" value="${escapeHtml(quote.customerName || '')}" placeholder="e.g. Smith family">
      </label>
      <label class="field">
        <span>Notes (internal)</span>
        <input type="text" data-field="customerNotes" value="${escapeHtml(quote.customerNotes || '')}" placeholder="Room, delivery, preferences…">
      </label>
    </div>`;
}

// ── Step: Mattress ─────────────────────────────────────────────────────────────
function renderMattress() {
  const products = catalog.products.filter(p => p.category === 'mattress');
  return `<div class="grid">${products.map(p => {
    const qPrice  = quote.size ? (p.pricing?.[quote.size] || 0) : 0;
    const rPrice  = quote.size ? (p.retailPricing?.[quote.size] || 0) : 0;
    const hasSave = qPrice > 0 && rPrice > qPrice;
    return `<div class="card-option ${quote.productId === p.id ? 'selected' : ''}" data-id="${p.id}">
      ${p.badge ? `<span class="badge badge-top">${escapeHtml(p.badge)}</span>` : ''}
      <h3>${escapeHtml(p.name)}</h3>
      <p>${escapeHtml(p.series)}</p>
      <p class="card-desc">${escapeHtml(p.description || '')}</p>
      <span class="price-label">${escapeHtml(qPrice ? money(qPrice) : 'From ' + money(minPrice(p.pricing)))}</span>
      ${hasSave ? `<s class="was-price">${escapeHtml(money(rPrice))}</s>` : ''}
      ${p.verificationRequired ? '<span class="badge badge-verify">Verify price</span>' : ''}
    </div>`;
  }).join('')}</div>`;
}

// ── Step: Size ─────────────────────────────────────────────────────────────────
function renderSize() {
  if (!quote.productId) {
    return `<p class="helper">Select a mattress first, then come back to choose the size.</p>`;
  }
  const product = catalog.products.find(p => p.id === quote.productId);
  const availSizes = product?.pricing ? Object.keys(product.pricing) : SIZES;
  return `
    <p class="helper">Sizes available for the <strong>${escapeHtml(product?.name || '')}</strong>:</p>
    <div class="grid">${availSizes.map(sz => {
      const price = product?.pricing?.[sz];
      const retail = product?.retailPricing?.[sz];
      const save = retail && price && retail > price ? retail - price : 0;
      return `<div class="card-option ${quote.size === sz ? 'selected' : ''}" data-size="${sz}">
        <h3>${escapeHtml(sz)}</h3>
        ${price ? `<span class="price-label">${money(price)}</span>` : ''}
        ${save ? `<span class="badge badge-savings">Save ${money(save)}</span>` : ''}
        ${product?.verificationRequired ? '<span class="badge badge-verify">Verify</span>' : ''}
      </div>`;
    }).join('')}</div>`;
}

// ── Step: Base ─────────────────────────────────────────────────────────────────
function renderBase() {
  const bases = [
    { id: 'none', category: 'none', name: 'No base / I have my own', description: 'Skip base — using existing support or third-party frame.', price: 0 },
    ...catalog.addons.filter(a => ['foundation', 'adjustable-base', 'integrated-base'].includes(a.category)),
  ];
  return `<div class="grid">${bases.map(b => {
    const isSelected = quote.baseId === b.id;
    const feats = b.features?.length ? `<ul class="feature-list">${b.features.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : '';
    return `<div class="card-option ${isSelected ? 'selected' : ''}" data-base="${b.id}">
      ${b.category !== 'none' ? `<span class="badge cat-badge">${escapeHtml(categoryLabel(b.category))}</span>` : ''}
      <h3>${escapeHtml(b.name)}</h3>
      <p>${escapeHtml(b.description || '')}</p>
      ${feats}
      ${b.price ? `<span class="price-label">${money(b.price)}</span>` : ''}
      ${b.verificationRequired ? '<span class="badge badge-verify">Verify price</span>' : ''}
    </div>`;
  }).join('')}</div>`;
}

// ── Step: Hardware wizard ──────────────────────────────────────────────────────
function renderHardware() {
  const base = addonById(quote.baseId);
  const isAdj = base?.category === 'adjustable-base';
  const isIntegrated = base?.category === 'integrated-base';
  const hw = quote.hw || {};

  const recs = getHardwareRecommendations();
  const recSection = recs.length ? `
    <div class="recs-section">
      <h3>Recommendations</h3>
      ${recs.map(r => recCard(r)).join('')}
    </div>` : '';

  const furnitureItems = catalog.addons.filter(a => a.category === 'furniture');
  const hardwareItems  = catalog.addons.filter(a => a.category === 'hardware');

  return `
    <div class="hw-wizard">
      <h3 class="wizard-section-title">Setup questions</h3>
      <p class="helper">Answer these to get smart hardware recommendations.</p>

      ${radioGroup('completeBedSetup', 'Are you selling a complete bed setup?', [
        ['yes',     'Yes — complete setup'],
        ['no',      'No — partial / add-on only'],
        ['unknown', 'Not sure yet'],
      ], hw.completeBedSetup)}

      ${radioGroup('hasHeadboard', 'Headboard?', [
        ['yes', 'Yes — adding one'],
        ['no',  'No headboard'],
      ], hw.hasHeadboard)}

      ${hw.hasHeadboard === 'yes' ? radioGroup('headboardType', 'What type of headboard?', [
        ['sleep-number',  'Sleep Number headboard'],
        ['third-party',   'Third-party / customer\'s own'],
        ['unknown',       'Unknown / to be determined'],
      ], hw.headboardType) : ''}

      ${radioGroup('hasFootboard', 'Footboard?', [
        ['yes', 'Yes'],
        ['no',  'No'],
      ], hw.hasFootboard)}

      ${radioGroup('hasSideRails', 'Side rails?', [
        ['yes', 'Yes'],
        ['no',  'No'],
      ], hw.hasSideRails)}

      ${radioGroup('isPlatformBed', 'Platform bed or slatted frame?', [
        ['yes', 'Yes'],
        ['no',  'No'],
      ], hw.isPlatformBed)}

      ${radioGroup('heightConcern', 'Bed height preference?', [
        ['standard', 'Standard height'],
        ['higher',   'Customer wants it higher'],
        ['lower',    'Customer wants it lower'],
      ], hw.heightConcern || 'standard')}
    </div>

    ${recSection}

    <h3 class="wizard-section-title" style="margin-top:1.5rem">Sleep Number furniture</h3>
    ${quantityGrid(furnitureItems, 'furniture')}

    <h3 class="wizard-section-title" style="margin-top:1.5rem">Hardware & replacement parts</h3>
    ${quantityGrid(hardwareItems, 'hardware')}
  `;
}

function radioGroup(field, label, choices, current) {
  return `
    <div class="radio-group">
      <p class="radio-label">${escapeHtml(label)}</p>
      <div class="radio-row">${choices.map(([val, text]) => `
        <label class="radio-chip ${current === val ? 'active' : ''}">
          <input type="radio" name="hw_${field}" data-hw="${field}" value="${escapeHtml(val)}" ${current === val ? 'checked' : ''}>
          ${escapeHtml(text)}
        </label>`).join('')}
      </div>
    </div>`;
}

function recCard(rec) {
  const product = rec.productId ? addonById(rec.productId) : null;
  const badgeClass = {
    recommended: 'badge-rec',
    warning:     'badge-warn',
    verify:      'badge-verify',
  }[rec.recommendation] || 'badge-rec';
  const label = {
    recommended: '✓ Recommended',
    warning:     '⚠ Compatibility warning',
    verify:      '⊙ Verify in store',
  }[rec.recommendation] || rec.recommendation;
  return `
    <div class="rec-card rec-${rec.recommendation}">
      <span class="badge ${badgeClass}">${label}</span>
      <p>${escapeHtml(rec.message)}</p>
      ${product ? `<div class="rec-product">
        <strong>${escapeHtml(product.name)}</strong>
        <span>${money(product.price)}</span>
        <button class="btn-add-rec secondary" data-add-rec="${product.id}">+ Add to quote</button>
      </div>` : ''}
    </div>`;
}

// ── Step: Bedding ──────────────────────────────────────────────────────────────
function renderBedding() {
  const pillows  = catalog.addons.filter(a => a.category === 'pillow');
  const bedding  = catalog.addons.filter(a => a.category === 'bedding');
  return `
    <h3 class="wizard-section-title">Pillows</h3>
    ${quantityGrid(pillows, 'bedding')}
    <h3 class="wizard-section-title" style="margin-top:1.5rem">Bedding</h3>
    ${quantityGrid(bedding, 'bedding')}
  `;
}

// ── Step: Plans ────────────────────────────────────────────────────────────────
function renderPlans() {
  const plans = [
    { id: 'none', category: 'none', name: 'No protection plan', description: 'Skip protection plan.', price: 0 },
    ...catalog.addons.filter(a => a.category === 'protection-plan'),
  ];
  return `<div class="grid">${plans.map(p => `
    <div class="card-option ${quote.planId === p.id ? 'selected' : ''}" data-plan="${p.id}">
      <h3>${escapeHtml(p.name)}</h3>
      <p>${escapeHtml(p.description || '')}</p>
      <span class="price-label">${p.price ? money(p.price) : 'No charge'}</span>
      ${p.verificationRequired ? '<span class="badge badge-verify">Verify price</span>' : ''}
    </div>`).join('')}</div>`;
}

// ── Step: Promos ───────────────────────────────────────────────────────────────
function renderPromos() {
  const calc = calculateQuote();
  const autoSection = calc.automaticPromos.length
    ? calc.automaticPromos.map(p => `<div class="promo-item promo-auto">
        <span class="badge badge-rec">Auto-applied</span>
        <strong>${escapeHtml(p.name)}</strong>
        <span class="promo-amount">-${money(p.amount)}</span>
        ${p.verificationRequired ? '<p class="promo-verify">⚠ Verify eligibility before quoting</p>' : ''}
      </div>`).join('')
    : '<div class="promo-item">No automatic promos qualify yet. Add a mattress + base to unlock.</div>';

  const togglePromos = catalog.promos.filter(p => p.type === 'toggle' || p.type === 'manual');
  return `
    <h3>Auto-applied savings</h3>
    <div class="promo-list">${autoSection}</div>

    <h3 style="margin-top:1rem">Conditional promos &amp; overrides</h3>
    <div class="toggle-list">${togglePromos.map(p => `
      <label class="toggle-row">
        <input type="checkbox" data-promo-toggle="${p.id}" ${quote.toggles[p.id] ? 'checked' : ''}>
        <span>
          <strong>${escapeHtml(p.name)}</strong>
          ${p.customerQualificationRequired ? '<span class="badge badge-verify">ID required</span>' : ''}
          ${p.verificationRequired ? '<span class="badge badge-warn">Verify</span>' : ''}
          <p>${escapeHtml(p.description || '')}</p>
        </span>
      </label>`).join('')}
    </div>

    <div class="form-grid" style="margin-top:1rem">
      <label class="field">
        <span>Manager-approved discount ($)</span>
        <input type="number" min="0" step="1" data-field="customDiscount" value="${quote.customDiscount || 0}">
      </label>
      <label class="field">
        <span>Estimated tax rate (%)</span>
        <input type="number" min="0" step=".01" data-field="taxRate" value="${quote.taxRate || 0}">
      </label>
    </div>`;
}

// ── Quantity grid helper ───────────────────────────────────────────────────────
function quantityGrid(items, bucket) {
  if (!items.length) return '<p class="helper">No items in this section yet.</p>';
  return `<div class="grid">${items.map(item => {
    const qty = quote[bucket]?.[item.id] || 0;
    return `<div class="card-option ${qty ? 'selected' : ''}">
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.description || item.category)}</p>
      <span class="price-label">${money(item.price)} each</span>
      ${item.verificationRequired ? '<span class="badge badge-verify">Verify price</span>' : ''}
      <div class="qty-row">
        <button data-qty-minus="${bucket}:${item.id}" class="secondary">−</button>
        <span>${qty}</span>
        <button data-qty-plus="${bucket}:${item.id}">+</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

// ── Admin panel ────────────────────────────────────────────────────────────────
function renderAdmin() {
  if (!catalog) { $('adminPanel').innerHTML = '<p class="helper">No catalog loaded.</p>'; return; }
  const sources = catalog.sourceResults || [];
  const failed  = sources.filter(s => !s.ok);
  const warnings = [];
  if (!sources.length) warnings.push('No live sources configured. Prices are sample data.');
  const lowConf = catalog.products.filter(p => (p.confidenceScore ?? 1) < 0.7);
  const verReq  = catalog.products.filter(p => p.verificationRequired);

  $('adminPanel').innerHTML = `
    <div class="admin-grid">
      <div class="admin-stat"><span class="stat-num">${catalog.products.length}</span><span>Mattresses</span></div>
      <div class="admin-stat"><span class="stat-num">${catalog.addons.length}</span><span>Add-ons</span></div>
      <div class="admin-stat"><span class="stat-num">${catalog.promos.length}</span><span>Promos</span></div>
      <div class="admin-stat"><span class="stat-num">${catalog.hardwareRules?.length ?? 0}</span><span>HW rules</span></div>
    </div>
    <p><strong>Last updated:</strong> ${formatDate(catalog.lastUpdated)}</p>
    <p><strong>Schema version:</strong> ${catalog.schemaVersion ?? 1}</p>
    ${catalog.metadata?.note ? `<p class="admin-note">${escapeHtml(catalog.metadata.note)}</p>` : ''}
    ${warnings.map(w => `<p class="admin-warn">⚠ ${escapeHtml(w)}</p>`).join('')}
    ${verReq.length ? `<p class="admin-note">🔍 ${verReq.length} products marked "verification required".</p>` : ''}
    ${lowConf.length ? `<p class="admin-note">📉 ${lowConf.length} products have low confidence scores.</p>` : ''}
    ${failed.length ? `<p class="admin-warn">⛔ ${failed.length} source(s) failed last refresh.</p>
      <ul>${failed.map(s => `<li>${escapeHtml(s.name)}: ${escapeHtml(s.error)}</li>`).join('')}</ul>` : ''}
    <p><strong>Sources:</strong> ${sources.length ? sources.map(s => `${escapeHtml(s.name)} ${s.ok ? '✓' : '✗'}`).join(', ') : 'None configured'}</p>
    <p><strong>Source notes:</strong> ${escapeHtml(catalog.sourceNotes || 'None')}</p>
  `;
}

// ── Event binding ─────────────────────────────────────────────────────────────
function bindStepEvents(step) {
  // Mattress cards
  document.querySelectorAll('.card-option[data-id]').forEach(card => {
    card.addEventListener('click', () => {
      quote.productId = card.dataset.id;
      quote.size = null; // reset size when mattress changes
      saveQuote(); render();
    });
  });
  // Size cards
  document.querySelectorAll('.card-option[data-size]').forEach(card => {
    card.addEventListener('click', () => {
      quote.size = card.dataset.size;
      saveQuote(); render();
    });
  });
  // Base cards
  document.querySelectorAll('.card-option[data-base]').forEach(card => {
    card.addEventListener('click', () => {
      quote.baseId = card.dataset.base;
      saveQuote(); render();
    });
  });
  // Plan cards
  document.querySelectorAll('.card-option[data-plan]').forEach(card => {
    card.addEventListener('click', () => {
      quote.planId = card.dataset.plan;
      saveQuote(); render();
    });
  });
  // Text/number fields
  document.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      const k = input.dataset.field;
      quote[k] = input.type === 'number' ? Number(input.value || 0) : input.value;
      saveQuote(); render();
    });
  });
  // HW radio buttons
  document.querySelectorAll('[data-hw]').forEach(radio => {
    radio.addEventListener('change', () => {
      quote.hw = quote.hw || {};
      quote.hw[radio.dataset.hw] = radio.value;
      saveQuote(); render();
    });
  });
  // Promo toggles
  document.querySelectorAll('[data-promo-toggle]').forEach(chk => {
    chk.addEventListener('change', () => {
      quote.toggles[chk.dataset.promoToggle] = chk.checked;
      saveQuote(); render();
    });
  });
  // Qty +/-
  document.querySelectorAll('[data-qty-plus]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); changeQty(e.currentTarget.dataset.qtyPlus, 1); }));
  document.querySelectorAll('[data-qty-minus]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); changeQty(e.currentTarget.dataset.qtyMinus, -1); }));
  // Add hardware recommendation to quote
  document.querySelectorAll('[data-add-rec]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.addRec;
      quote.hardware = quote.hardware || {};
      quote.hardware[id] = (quote.hardware[id] || 0) + 1;
      saveQuote(); render();
      toast('Added to quote');
    });
  });
}

function changeQty(token, delta) {
  const [bucket, id] = token.split(':');
  quote[bucket] ||= {};
  quote[bucket][id] = Math.max(0, (quote[bucket][id] || 0) + delta);
  if (!quote[bucket][id]) delete quote[bucket][id];
  saveQuote();
  render();
}

// ── Summary panel ─────────────────────────────────────────────────────────────
function renderSummary() {
  const calc = calculateQuote();
  $('totalDue').textContent   = money(calc.total);
  $('savingsPill').textContent = money(calc.savings) + ' saved';
  $('miniSummary').innerHTML  = calc.lines.length
    ? calc.lines.map(l => `<div class="summary-line"><span>${escapeHtml(l.label)}</span><strong>${l.amount < 0 ? '-' : ''}${money(Math.abs(l.amount))}</strong></div>`).join('')
    : '<p class="helper">Start selecting options to build a quote.</p>';
  const allPromos = [...calc.automaticPromos, ...calc.togglePromos];
  $('promoList').innerHTML = allPromos.length
    ? allPromos.map(p => `<div class="promo-item"><strong>${escapeHtml(p.name)}</strong><span class="promo-amount">-${money(p.amount)}</span></div>`).join('')
    : '<div class="promo-item promo-empty">Promos will appear here.</div>';
  // Warnings
  const recs = getHardwareRecommendations();
  const warns = recs.filter(r => r.recommendation === 'warning');
  $('warningBar').innerHTML = warns.length
    ? warns.map(w => `<div class="warning-item">⚠ ${escapeHtml(w.message)}</div>`).join('')
    : '';
  $('warningBar').classList.toggle('hidden', !warns.length);
}

// ── Quote math ────────────────────────────────────────────────────────────────
export function calculateQuote(q, cat) {
  // Allow external callers (tests) to pass quote/catalog directly
  const _q   = q   || quote;
  const _cat = cat || catalog;
  if (!_cat) return { lines: [], subtotal: 0, savings: 0, total: 0, automaticPromos: [], togglePromos: [] };

  const lines = [];
  let subtotal = 0;
  let savings  = 0;

  const product = _cat.products?.find(p => p.id === _q.productId);
  if (product && _q.size) {
    const saleP   = product.pricing?.[_q.size];
    const retailP = product.retailPricing?.[_q.size];
    if (saleP) {
      lines.push({ label: `${product.name} (${_q.size})`, amount: saleP });
      subtotal += saleP;
      if (retailP && retailP > saleP) savings += retailP - saleP;
    }
  } else if (product) {
    const price = minPrice(product.pricing);
    if (price) {
      lines.push({ label: `${product.name} (size TBD)`, amount: price });
      subtotal += price;
    }
  }

  const base = addonByIdCat(_q.baseId, _cat);
  if (base && base.id !== 'none' && base.price) {
    lines.push({ label: base.name, amount: base.price });
    subtotal += base.price;
  }

  for (const bucket of ['furniture', 'hardware', 'bedding']) {
    Object.entries(_q[bucket] || {}).forEach(([id, qty]) => {
      const item = addonByIdCat(id, _cat);
      if (item && qty && item.price) {
        lines.push({ label: `${item.name} × ${qty}`, amount: item.price * qty });
        subtotal += item.price * qty;
      }
    });
  }

  const plan = addonByIdCat(_q.planId, _cat);
  if (plan && plan.id !== 'none' && plan.price) {
    lines.push({ label: plan.name, amount: plan.price });
    subtotal += plan.price;
  }

  const { automatic, toggles } = getAppliedPromosFor(_q, _cat, subtotal);
  const promoDisc  = [...automatic, ...toggles].reduce((s, p) => s + p.amount, 0);
  const customDisc = Number(_q.customDiscount || 0);
  if (customDisc > 0) lines.push({ label: 'Approved discount', amount: -customDisc });

  const taxRate  = Number(_q.taxRate || 0) / 100;
  const taxable  = Math.max(0, subtotal - promoDisc - customDisc);
  const tax      = Math.round(taxable * taxRate);
  if (tax > 0) lines.push({ label: 'Estimated tax', amount: tax });

  const total = Math.max(0, taxable + tax);
  return {
    lines,
    subtotal,
    savings: savings + promoDisc + customDisc,
    total,
    automaticPromos: automatic,
    togglePromos:    toggles,
  };
}

export function getAppliedPromosFor(q, cat, subtotal) {
  if (!cat) return { automatic: [], toggles: [] };
  const cats = selectedCategorySetFor(q, cat);
  const automatic = [];
  const toggles   = [];
  for (const promo of (cat.promos || [])) {
    if (promo.type === 'automatic' && promoQualifies(promo, q, cats, subtotal))
      automatic.push(resolvePromo(promo, subtotal));
    if (promo.type === 'toggle' && q.toggles?.[promo.id])
      toggles.push(resolvePromo(promo, subtotal));
  }
  return { automatic, toggles };
}

function getAppliedPromos(subtotal) {
  return getAppliedPromosFor(quote, catalog, subtotal ?? calculateBareSubtotal());
}

function calculateBareSubtotal() {
  let t = 0;
  const p = catalog?.products?.find(x => x.id === quote.productId);
  if (p && quote.size) t += p.pricing?.[quote.size] || 0;
  else if (p) t += minPrice(p.pricing) || 0;
  const base = addonById(quote.baseId); if (base && base.id !== 'none') t += base.price || 0;
  const plan = addonById(quote.planId); if (plan && plan.id !== 'none') t += plan.price || 0;
  for (const bucket of ['furniture', 'hardware', 'bedding'])
    Object.entries(quote[bucket] || {}).forEach(([id, qty]) => {
      const item = addonById(id); if (item) t += (item.price || 0) * qty;
    });
  return t;
}

export function promoQualifies(promo, q, cats, subtotal) {
  const rules = promo.conditions || {};
  if (rules.minimumSubtotal && subtotal < rules.minimumSubtotal) return false;
  if (rules.requiresProduct && !q.productId) return false;
  if (rules.requiresCategories && !rules.requiresCategories.every(c => cats.has(c))) return false;
  if (rules.requiresAddonId && q.baseId !== rules.requiresAddonId) return false;
  return true;
}

function resolvePromo(promo, subtotal) {
  const amt = promo.discountAmount
    ? promo.discountAmount
    : Math.round(subtotal * ((promo.discountPercent || 0) / 100));
  return { ...promo, amount: Math.min(amt, subtotal) };
}

function selectedCategorySetFor(q, cat) {
  const set = new Set();
  if (q.productId) set.add('mattress');
  const base = addonByIdCat(q.baseId, cat); if (base) set.add(base.category);
  const plan = addonByIdCat(q.planId, cat); if (plan) set.add(plan.category);
  for (const bucket of ['furniture', 'hardware', 'bedding'])
    Object.keys(q[bucket] || {}).forEach(id => { const item = addonByIdCat(id, cat); if (item) set.add(item.category); });
  return set;
}

// ── Hardware rules engine ─────────────────────────────────────────────────────
export function getHardwareRecommendations(q, cat) {
  const _q   = q   || quote;
  const _cat = cat || catalog;
  if (!_cat) return [];
  const hw      = _q.hw || {};
  const base    = addonByIdCat(_q.baseId, _cat);
  const isAdj   = base?.category === 'adjustable-base';
  const isInteg = base?.category === 'integrated-base';
  const noBase  = !_q.baseId || _q.baseId === 'none';
  const sz      = _q.size || '';

  const recs = [];
  const rules = _cat.hardwareRules || [];

  for (const rule of rules) {
    const c = rule.conditions || {};
    let match = true;

    if (c.baseCategories) {
      const bc = base?.category;
      if (!c.baseCategories.includes(bc)) match = false;
    }
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

// ── Copy / summary ────────────────────────────────────────────────────────────
async function copyQuote() {
  const calc    = calculateQuote();
  const product = catalog?.products?.find(p => p.id === quote.productId);
  const base    = addonById(quote.baseId);
  const plan    = addonById(quote.planId);
  const recs    = getHardwareRecommendations();
  const warns   = recs.filter(r => r.recommendation === 'warning');
  const customer = quote.customerName ? `Customer: ${quote.customerName}` : '';

  const lines = [
    '═══════════════════════════════════',
    'SLEEP NUMBER QUOTE SUMMARY',
    '═══════════════════════════════════',
    customer,
    customer ? '───────────────────────────────────' : '',
    `Mattress: ${product ? `${product.name} (${quote.size || 'size TBD'})` : 'Not selected'}`,
    `Base: ${base && base.id !== 'none' ? base.name : 'None / own base'}`,
    `Protection: ${plan && plan.id !== 'none' ? plan.name : 'None'}`,
    '',
    '─── Line items ────────────────────',
    ...calc.lines.map(l => `${l.label}: ${l.amount < 0 ? '-' : ''}${money(Math.abs(l.amount))}`),
    '',
    `Subtotal before savings: ${money(calc.subtotal)}`,
    `Estimated savings: ${money(calc.savings)}`,
    `Estimated total: ${money(calc.total)}`,
    '',
    warns.length ? '─── Compatibility warnings ─────────' : '',
    ...warns.map(w => `⚠ ${w.message}`),
    warns.length ? '' : '',
    '─── Notes ──────────────────────────',
    'Prices are approximate. Verify all pricing, promotions,',
    'and availability before purchase.',
    quote.customerNotes ? `Internal notes: ${quote.customerNotes}` : '',
    '',
    `Catalog updated: ${formatDate(catalog?.lastUpdated)}`,
    '═══════════════════════════════════',
  ].filter(l => l !== undefined && !(l === '' && false)).join('\n');

  try {
    await navigator.clipboard.writeText(lines);
    toast('Quote copied to clipboard');
  } catch {
    toast('Could not copy — check browser permissions');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function addonById(id)          { return catalog?.addons?.find(a => a.id === id); }
function addonByIdCat(id, cat)  { return cat?.addons?.find(a => a.id === id); }
function minPrice(pricingObj)   { if (!pricingObj) return 0; const vals = Object.values(pricingObj).filter(v => v > 0); return vals.length ? Math.min(...vals) : 0; }
function categoryLabel(cat)     { return { 'adjustable-base': 'Adjustable', 'integrated-base': 'Integrated', 'foundation': 'Foundation', 'furniture': 'Furniture', 'hardware': 'Hardware' }[cat] || cat; }
function money(v)               { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(v || 0)); }
function formatDate(v)          { return v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown'; }
function escapeHtml(v)          { return String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function toast(msg)             { const el = $('toast'); el.textContent = msg; el.classList.remove('hidden'); clearTimeout(window.__toast); window.__toast = setTimeout(() => el.classList.add('hidden'), 2800); }
