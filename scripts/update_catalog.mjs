import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const catalogPath = path.join(root, 'data', 'catalog.json');
const sourcesPath = path.join(root, 'scripts', 'sources.json');

const moneyNumber = (value) => {
  const n = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

async function main() {
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  const config = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
  const activeSources = (config.sources || []).filter(s => s.url && /^https?:\/\//.test(s.url));

  const importedProducts = [];
  const importedPromos = [];
  const sourceResults = [];

  for (const source of activeSources) {
    try {
      const res = await fetch(source.url, { headers: { 'user-agent': 'SleepQuoteStudio/1.0 (+GitHub Actions catalog updater)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (source.type === 'json') {
        const data = JSON.parse(text);
        importedProducts.push(...extractFromJson(data, source));
      } else {
        importedProducts.push(...extractProductsFromHtml(text, source));
        importedPromos.push(...extractPromosFromHtml(text, source));
      }
      sourceResults.push({ name: source.name, url: source.url, ok: true, importedProducts: importedProducts.length, importedPromos: importedPromos.length });
    } catch (error) {
      sourceResults.push({ name: source.name, url: source.url, ok: false, error: error.message });
    }
  }

  const nextCatalog = {
    ...catalog,
    lastUpdated: new Date().toISOString(),
    sourceNotes: activeSources.length
      ? 'Catalog updater ran. Imported products are merged ahead of starter sample data when recognized.'
      : 'Catalog updater ran with no active public sources. Add URLs in scripts/sources.json.',
    sourceResults
  };

  if (importedProducts.length) {
    nextCatalog.products = mergeById(importedProducts, catalog.products || []);
  }
  if (importedPromos.length) {
    nextCatalog.promos = mergeById(importedPromos, catalog.promos || []);
  }

  await fs.writeFile(catalogPath, JSON.stringify(nextCatalog, null, 2) + '\n');
  console.log(`Catalog updated: ${nextCatalog.products.length} products, ${nextCatalog.promos.length} promos.`);
}

function extractFromJson(data, source) {
  const products = [];
  const candidates = Array.isArray(data) ? data : data.products || data.items || data.results || [];
  for (const item of candidates) {
    const name = item.name || item.title || item.productName;
    const price = moneyNumber(item.salePrice ?? item.price ?? item.currentPrice ?? item.offerPrice);
    if (!name || !price) continue;
    products.push({
      id: slug(`${source.name}-${name}`),
      brandId: guessBrandId(item.brand || name),
      series: item.series || item.collection || 'Imported',
      model: name,
      type: item.type || item.category || 'Mattress',
      size: item.size || 'Queen',
      comfort: item.comfort || item.feel || 'Medium',
      retailPrice: moneyNumber(item.retailPrice ?? item.msrp ?? price),
      salePrice: price,
      sourceUrl: source.url
    });
  }
  return products;
}

function extractProductsFromHtml(html, source) {
  const products = [];
  const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of jsonLdMatches) {
    try {
      const parsed = JSON.parse(cleanJson(match[1]));
      const nodes = flattenJsonLd(parsed);
      for (const node of nodes) {
        if (!String(node['@type'] || '').toLowerCase().includes('product')) continue;
        const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers || {};
        const price = moneyNumber(offer.price || offer.lowPrice || node.price);
        if (!node.name || !price) continue;
        products.push({
          id: slug(`${source.name}-${node.name}`),
          brandId: guessBrandId(node.brand?.name || node.brand || node.name),
          series: guessSeries(node.name),
          model: node.name,
          type: 'Mattress',
          size: guessSize(node.name),
          comfort: guessComfort(node.name),
          retailPrice: price,
          salePrice: price,
          sourceUrl: source.url
        });
      }
    } catch {}
  }
  return dedupeById(products);
}

function extractPromosFromHtml(html, source) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const promos = [];
  const patterns = [
    /\$([0-9,]+)\s*(off|savings|discount)/gi,
    /(save|get)\s*\$([0-9,]+)/gi,
    /([0-9]{1,2})%\s*off/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[0].trim();
      const amount = moneyNumber(match[1] || match[2]);
      if (!amount) continue;
      promos.push({ id: slug(`${source.name}-${raw}`), type: 'toggle', name: raw, description: `Imported from ${source.name}. Review eligibility before using.`, discountAmount: raw.includes('%') ? undefined : amount, discountPercent: raw.includes('%') ? amount : undefined });
    }
  }
  return dedupeById(promos).slice(0, 12);
}

function flattenJsonLd(value) {
  const arr = Array.isArray(value) ? value : [value];
  return arr.flatMap(item => item['@graph'] ? flattenJsonLd(item['@graph']) : [item]);
}

function cleanJson(value) { return value.replace(/&quot;/g, '"').trim(); }
function mergeById(primary, fallback) { return [...dedupeById(primary), ...fallback.filter(x => !primary.some(p => p.id === x.id))]; }
function dedupeById(items) { return [...new Map(items.map(item => [item.id, item])).values()]; }
function slug(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80); }
function guessBrandId(value = '') { const v = String(value).toLowerCase(); if (v.includes('tempur')) return 'tempur'; if (v.includes('sealy')) return 'sealy'; if (v.includes('stearns')) return 'stearns'; if (v.includes('purple')) return 'purple'; if (v.includes('beautyrest')) return 'beautyrest'; if (v.includes('serta')) return 'serta'; return 'sealy'; }
function guessSeries(value = '') { return String(value).split(/[-–|]/)[0].trim() || 'Imported'; }
function guessSize(value = '') { const v = String(value).toLowerCase(); return ['Twin XL', 'Twin', 'Full', 'Queen', 'King', 'California King'].find(s => v.includes(s.toLowerCase())) || 'Queen'; }
function guessComfort(value = '') { const v = String(value).toLowerCase(); if (v.includes('plush')) return 'Plush'; if (v.includes('firm')) return 'Firm'; if (v.includes('soft')) return 'Soft'; return 'Medium'; }

main().catch(error => { console.error(error); process.exit(1); });
