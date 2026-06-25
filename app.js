const CATALOG_URL = 'data/catalog.json';
const CACHE_KEY = 'sleep_quote_catalog_v2';
const QUOTE_KEY = 'sleep_quote_draft_v2';

const steps = [
  { id: 'start', title: 'Size & type', sub: 'Pick a size, then a bed type', pill: 'Start' },
  { id: 'series', title: 'Choose the bed', sub: 'Compatible smart beds for your size', pill: 'Bed', single: true },
  { id: 'base', title: 'Choose a base', sub: 'Bases that fit your bed', pill: 'Base', single: true },
  { id: 'furniture', title: 'Add furniture', sub: 'Three collections — optional', pill: 'Furniture', optional: true },
  { id: 'hardware', title: 'Hardware', sub: 'Brackets, legs & remotes — only if needed', pill: 'Hardware', optional: true },
  { id: 'bedding', title: 'Sheets & bedding', sub: 'Optional — add or pass', pill: 'Bedding', optional: true },
  { id: 'pillows', title: 'Pillows', sub: 'Optional — add or pass', pill: 'Pillows', optional: true },
  { id: 'pads', title: 'Mattress pads & protection', sub: 'Optional — add or pass', pill: 'Pads', optional: true },
  { id: 'delivery', title: 'Delivery', sub: 'Choose how it arrives', pill: 'Delivery', single: true },
  { id: 'warranty', title: 'Warranty', sub: "What's included", pill: 'Warranty' },
  { id: 'discounts', title: 'Discounts & tax', sub: 'Apply discounts, set tax', pill: 'Discounts' },
  { id: 'quote', title: 'Quote & compare', sub: 'Review, hot-swap and compare', pill: 'Quote' }
];

let catalog = null;
let currentStep = 0;
let quote = loadQuote();
let deferredInstallPrompt = null;
let advanceTimer = null;

const $ = (id) => document.getElementById(id);

function defaultQuote() {
  return {
    size: null, typeId: null, brandId: null, productId: null,
    baseId: null, furniture: {}, hardware: {}, sheets: {}, pillows: {}, pads: {},
    deliveryId: null, disposal: {}, toggles: {}, customDiscount: 0, taxRate: null,
    comparisons: []
  };
}
function loadQuote() {
  try { return { ...defaultQuote(), ...(JSON.parse(localStorage.getItem(QUOTE_KEY)) || {}) }; }
  catch { return defaultQuote(); }
}
function saveQuote() { localStorage.setItem(QUOTE_KEY, JSON.stringify(quote)); }

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstallPrompt = e; $('installBtn').classList.remove('hidden'); });
$('installBtn').addEventListener('click', async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $('installBtn').classList.add('hidden'); });

$('refreshCatalogBtn').addEventListener('click', () => refreshCatalog(true));
$('backBtn').addEventListener('click', back);
$('nextBtn').addEventListener('click', advance);
$('copyQuoteBtn').addEventListener('click', copyQuote);
$('barNext').addEventListener('click', () => { if (steps[currentStep].id === 'quote') copyQuote(); else advance(); });
$('resetBtn').addEventListener('click', () => { quote = defaultQuote(); currentStep = 0; saveQuote(); render(); toast('Quote reset'); });
document.addEventListener('keydown', onKeydown);

queueMicrotask(init);

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

function canLeave(stepId) {
  if (stepId === 'start') return !!(quote.size && quote.typeId);
  if (stepId === 'series') return !!quote.productId;
  return true;
}
function advance() {
  clearTimeout(advanceTimer);
  if (!canLeave(steps[currentStep].id)) { toast(steps[currentStep].id === 'start' ? 'Pick a size and a type' : 'Pick a bed to continue'); return; }
  if (currentStep < steps.length - 1) { currentStep += 1; render(); }
}
function back() { clearTimeout(advanceTimer); if (currentStep > 0) { currentStep -= 1; render(); } }
function goToStep(i) {
  clearTimeout(advanceTimer);
  const target = Math.max(0, Math.min(steps.length - 1, i));
  // don't allow jumping past an incomplete required step
  for (let s = 0; s < target; s++) if (!canLeave(steps[s].id)) { currentStep = s; render(); toast('Finish this step first'); return; }
  currentStep = target; render();
}

async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(() => {});
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
    const next = await res.json();
    validateCatalog(next);
    catalog = next;
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    if (quote.taxRate == null) quote.taxRate = catalog.taxRateDefault ?? 0;
    updateCatalogStatus('fresh');
    normalizeQuote();
    render();
    if (showToast) toast('Catalog refreshed and saved offline');
  } catch (err) {
    updateCatalogStatus(catalog ? 'saved' : 'error', err.message);
    if (showToast) toast(catalog ? 'Could not refresh. Using saved catalog.' : 'No catalog available yet.');
  }
}
function readSavedCatalog() { try { const r = localStorage.getItem(CACHE_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function validateCatalog(d) { if (!d || !Array.isArray(d.brands) || !Array.isArray(d.products) || !Array.isArray(d.types)) throw new Error('Catalog missing required sections'); }

function normalizeQuote() {
  if (!catalog) return;
  if (quote.productId && !catalog.products.some((p) => p.id === quote.productId)) quote.productId = null;
  if (quote.typeId && !catalog.types.some((t) => t.id === quote.typeId)) { quote.typeId = null; quote.brandId = null; }
  if (quote.taxRate == null) quote.taxRate = catalog.taxRateDefault ?? 0;
  saveQuote();
}

function render() {
  if (!catalog) {
    $('stepBody').innerHTML = `<div class="empty-state"><h3>No catalog yet</h3><p>Press Refresh while online. After that this app works offline.</p></div>`;
    updateChrome(); renderSummary(); return;
  }
  updateChrome();
  const id = steps[currentStep].id;
  const r = {
    start: renderStart, series: renderSeries, base: renderBase, furniture: renderFurniture,
    hardware: renderHardware, bedding: renderBedding, pillows: renderPillows, pads: renderPads,
    delivery: renderDelivery, warranty: renderWarranty, discounts: renderDiscounts, quote: renderQuote
  }[id];
  $('stepBody').innerHTML = r();
  bindStepEvents(id);
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
  const host = $('stepPills'); if (!host) return;
  host.innerHTML = steps.map((s, i) => {
    const done = isStepComplete(s.id);
    const cls = ['pill', i === currentStep ? 'active' : '', done ? 'done' : ''].filter(Boolean).join(' ');
    return `<button class="${cls}" data-step="${i}"><span class="pill-num">${done ? '✓' : i + 1}</span>${escapeHtml(s.pill)}</button>`;
  }).join('');
  host.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => goToStep(Number(b.dataset.step))));
}
function isStepComplete(id) {
  switch (id) {
    case 'start': return !!(quote.size && quote.typeId);
    case 'series': return !!quote.productId;
    case 'base': return !!quote.baseId;
    case 'furniture': return anyQty(quote.furniture);
    case 'hardware': return anyQty(quote.hardware);
    case 'bedding': return anyQty(quote.sheets);
    case 'pillows': return anyQty(quote.pillows);
    case 'pads': return anyQty(quote.pads);
    case 'delivery': return !!quote.deliveryId;
    default: return false;
  }
}
function anyQty(obj) { return Object.values(obj || {}).some(Boolean); }

function updateCatalogStatus(mode, detail = '') {
  const dot = $('statusDot'); dot.className = 'status-dot';
  const meta = $('catalogMeta');
  if (mode === 'loading') { $('catalogStatus').textContent = 'Refreshing…'; meta.textContent = 'Loading the latest catalog.'; }
  else if (mode === 'fresh') { dot.classList.add('good'); $('catalogStatus').textContent = 'Catalog ready'; meta.textContent = `Updated ${formatDate(catalog?.lastUpdated)} • ${catalog?.products?.length || 0} beds priced live`; }
  else if (mode === 'saved') { dot.classList.add('good'); $('catalogStatus').textContent = 'Saved catalog'; meta.textContent = `Saved ${formatDate(catalog?.lastUpdated)} • Works offline`; }
  else if (mode === 'error') { dot.classList.add('bad'); $('catalogStatus').textContent = 'No catalog'; meta.textContent = detail || 'Refresh once online.'; }
  else { $('catalogStatus').textContent = 'No saved catalog'; meta.textContent = 'Refresh once before working offline.'; }
}

// ---------- price helpers ----------
const money = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(v || 0));
const money2 = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v || 0));
function bedById(id) { return catalog?.products?.find((p) => p.id === id); }
function selectedBed() { return bedById(quote.productId); }
function sizeSale(item, size) {
  if (!item) return 0;
  if (item.perSize && size && item.perSize[size]) return item.perSize[size].sale;
  return item.fromSale ?? item.sale ?? item.price ?? 0;
}
function sizeRetail(item, size) {
  if (!item) return 0;
  if (item.perSize && size && item.perSize[size]) return item.perSize[size].retail;
  return item.fromRetail ?? item.retail ?? item.price ?? 0;
}
function sizeAvailable(item, size) { return !!(item && item.perSize && size && item.perSize[size]); }
function basesForBrand(brandId) { return (catalog.basesByBrand && catalog.basesByBrand[brandId]) || []; }
function baseRequired(brandId) { return (catalog.baseRequiredBrands || []).includes(brandId); }
function includedBaseFor(model) { return (catalog.modelIncludedBase || {})[model] || null; }
function basePriceById(id, size) {
  const bed = selectedBed(); if (!bed) return 0;
  const b = basesForBrand(bed.brandId).find((x) => x.id === id);
  if (!b) return 0;
  return b.perSize ? (b.perSize[size]?.sale ?? b.fromSale ?? 0) : (b.price ?? 0);
}

// ---------- card builders ----------
function priceTag(retail, sale, fromLabel) {
  const save = Math.max(0, Math.round(retail - sale));
  const pct = save && retail ? Math.round((save / retail) * 100) : 0;
  const pre = fromLabel ? '<span class="from">from </span>' : '';
  const strike = save ? `<span class="was">${money(retail)}</span>` : '';
  const tag = save ? `<span class="save-tag">Save ${money(save)}${pct ? ` · ${pct}%` : ''}</span>` : '';
  return `<div class="price-block">${pre}<span class="now">${money(sale)}</span>${strike}${tag}</div>`;
}
function optionCard({ id, index, title, subtitle, selected, extra = '' }) {
  const key = index != null && index < 9 ? `<kbd class="pick-key">${index + 1}</kbd>` : '';
  return `<div class="card-option ${selected ? 'selected' : ''}" data-id="${id}" data-pick>${key}<span class="check">✓</span>${extra}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle || '')}</p></div>`;
}
function qtyCard({ bucket, id, index, title, sub, priceHtml, note }) {
  const qty = quote[bucket]?.[id] || 0;
  const key = index != null && index < 9 ? `<kbd class="pick-key">${index + 1}</kbd>` : '';
  return `<div class="card-option qty-card ${qty ? 'selected' : ''}" data-pick data-qty-add="${bucket}:${id}">
    ${key}${priceHtml || ''}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(sub || '')}</p>${note ? `<p class="note">${escapeHtml(note)}</p>` : ''}
    <div class="qty-row"><button class="secondary" data-qty-minus="${bucket}:${id}">−</button><span>${qty}</span><button data-qty-plus="${bucket}:${id}">+</button></div>
  </div>`;
}

// ---------- step 1: size + type ----------
function renderStart() {
  const sizesForType = (typeId) => {
    const t = catalog.types.find((x) => x.id === typeId);
    if (!t) return [];
    return unique(catalog.products.filter((p) => p.brandId === t.brandId).map((p) => p.size));
  };
  const avail = quote.typeId ? sizesForType(quote.typeId) : unique(catalog.products.map((p) => p.size));
  const ordered = orderSizes(avail);
  const typeCards = catalog.types.map((t, i) => {
    const beds = catalog.products.filter((p) => p.brandId === t.brandId);
    const min = Math.min(...beds.map((b) => b.salePrice));
    return optionCard({
      id: t.id, index: i, title: `${t.name} beds`, subtitle: t.blurb, selected: quote.typeId === t.id,
      extra: `<span class="badge">${escapeHtml(t.badge || '')}</span><div class="price-block"><span class="from">from </span><span class="now">${money(min)}</span></div>`
    });
  }).join('');
  const sizeChips = ordered.map((s) => `<button class="chip ${quote.size === s ? 'active' : ''}" data-startsize="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');
  return `
    <div class="block-label">1 · Choose a type</div>
    <div class="grid three" id="typeGrid">${typeCards}</div>
    <div class="block-label">2 · Choose a size ${quote.typeId ? '' : '<span class="muted">(pick a type first to filter)</span>'}</div>
    <div class="chips" id="startSizes">${sizeChips || '<span class="helper">No sizes.</span>'}</div>`;
}

// ---------- step 2: series (beds) ----------
function renderSeries() {
  if (!quote.typeId || !quote.size) return `<p class="helper">Pick a size and type first. <button class="linkbtn" data-jump="0">Back to start →</button></p>`;
  const t = catalog.types.find((x) => x.id === quote.typeId);
  const beds = catalog.products.filter((p) => p.brandId === t.brandId && p.size === quote.size)
    .sort((a, b) => a.salePrice - b.salePrice);
  if (!beds.length) return `<p class="helper">No ${escapeHtml(t.name)} beds in ${escapeHtml(quote.size)}. <button class="linkbtn" data-jump="0">Change size →</button></p>`;
  const cards = beds.map((b, i) => optionCard({
    id: b.id, index: i, title: b.model, subtitle: `${b.size} • ${b.series}`,
    selected: quote.productId === b.id, extra: priceTag(b.retailPrice, b.salePrice)
  })).join('');
  return `<div class="grid">${cards}</div>`;
}

// ---------- step 3: base ----------
function renderBase() {
  const bed = selectedBed();
  if (!bed) return `<p class="helper">Choose a bed first. <button class="linkbtn" data-jump="1">Pick a bed →</button></p>`;
  const inc = includedBaseFor(bed.model);
  if (inc) {
    if (quote.baseId !== 'included') { quote.baseId = 'included'; saveQuote(); }
    return `<div class="info-card"><span class="check-inline">✓</span><div><h3>${escapeHtml(inc.name)}</h3><p>${escapeHtml(inc.note)}</p></div></div>
      <p class="helper">No separate base needed — continue.</p>`;
  }
  const bases = basesForBrand(bed.brandId);
  const required = baseRequired(bed.brandId);
  const validIds = new Set([...(required ? [] : ['none']), ...bases.map((b) => b.id)]);
  if (quote.baseId && !validIds.has(quote.baseId)) { quote.baseId = null; saveQuote(); }
  if (required && !quote.baseId) { const d = bases.find((b) => b.default) || bases[0]; if (d) { quote.baseId = d.id; saveQuote(); } }
  const items = required ? bases : [{ id: 'none', name: 'Skip — no base', desc: 'Use your own frame or foundation.', kind: 'none' }, ...bases];
  const cards = items.map((b, i) => {
    const price = b.id === 'none' ? 0 : basePriceById(b.id, bed.size);
    const reqNote = (required && b.default) ? 'Required • recommended' : (b.kind === 'flexfit' ? 'Adjustable' : '');
    const extra = b.id === 'none' ? '<span class="badge">No charge</span>'
      : `${sizeAvailable(b, bed.size) || b.price ? priceTag(b.perSize ? sizeRetail(b, bed.size) : (b.retail ?? b.price), price, !b.perSize && false) : `<span class="badge">${money(price)}</span>`}`;
    return optionCard({ id: b.id, index: i, title: b.name, subtitle: [b.desc, reqNote].filter(Boolean).join(' • '), selected: quote.baseId === b.id, extra });
  }).join('');
  const note = required ? `<p class="note-line">Climate beds require a base — one is preselected. ${escapeHtml(bed.size)} pricing shown.</p>` : '';
  return `${note}<div class="grid">${cards}</div>`;
}

function unique(values) { return [...new Set(values.filter(Boolean))]; }
function orderSizes(sizes) {
  const order = catalog?.sizeOrder || ['Twin', 'Twin XL', 'Full', 'Queen', 'King', 'California King', 'Split King', 'Split California King', 'FlexTop King', 'FlexTop California King'];
  return unique(sizes).sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); });
}
function accessoryPriceHtml(item, size) {
  if (sizeAvailable(item, size)) return priceTag(sizeRetail(item, size), sizeSale(item, size));
  return priceTag(item.fromRetail ?? item.retail ?? 0, item.fromSale ?? item.sale ?? 0, true);
}

// ---------- step 4: furniture ----------
function renderFurniture() {
  const series = catalog.furnitureSeries || [];
  const tab = quote.furnitureTab && series.some((s) => s.id === quote.furnitureTab) ? quote.furnitureTab : (series[0]?.id);
  const size = quote.size;
  const tabs = series.map((s) => `<button class="chip ${s.id === tab ? 'active' : ''}" data-furntab="${s.id}">${escapeHtml(s.name)}</button>`).join('');
  const items = (catalog.furniture || []).filter((f) => f.seriesId === tab);
  const grid = items.map((f, i) => {
    const fit = sizeAvailable(f, size);
    const note = fit ? '' : `Available in ${f.sizes.join(', ')}`;
    return qtyCard({ bucket: 'furniture', id: f.id, index: i, title: f.name, sub: cap(f.kind), priceHtml: accessoryPriceHtml(f, size), note });
  }).join('');
  const blurb = series.find((s) => s.id === tab)?.blurb || '';
  return `<div class="chips" id="furnTabs">${tabs}</div><p class="helper">${escapeHtml(blurb)} Upholstered furniture fits Queen, King and California King.</p><div class="grid">${grid}</div>`;
}

// ---------- step 5: hardware ----------
function renderHardware() {
  const grid = (catalog.hardware || []).map((h, i) => qtyCard({ bucket: 'hardware', id: h.id, index: i, title: h.name, sub: h.desc, priceHtml: `<span class="badge">${money2(h.price)}</span>` })).join('');
  return `<p class="helper">Only add hardware you actually need — e.g. brackets to mount a headboard you bought elsewhere.</p><div class="grid">${grid}</div>`;
}

// ---------- step 6: sheets / bedding ----------
function renderBedding() {
  const size = quote.size;
  const grid = (catalog.sheets || []).map((s, i) => qtyCard({ bucket: 'sheets', id: s.id, index: i, title: s.name, sub: sizeAvailable(s, size) ? size : 'Multiple sizes', priceHtml: accessoryPriceHtml(s, size) })).join('');
  return `<p class="helper">All current sheet & pillowcase sets, priced live. Add or pass.</p><div class="grid">${grid}</div>`;
}

// ---------- step 7: pillows ----------
function renderPillows() {
  const grid = (catalog.pillows || []).map((p, i) => {
    const tag = p.retail > p.sale ? priceTag(p.retail, p.sale, true) : `<div class="price-block"><span class="from">from </span><span class="now">${money(p.sale)}</span></div>`;
    return qtyCard({ bucket: 'pillows', id: p.id, index: i, title: p.name, sub: 'Pillow', priceHtml: tag });
  }).join('');
  return `<p class="helper">Current pillow lineup, priced live (from price shown — loft/size varies).</p><div class="grid">${grid}</div>`;
}

// ---------- step 8: pads / protection ----------
function renderPads() {
  const size = quote.size;
  const grid = (catalog.pads || []).map((p, i) => qtyCard({ bucket: 'pads', id: p.id, index: i, title: p.name, sub: sizeAvailable(p, size) ? size : 'Multiple sizes', priceHtml: accessoryPriceHtml(p, size) })).join('');
  return `<p class="helper">Mattress pads, protectors and comfort layers. Add or pass.</p><div class="grid">${grid}</div>`;
}

// ---------- step 9: delivery ----------
function renderDelivery() {
  const list = catalog.delivery || [];
  if (!quote.deliveryId) { const d = list.find((x) => x.default) || list[0]; if (d) { quote.deliveryId = d.id; saveQuote(); } }
  const cards = list.map((d, i) => optionCard({ id: d.id, index: i, title: d.name, subtitle: d.desc, selected: quote.deliveryId === d.id, extra: `<span class="badge">${d.price ? money2(d.price) : 'Free'}</span>` })).join('');
  const fees = (catalog.disposalFees || []).map((f, i) => qtyCard({ bucket: 'disposal', id: f.id, index: i, title: f.name, sub: f.desc, priceHtml: `<span class="badge">${money2(f.price)}</span>` })).join('');
  return `<div class="grid" id="deliveryGrid">${cards}</div>
    ${catalog.deliveryNote ? `<p class="note-line">${escapeHtml(catalog.deliveryNote)}</p>` : ''}
    ${fees ? `<h3 class="mini-title">Add-on disposal</h3><div class="grid">${fees}</div>` : ''}`;
}

// ---------- step 10: warranty ----------
function renderWarranty() {
  const items = (catalog.warranty || []).map((w) => `<li><strong>${escapeHtml(w.name)}</strong> — ${w.included ? 'Included' : money2(w.price)}<br><span class="muted">${escapeHtml(w.desc || '')}</span></li>`).join('');
  return `<div class="included-card"><p class="eyebrow">Included coverage</p><ul class="perks">${items}</ul></div>
    ${catalog.warrantyNote ? `<p class="note-line">${escapeHtml(catalog.warrantyNote)}</p>` : ''}`;
}

// ---------- step 11: discounts + tax ----------
function renderDiscounts() {
  const military = (catalog.promos || []).find((p) => p.id === 'military-first-responder');
  const milRow = military ? `<label class="toggle-row big"><input type="checkbox" data-promo-toggle="${military.id}" ${quote.toggles[military.id] ? 'checked' : ''}><span><strong>${escapeHtml(military.name)} — ${military.discountPercent}% off</strong><p>${escapeHtml(military.description || '')}</p></span></label>` : '';
  return `${milRow}
    <div class="form-grid" style="margin-top:1rem">
      <label class="field"><span>Manual discount ($ off)</span><input type="number" min="0" step="1" data-field="customDiscount" value="${quote.customDiscount || 0}"></label>
      <label class="field"><span>Sales tax %</span><input type="number" min="0" step=".01" data-field="taxRate" value="${quote.taxRate ?? 0}"></label>
    </div>
    <p class="note-line">Military / First Responder is the only standing customer discount (5%). Use manual discount for manager-approved adjustments. Tax defaults to ${catalog.taxRateDefault ?? 0}% and is editable.</p>`;
}
function cap(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }

// ---------- step 12: quote + hot-swap + compare ----------
function renderQuote() {
  const bed = selectedBed();
  if (!bed) return `<p class="helper">Build a quote first. <button class="linkbtn" data-jump="0">Start →</button></p>`;
  const calc = calculateQuote();
  const lines = calc.lines.map((l) => `<div class="summary-line"><span>${escapeHtml(l.label)}</span><strong>${money2(l.amount)}</strong></div>`).join('');

  // hot-swap selectors
  const sameSet = catalog.products.filter((p) => p.brandId === bed.brandId && p.size === bed.size).sort((a, b) => a.salePrice - b.salePrice);
  const bedOpts = sameSet.map((p) => `<option value="${p.id}" ${p.id === quote.productId ? 'selected' : ''}>${escapeHtml(p.model)} — ${money(p.salePrice)}</option>`).join('');
  let baseOpts = '';
  const inc = includedBaseFor(bed.model);
  if (inc) baseOpts = `<option selected>${escapeHtml(inc.name)}</option>`;
  else {
    const bases = basesForBrand(bed.brandId);
    const list = baseRequired(bed.brandId) ? bases : [{ id: 'none', name: 'No base' }, ...bases];
    baseOpts = list.map((b) => `<option value="${b.id}" ${b.id === quote.baseId ? 'selected' : ''}>${escapeHtml(b.name)}${b.id === 'none' ? '' : ` — ${money(basePriceById(b.id, bed.size))}`}</option>`).join('');
  }

  const comps = quote.comparisons || [];
  const compCols = comps.map((c, i) => `
    <div class="comp-col">
      <button class="comp-remove" data-comp-remove="${i}" title="Remove">×</button>
      <p class="comp-label">${escapeHtml(c.label)}</p>
      <p class="comp-sub">${escapeHtml(c.base)}</p>
      <p class="comp-total">${money2(c.total)}</p>
      <p class="comp-save">${money(c.savings)} saved</p>
    </div>`).join('');
  const currentCol = `
    <div class="comp-col current">
      <p class="comp-label">Current</p>
      <p class="comp-sub">${escapeHtml(bed.model)} • ${escapeHtml(quote.size)}</p>
      <p class="comp-total">${money2(calc.total)}</p>
      <p class="comp-save">${money(calc.savings)} saved</p>
    </div>`;

  return `
    <div class="quote-final">
      <div class="hotswap">
        <h3 class="mini-title">Hot-swap</h3>
        <div class="form-grid">
          <label class="field"><span>Bed</span><select data-swap="bed">${bedOpts}</select></label>
          <label class="field"><span>Base</span><select data-swap="base">${baseOpts}</select></label>
        </div>
      </div>
      <div class="final-lines">${lines}</div>
      <div class="final-total"><span>Estimated total</span><strong>${money2(calc.total)}</strong></div>
      <div class="compare">
        <div class="compare-head"><h3 class="mini-title">Compare (up to 3)</h3>
          <div class="compare-actions">
            <button class="secondary" id="saveCompare" ${comps.length >= 3 ? 'disabled' : ''}>Save current</button>
            ${comps.length ? '<button class="secondary" id="clearCompare">Clear</button>' : ''}
          </div>
        </div>
        <div class="comp-grid">${currentCol}${compCols}</div>
      </div>
      <button class="wide" id="quoteCopy">Copy quote</button>
    </div>`;
}

// ---------- events ----------
function bindStepEvents(step) {
  document.querySelectorAll('.card-option[data-id]').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-qty-minus],[data-qty-plus]')) return;
      onCardPick(step, card.dataset.id);
    });
  });
  document.querySelectorAll('[data-type]').forEach((el) => el.addEventListener('click', () => setType(el.dataset.type)));
  document.querySelectorAll('[data-startsize]').forEach((el) => el.addEventListener('click', () => setSize(el.dataset.startsize)));
  document.querySelectorAll('[data-furntab]').forEach((el) => el.addEventListener('click', () => { quote.furnitureTab = el.dataset.furntab; saveQuote(); render(); }));
  document.querySelectorAll('[data-qty-add]').forEach((card) => card.addEventListener('click', (e) => {
    if (e.target.closest('[data-qty-minus],[data-qty-plus]')) return; changeQty(card.dataset.qtyAdd, 1);
  }));
  document.querySelectorAll('[data-qty-plus]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); changeQty(e.currentTarget.dataset.qtyPlus, 1); }));
  document.querySelectorAll('[data-qty-minus]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); changeQty(e.currentTarget.dataset.qtyMinus, -1); }));
  document.querySelectorAll('[data-field]').forEach((input) => input.addEventListener('input', () => {
    quote[input.dataset.field] = input.type === 'number' ? Number(input.value || 0) : input.value; saveQuote(); renderSummary();
  }));
  document.querySelectorAll('[data-promo-toggle]').forEach((input) => input.addEventListener('change', () => { quote.toggles[input.dataset.promoToggle] = input.checked; saveQuote(); renderSummary(); }));
  document.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => goToStep(Number(b.dataset.jump))));
  // hot-swap selects
  document.querySelectorAll('[data-swap]').forEach((sel) => sel.addEventListener('change', () => {
    if (sel.dataset.swap === 'bed') { quote.productId = sel.value; }
    else if (sel.dataset.swap === 'base') { quote.baseId = sel.value; }
    saveQuote(); render();
  }));
  const sc = $('saveCompare'); if (sc) sc.addEventListener('click', saveComparison);
  const cc = $('clearCompare'); if (cc) cc.addEventListener('click', () => { quote.comparisons = []; saveQuote(); render(); });
  document.querySelectorAll('[data-comp-remove]').forEach((b) => b.addEventListener('click', () => { quote.comparisons.splice(Number(b.dataset.compRemove), 1); saveQuote(); render(); }));
  const qc = $('quoteCopy'); if (qc) qc.addEventListener('click', copyQuote);
}

function onCardPick(step, id) {
  if (step === 'start') return setType(id);
  if (step === 'series') return setBed(id);
  if (step === 'base') return setBase(id);
  if (step === 'delivery') { quote.deliveryId = id; saveQuote(); render(); return; }
}
function setType(typeId) {
  const t = catalog.types.find((x) => x.id === typeId); if (!t) return;
  if (quote.typeId !== typeId) {
    quote.typeId = typeId; quote.brandId = t.brandId; quote.productId = null; quote.baseId = null;
    const sizes = catalog.products.filter((p) => p.brandId === t.brandId).map((p) => p.size);
    if (quote.size && !sizes.includes(quote.size)) quote.size = null;
  }
  saveQuote(); render(); maybeAutoStart();
}
function setSize(size) {
  quote.size = size;
  const bed = selectedBed(); if (bed && bed.size !== size) { quote.productId = null; quote.baseId = null; }
  saveQuote(); render(); maybeAutoStart();
}
function maybeAutoStart() {
  if (quote.size && quote.typeId && steps[currentStep].id === 'start') { clearTimeout(advanceTimer); advanceTimer = setTimeout(advance, 240); }
}
function setBed(id) {
  const prev = selectedBed();
  quote.productId = id;
  const bed = selectedBed();
  if (!prev || prev.id !== bed.id) quote.baseId = null;
  saveQuote(); render();
  clearTimeout(advanceTimer); advanceTimer = setTimeout(advance, 220);
}
function setBase(id) { quote.baseId = id; saveQuote(); render(); clearTimeout(advanceTimer); advanceTimer = setTimeout(advance, 220); }
function changeQty(token, delta) {
  const [bucket, id] = token.split(':');
  quote[bucket] ||= {};
  quote[bucket][id] = Math.max(0, (quote[bucket][id] || 0) + delta);
  if (!quote[bucket][id]) delete quote[bucket][id];
  saveQuote(); render();
}

// ---------- resolvers ----------
function listById(list, id) { return (list || []).find((x) => x.id === id); }
function baseLabel() {
  const bed = selectedBed(); if (!bed) return 'No base';
  const inc = includedBaseFor(bed.model); if (inc) return inc.name;
  if (!quote.baseId || quote.baseId === 'none') return 'No base';
  return basesForBrand(bed.brandId).find((b) => b.id === quote.baseId)?.name || 'Base';
}

// ---------- calculation ----------
function calculateQuote() {
  const lines = [];
  let subtotal = 0, savings = 0;
  if (!catalog) return { lines, subtotal, promos: [], savings, total: 0 };
  const size = quote.size;
  const bed = selectedBed();
  if (bed) {
    lines.push({ label: `${bed.model} (${bed.size})`, amount: bed.salePrice });
    subtotal += bed.salePrice; savings += Math.max(0, bed.retailPrice - bed.salePrice);
  }
  // base
  if (bed) {
    const inc = includedBaseFor(bed.model);
    if (inc) lines.push({ label: `${inc.name}`, amount: 0 });
    else if (quote.baseId && quote.baseId !== 'none') {
      const b = basesForBrand(bed.brandId).find((x) => x.id === quote.baseId);
      if (b) {
        const price = basePriceById(b.id, size);
        const retail = b.perSize ? sizeRetail(b, size) : (b.retail ?? price);
        lines.push({ label: b.name, amount: price }); subtotal += price; savings += Math.max(0, retail - price);
      }
    }
  }
  // accessory buckets
  const buckets = [
    ['furniture', catalog.furniture], ['sheets', catalog.sheets], ['pads', catalog.pads]
  ];
  for (const [bucket, list] of buckets) {
    for (const [id, qty] of Object.entries(quote[bucket] || {})) {
      const it = listById(list, id); if (!it || !qty) continue;
      const sale = sizeSale(it, size), retail = sizeRetail(it, size);
      lines.push({ label: `${it.name} × ${qty}`, amount: sale * qty }); subtotal += sale * qty; savings += Math.max(0, (retail - sale) * qty);
    }
  }
  for (const [id, qty] of Object.entries(quote.pillows || {})) {
    const it = listById(catalog.pillows, id); if (!it || !qty) continue;
    lines.push({ label: `${it.name} × ${qty}`, amount: it.sale * qty }); subtotal += it.sale * qty; savings += Math.max(0, (it.retail - it.sale) * qty);
  }
  for (const [id, qty] of Object.entries(quote.hardware || {})) {
    const it = listById(catalog.hardware, id); if (!it || !qty) continue;
    lines.push({ label: `${it.name} × ${qty}`, amount: it.price * qty }); subtotal += it.price * qty;
  }
  // delivery + disposal
  const del = listById(catalog.delivery, quote.deliveryId);
  if (del && del.price) { lines.push({ label: del.name, amount: del.price }); subtotal += del.price; }
  for (const [id, qty] of Object.entries(quote.disposal || {})) {
    const it = listById(catalog.disposalFees, id); if (!it || !qty) continue;
    lines.push({ label: it.name, amount: it.price * qty }); subtotal += it.price * qty;
  }

  // discounts
  const promos = [];
  for (const promo of (catalog.promos || [])) {
    if ((promo.type === 'toggle' || promo.type === 'manual') && quote.toggles[promo.id]) {
      const amount = promo.discountAmount ?? Math.round(subtotal * ((promo.discountPercent || 0) / 100) * 100) / 100;
      promos.push({ ...promo, amount: Math.min(amount, subtotal) });
    }
  }
  const promoDiscount = promos.reduce((s, p) => s + p.amount, 0);
  const customDiscount = Number(quote.customDiscount || 0);
  const taxRate = Number(quote.taxRate || 0) / 100;
  const taxable = Math.max(0, subtotal - promoDiscount - customDiscount);
  const tax = Math.round(taxable * taxRate * 100) / 100;
  if (customDiscount) lines.push({ label: 'Manual discount', amount: -customDiscount });
  if (tax) lines.push({ label: `Sales tax (${quote.taxRate}%)`, amount: tax });
  const total = Math.max(0, taxable + tax);
  return { lines, subtotal, promos, savings: savings + promoDiscount + customDiscount, total };
}

function renderSummary() {
  const calc = calculateQuote();
  const bed = selectedBed();
  $('totalDue').textContent = money2(calc.total);
  $('savingsPill').textContent = `${money(calc.savings)} saved`;
  $('savingsPill').classList.toggle('hidden', calc.savings <= 0);
  pulse($('totalDue'));
  $('miniSummary').innerHTML = calc.lines.length
    ? calc.lines.map((l) => `<div class="summary-line"><span>${escapeHtml(l.label)}</span><strong>${money2(l.amount)}</strong></div>`).join('')
    : '<p class="helper">Pick a size & type to start.</p>';
  const promoHtml = calc.promos.map((p) => `<div class="promo-item"><strong>${escapeHtml(p.name)}</strong><span>-${money2(p.amount)}</span></div>`).join('');
  const perk = bed ? `<div class="promo-item perk"><strong>Included</strong><span>15-yr warranty + trial</span></div>` : '';
  $('promoList').innerHTML = (promoHtml || perk) ? `${promoHtml}${perk}` : '<div class="promo-item">Discounts &amp; perks appear here.</div>';
  const bt = $('barTotal'); if (bt) bt.textContent = money2(calc.total);
  const bn = $('barNext'); if (bn) bn.textContent = steps[currentStep].id === 'quote' ? 'Copy quote' : 'Next →';
}

function saveComparison() {
  const bed = selectedBed(); if (!bed) return;
  quote.comparisons = quote.comparisons || [];
  if (quote.comparisons.length >= 3) { toast('Up to 3 comparisons'); return; }
  const calc = calculateQuote();
  quote.comparisons.push({ label: `${bed.model}`, base: `${quote.size} • ${baseLabel()}`, total: calc.total, savings: calc.savings });
  saveQuote(); render(); toast('Saved to compare');
}

function pulse(el) { if (!el) return; el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
function escapeHtml(v) { return String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function formatDate(v) { return v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown'; }
function toast(m) { const el = $('toast'); el.textContent = m; el.classList.remove('hidden'); clearTimeout(window.__t); window.__t = setTimeout(() => el.classList.add('hidden'), 2600); }

async function copyQuote() {
  const bed = selectedBed();
  const calc = calculateQuote();
  const del = listById(catalog.delivery, quote.deliveryId);
  const lines = [
    'Sleep Number Quote',
    bed ? `Bed: ${bed.series} ${bed.model} (${bed.size})` : 'Bed: not selected',
    `Base: ${baseLabel()}`,
    '',
    ...calc.lines.map((l) => `${l.label}: ${money2(l.amount)}`),
    '',
    del ? `Delivery: ${del.name}` : '',
    `Estimated total: ${money2(calc.total)}`,
    `Estimated savings: ${money(calc.savings)}`,
    'Included: 100-night trial + 15-year limited warranty',
    `Catalog updated: ${formatDate(catalog?.lastUpdated)}`
  ];
  if ((quote.comparisons || []).length) {
    lines.push('', 'Comparisons:');
    quote.comparisons.forEach((c, i) => lines.push(`  ${i + 1}. ${c.label} — ${c.base}: ${money2(c.total)}`));
  }
  lines.push('', 'Final pricing/eligibility may depend on verification and current store policy.');
  try { await navigator.clipboard.writeText(lines.filter((l) => l !== undefined).join('\n')); toast('Quote copied'); }
  catch { toast('Copy not available'); }
}
