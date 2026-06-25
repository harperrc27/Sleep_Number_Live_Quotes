import fs from 'node:fs/promises';
import path from 'node:path';

// Live + curated catalog updater for the guided Sleep Number quote flow.
// Live: mattresses, integrated bases, furniture, sheets, pads, pillows (Storefront API).
// Curated (from researched live data): types, bases, delivery, warranty, tax, compatibility.

const root = process.cwd();
const catalogPath = path.join(root, 'data', 'catalog.json');
const sourcesPath = path.join(root, 'scripts', 'sources.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const BRAND_META = {
  comfortmode: { name: 'ComfortMode\u2122 Collection', logoText: 'ComfortMode', badge: 'Essential', description: 'Adjustable foam smart beds (each side 0-100) with SleepIQ\u00ae sleep tracking.' },
  comfortnext: { name: 'ComfortNext\u2122 Collection', logoText: 'ComfortNext', badge: 'Most Popular', description: 'Enhanced comfort and edge support, FlexFit\u00ae adjustable-base ready, with DualAir\u2122.' },
  climate: { name: 'Climate\u2122 Collection', logoText: 'Climate', badge: 'Premium', description: 'Temperature-balancing smart beds - ClimateCool\u00ae cools; Climate360\u00ae heats + cools.' }
};

const dollars = (v) => {
  if (v == null) return 0;
  if (typeof v === 'number') return Math.round(v) / 100 === v ? v : Math.round(v) / 100;
  if (typeof v === 'object' && typeof v.cents === 'number') return Math.round(v.cents) / 100;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const slug = (s) => String(s).toLowerCase().replace(/[\u2122\u00ae]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const toModel = (apiName) => `${String(apiName).replace(/[\u2122\u00ae]/g, '').replace(/\bMattress\b/gi, '').replace(/\s+/g, ' ').trim()} Smart Bed`;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Group variants by Size -> { size: { retail, sale } } using the cheapest variant per size.
function perSizeMap(variants) {
  const map = {};
  for (const v of (variants || [])) {
    const size = v.details && Array.isArray(v.details.Size) ? v.details.Size[0] : null;
    if (!size) continue;
    const retail = dollars(v.regular);
    const sale = dollars(v.sale ?? v.regular);
    if (!retail) continue;
    if (!map[size] || sale < map[size].sale) map[size] = { retail, sale: Math.min(sale || retail, retail) };
  }
  return map;
}
function fromPrices(perSize) {
  const sizes = Object.keys(perSize);
  if (!sizes.length) return { fromRetail: 0, fromSale: 0 };
  let fr = Infinity, fs2 = Infinity;
  for (const s of sizes) { fr = Math.min(fr, perSize[s].retail); fs2 = Math.min(fs2, perSize[s].sale); }
  return { fromRetail: fr, fromSale: fs2 };
}

async function main() {
  const config = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
  const apiBase = (config.apiBase || '').replace(/\/$/, '');
  const sizeOrder = config.sizeOrder || [];
  const sizeRank = (s) => { const i = sizeOrder.indexOf(s); return i === -1 ? 999 : i; };
  const sourceResults = [];

  // ---- 1. Mattresses (per collection) ----
  const products = [];
  const brandOrder = config.collections.map((c) => c.brandId);
  for (const col of config.collections) {
    try {
      const data = await fetchJson(`${apiBase}/categories/${col.slug}`);
      let rows = 0;
      for (const p of (data.products || [])) {
        const model = toModel(p.name || p.slug);
        for (const [size, price] of Object.entries(perSizeMap(p.variants))) {
          products.push({
            id: `${slug(model.replace(/ Smart Bed$/, ''))}-${slug(size)}`,
            brandId: col.brandId, series: col.series, model, type: 'Smart Bed',
            size, retailPrice: price.retail, salePrice: price.sale
          });
          rows++;
        }
      }
      sourceResults.push({ source: col.slug, ok: true, rows });
    } catch (e) { sourceResults.push({ source: col.slug, ok: false, error: e.message }); }
  }
  products.sort((a, b) => (brandOrder.indexOf(a.brandId) - brandOrder.indexOf(b.brandId)) || (sizeRank(a.size) - sizeRank(b.size)) || (a.retailPrice - b.retailPrice));

  // ---- 2. Bases (priced live from their bundle products: sell_min = sale, original_min = retail) ----
  const basesByBrand = {};
  let baseRows = 0;
  for (const [brandId, list] of Object.entries(config.basesByBrand || {})) {
    basesByBrand[brandId] = [];
    for (const b of list) {
      const out = { id: b.id, name: b.name, kind: b.kind, desc: b.desc || '' };
      if (b.default) out.default = true;
      let price = b.price ?? 0, retail = b.retail ?? b.price ?? 0;
      if (b.bundleSlug) {
        try {
          const bundle = await fetchJson(`${apiBase}/products/${b.bundleSlug}`);
          price = dollars(bundle.sell_min_price);
          retail = dollars(bundle.original_min_price) || price;
          baseRows++;
        } catch (e) { sourceResults.push({ source: `base:${b.bundleSlug}`, ok: false, error: e.message }); }
      }
      out.price = price;
      out.retail = Math.max(retail, price);
      basesByBrand[brandId].push(out);
    }
  }
  sourceResults.push({ source: 'bases', ok: true, rows: baseRows });

  // ---- 3. Furniture (3 series) ----
  const furniture = [];
  const accessorySet = new Set(config.furnitureAccessorySlugs || []);
  for (const src of (config.furnitureSources || [])) {
    try {
      const data = await fetchJson(`${apiBase}/categories/${src.slug}`);
      for (const p of (data.products || [])) {
        const perSize = perSizeMap(p.variants);
        if (!Object.keys(perSize).length) continue;
        const kind = accessorySet.has(p.slug) ? 'accessory' : (src.kind || 'bed');
        const fp = fromPrices(perSize);
        furniture.push({
          id: p.slug, seriesId: src.seriesId, kind,
          name: (p.name || p.slug).replace(/\s+/g, ' ').trim(),
          sizes: Object.keys(perSize), perSize, fromRetail: fp.fromRetail, fromSale: fp.fromSale
        });
      }
      sourceResults.push({ source: src.slug, ok: true, rows: furniture.length });
    } catch (e) { sourceResults.push({ source: src.slug, ok: false, error: e.message }); }
  }

  // ---- 4. Sheets ----
  const sheets = [];
  try {
    const data = await fetchJson(`${apiBase}/categories/${config.sheetsCategory}`);
    for (const p of (data.products || [])) {
      const perSize = perSizeMap(p.variants);
      if (!Object.keys(perSize).length) continue;
      const fp = fromPrices(perSize);
      sheets.push({ id: p.slug, name: (p.name || p.slug).replace(/\s+/g, ' ').trim(), sizes: Object.keys(perSize), perSize, fromRetail: fp.fromRetail, fromSale: fp.fromSale });
    }
    sourceResults.push({ source: config.sheetsCategory, ok: true, rows: sheets.length });
  } catch (e) { sourceResults.push({ source: config.sheetsCategory, ok: false, error: e.message }); }

  // ---- 5. Mattress pads / protection ----
  const pads = [];
  try {
    const data = await fetchJson(`${apiBase}/categories/${config.padsCategory}`);
    for (const p of (data.products || [])) {
      const perSize = perSizeMap(p.variants);
      if (!Object.keys(perSize).length) continue;
      const fp = fromPrices(perSize);
      pads.push({ id: p.slug, name: (p.name || p.slug).replace(/\s+/g, ' ').trim(), sizes: Object.keys(perSize), perSize, fromRetail: fp.fromRetail, fromSale: fp.fromSale });
    }
    sourceResults.push({ source: config.padsCategory, ok: true, rows: pads.length });
  } catch (e) { sourceResults.push({ source: config.padsCategory, ok: false, error: e.message }); }

  // ---- 6. Pillows (fetch each for Shape x Size variants with per-variant sale pricing) ----
  const pillows = [];
  for (const slug of (config.pillowSlugs || [])) {
    try {
      const p = await fetchJson(`${apiBase}/products/${slug}`);
      const shapes = [], sizes = [], variants = {};
      for (const v of (p.variants || [])) {
        const shape = v.details && Array.isArray(v.details.Shape) ? v.details.Shape[0] : 'Standard';
        const size = v.details && Array.isArray(v.details.Size) ? v.details.Size[0] : 'Standard';
        const retail = dollars(v.regular), sale = dollars(v.sale ?? v.regular);
        if (!retail && !sale) continue; // skip unavailable/zero variants
        if (!shapes.includes(shape)) shapes.push(shape);
        if (!sizes.includes(size)) sizes.push(size);
        variants[`${shape}|${size}`] = { retail, sale: Math.min(sale || retail, retail) };
      }
      if (!Object.keys(variants).length) continue;
      const sales = Object.values(variants).map((x) => x.sale);
      pillows.push({
        id: p.slug, name: (p.name || p.slug).replace(/\s+/g, ' ').trim(),
        shapes, sizes, variants, fromSale: Math.min(...sales),
        fromRetail: Math.min(...Object.values(variants).map((x) => x.retail))
      });
    } catch (e) { sourceResults.push({ source: `pillow:${slug}`, ok: false, error: e.message }); }
  }
  sourceResults.push({ source: 'pillows', ok: true, rows: pillows.length });

  // ---- Assemble ----
  const brands = brandOrder.map((id) => ({ id, ...BRAND_META[id] }));
  const catalog = {
    lastUpdated: new Date().toISOString(),
    sourceNotes: config.note,
    taxRateDefault: config.taxRateDefault ?? 0,
    types: config.types,
    brands,
    products,
    basesByBrand,
    baseRequiredBrands: config.baseRequiredBrands || [],
    modelIncludedBase: config.modelIncludedBase || {},
    furnitureSeries: config.furnitureSeries || [],
    furniture,
    hardware: config.hardware || [],
    sheets,
    pads,
    pillows,
    delivery: config.delivery || [],
    disposalFees: config.disposalFees || [],
    deliveryNote: config.deliveryNote || '',
    warranty: config.warranty || [],
    protectionPlans: config.protectionPlans || [],
    warrantyNote: config.warrantyNote || '',
    promos: config.promos || [],
    sourceResults
  };

  if (!products.length) { console.error('No mattresses fetched; leaving catalog unchanged.'); process.exitCode = 1; return; }
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  const perBrand = brandOrder.map((id) => `${id}=${products.filter((p) => p.brandId === id).length}`).join(', ');
  console.log(`Catalog rebuilt from live API:`);
  console.log(`  beds: ${products.length} (${perBrand})`);
  console.log(`  furniture: ${furniture.length}, sheets: ${sheets.length}, pads: ${pads.length}, pillows: ${pillows.length}, hardware: ${catalog.hardware.length}`);
  console.log(`  bases: ${Object.entries(basesByBrand).map(([k, v]) => `${k}=${v.length}`).join(', ')}; delivery: ${catalog.delivery.length}; protection plans: ${catalog.protectionPlans.length}; tax ${catalog.taxRateDefault}%`);
  const onSale = [];
  for (const [k, v] of Object.entries(basesByBrand)) for (const b of v) if (b.retail > b.price) onSale.push(`${b.id} ${b.price}/${b.retail}`);
  console.log(`  bases on sale: ${onSale.join(', ') || 'none'}`);
  const bad = sourceResults.filter((r) => !r.ok);
  if (bad.length) console.log('  WARNINGS: ' + bad.map((b) => `${b.source}:${b.error}`).join('; '));
}

main().catch((e) => { console.error('Catalog update failed:', e.message); process.exitCode = 1; });
