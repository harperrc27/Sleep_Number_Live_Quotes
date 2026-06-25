/**
 * Sleep Number Catalog Updater
 * Fetches public Sleep Number pages, extracts products/promos,
 * merges with the existing catalog, validates, and writes only if changed.
 *
 * Sources: configure in scripts/sources.json
 * Output:  data/catalog.json
 */

import fs   from 'node:fs/promises';
import path from 'node:path';

const root        = process.cwd();
const catalogPath = path.join(root, 'data', 'catalog.json');
const sourcesPath = path.join(root, 'scripts', 'sources.json');

const UA = 'SleepNumberQuoteStudio/2.0 (+GitHub-Actions catalog updater; public data only)';

const moneyNumber = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  const config  = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
  const active  = (config.sources || []).filter(s => s.url && /^https?:\/\//.test(s.url));

  const importedProducts = [];
  const importedPromos   = [];
  const sourceResults    = [];
  const report           = { added: [], removed: [], priceChanges: [], promoChanges: [], broken: [], missingPrices: [], lowConfidence: [] };

  for (const source of active) {
    try {
      const res = await fetch(source.url, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();

      let products = [];
      let promos   = [];

      if (source.type === 'json') {
        try { products = extractFromJson(JSON.parse(text), source); } catch (e) { throw new Error(`JSON parse: ${e.message}`); }
      } else {
        products = extractProductsFromHtml(text, source);
        promos   = extractPromosFromHtml(text, source);
      }

      importedProducts.push(...products);
      importedPromos.push(...promos);
      sourceResults.push({ name: source.name, url: source.url, ok: true, products: products.length, promos: promos.length });
    } catch (err) {
      sourceResults.push({ name: source.name, url: source.url, ok: false, error: err.message });
      report.broken.push(`${source.name}: ${err.message}`);
      console.warn(`[source error] ${source.name}: ${err.message}`);
    }
  }

  // ── Merge & validate ──────────────────────────────────────────────────────
  const prevProducts = catalog.products || [];
  const prevPromos   = catalog.promos   || [];

  let nextProducts = prevProducts;
  let nextPromos   = prevPromos;

  if (importedProducts.length) {
    nextProducts = mergeById(importedProducts, prevProducts);
    for (const p of importedProducts) {
      const prev = prevProducts.find(x => x.id === p.id);
      if (!prev) report.added.push(p.id);
      else if (JSON.stringify(p.pricing) !== JSON.stringify(prev.pricing)) report.priceChanges.push(p.id);
    }
    for (const p of prevProducts) {
      if (!nextProducts.find(x => x.id === p.id)) report.removed.push(p.id);
    }
  }

  if (importedPromos.length) {
    nextPromos = mergeById(importedPromos, prevPromos);
    for (const p of importedPromos) {
      const prev = prevPromos.find(x => x.id === p.id);
      if (!prev || JSON.stringify(p) !== JSON.stringify(prev)) report.promoChanges.push(p.id);
    }
  }

  // Validation
  for (const p of nextProducts) {
    if (!p.pricing || !Object.values(p.pricing).some(v => v > 0)) report.missingPrices.push(p.id);
    if ((p.confidenceScore ?? 1) < 0.7) report.lowConfidence.push(p.id);
  }

  // Schema validation: no NaN prices
  for (const p of nextProducts) {
    if (p.pricing) {
      for (const [size, price] of Object.entries(p.pricing)) {
        if (isNaN(price) || price === null) {
          console.warn(`[validation] NaN/null price in ${p.id} size ${size} — removing`);
          delete p.pricing[size];
        }
      }
    }
  }

  const nextCatalog = {
    ...catalog,
    schemaVersion: 2,
    lastUpdated: new Date().toISOString(),
    metadata: {
      ...(catalog.metadata || {}),
      brand: 'Sleep Number',
      productCount: nextProducts.length,
      promoCount: nextPromos.length,
      note: 'All prices are approximate based on publicly available data. Verify before purchase.',
    },
    sourceNotes: active.length
      ? `Catalog refreshed from ${active.length} source(s). ${sourceResults.filter(s => !s.ok).length} failed.`
      : 'No active sources. Catalog updater ran but no public URLs are configured in scripts/sources.json.',
    sourceResults,
    products:  nextProducts,
    promos:    nextPromos,
  };

  // ── Detect changes ────────────────────────────────────────────────────────
  const prevStr = JSON.stringify({ products: prevProducts, promos: prevPromos });
  const nextStr = JSON.stringify({ products: nextProducts, promos: nextPromos });
  const changed = prevStr !== nextStr;

  if (changed) {
    await fs.writeFile(catalogPath, JSON.stringify(nextCatalog, null, 2) + '\n');
    console.log(`Catalog updated: ${nextProducts.length} products, ${nextPromos.length} promos.`);
  } else {
    // Still write to update lastUpdated and sourceResults
    await fs.writeFile(catalogPath, JSON.stringify(nextCatalog, null, 2) + '\n');
    console.log(`No product/promo changes. Metadata updated.`);
  }

  // ── Health report ─────────────────────────────────────────────────────────
  console.log('\n── Catalog Health Report ──────────────────────────');
  console.log(`Products: ${nextProducts.length} total`);
  console.log(`Promos:   ${nextPromos.length} total`);
  if (report.added.length)        console.log(`  Added:         ${report.added.join(', ')}`);
  if (report.removed.length)      console.log(`  Removed:       ${report.removed.join(', ')}`);
  if (report.priceChanges.length) console.log(`  Price changes: ${report.priceChanges.join(', ')}`);
  if (report.promoChanges.length) console.log(`  Promo changes: ${report.promoChanges.join(', ')}`);
  if (report.broken.length)       console.log(`  Broken sources:\n    ${report.broken.join('\n    ')}`);
  if (report.missingPrices.length) console.log(`  Missing prices: ${report.missingPrices.join(', ')}`);
  if (report.lowConfidence.length) console.log(`  Low confidence: ${report.lowConfidence.join(', ')}`);
  if (!report.broken.length && !report.missingPrices.length) console.log('  No issues found.');
  console.log('────────────────────────────────────────────────────');
}

// ── Extractors ────────────────────────────────────────────────────────────────
function extractFromJson(data, source) {
  const candidates = Array.isArray(data)
    ? data
    : data.products || data.items || data.results || [];
  const products = [];
  for (const item of candidates) {
    const name  = item.name || item.title || item.productName;
    const price = moneyNumber(item.salePrice ?? item.price ?? item.currentPrice ?? item.offerPrice);
    if (!name || !price) continue;
    products.push({
      id:       slug(`sn-${name}`),
      name,
      series:   item.series || item.collection || guessSeries(name),
      category: 'mattress',
      pricing:  { Queen: price },
      retailPricing: { Queen: moneyNumber(item.retailPrice ?? item.msrp ?? price) || price },
      productUrl: source.url,
      verificationRequired: true,
      confidenceScore: 0.65,
      lastVerified: new Date().toISOString().slice(0, 10),
    });
  }
  return products;
}

function extractProductsFromHtml(html, source) {
  const products = [];
  const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/\s*script\s*>/gi)];
  for (const match of jsonLdMatches) {
    try {
      const parsed = JSON.parse(cleanJson(match[1]));
      const nodes  = flattenJsonLd(parsed);
      for (const node of nodes) {
        if (!String(node['@type'] || '').toLowerCase().includes('product')) continue;
        const offer = Array.isArray(node.offers) ? node.offers[0] : (node.offers || {});
        const price = moneyNumber(offer.price || offer.lowPrice || node.price);
        if (!node.name || !price) continue;
        products.push({
          id:       slug(`sn-${node.name}`),
          name:     node.name,
          series:   guessSeries(node.name),
          category: 'mattress',
          pricing:  { [guessSize(node.name)]: price },
          retailPricing: {},
          productUrl: node.url || source.url,
          verificationRequired: true,
          confidenceScore: 0.6,
          lastVerified: new Date().toISOString().slice(0, 10),
        });
      }
    } catch {}
  }
  return dedupeById(products);
}

function extractPromosFromHtml(html, source) {
  const text = html
    .replace(/<script[\s\S]*?<\/\s*script\s*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/\s*style\s*>/gi,   ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const promos  = [];
  const patterns = [
    /\$([0-9,]+)\s*(off|savings?|discount)/gi,
    /(save|get)\s*\$([0-9,]+)/gi,
    /([0-9]{1,2})%\s*off/gi,
  ];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const raw    = m[0].trim();
      const amount = moneyNumber(m[1] || m[2]);
      if (!amount || amount > 5000) continue;
      const isPercent = raw.toLowerCase().includes('%');
      promos.push({
        id:              slug(`sn-promo-${source.name}-${raw}`),
        type:            'toggle',
        name:            raw,
        description:     `Imported from ${source.name}. Review eligibility before applying.`,
        discountAmount:  isPercent ? undefined : amount,
        discountPercent: isPercent ? amount    : undefined,
        verificationRequired: true,
        confidenceScore: 0.4,
      });
    }
  }
  return dedupeById(promos).slice(0, 8);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function flattenJsonLd(v) {
  const arr = Array.isArray(v) ? v : [v];
  return arr.flatMap(item => item['@graph'] ? flattenJsonLd(item['@graph']) : [item]);
}

function cleanJson(v)         { return v.replace(/&quot;/g, '"').trim(); }
function mergeById(primary, fallback) { return [...dedupeById(primary), ...fallback.filter(x => !primary.some(p => p.id === x.id))]; }
function dedupeById(items)    { return [...new Map(items.map(item => [item.id, item])).values()]; }
function slug(v)              { return String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80); }
function guessSeries(v = '')  { const m = String(v).match(/\b(c2|c4|p5|p6|i8|i10|360|smart bed)\b/i); return m ? m[0].toUpperCase() : String(v).split(/[-–|]/)[0].trim() || 'Imported'; }
function guessSize(v = '')    { const lv = String(v).toLowerCase(); return ['Twin XL','Twin','Full','Queen','King','Cal King','FlexTop King','Split King'].find(s => lv.includes(s.toLowerCase())) || 'Queen'; }

main().catch(err => { console.error(err); process.exit(1); });
