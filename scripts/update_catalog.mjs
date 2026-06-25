import fs from 'node:fs/promises';
import path from 'node:path';

// Live catalog updater.
// Pulls REAL Sleep Number bed pricing from the public Storefront REST API and
// regenerates the products[] in data/catalog.json. Brands, addons, and promos
// are curated and preserved across runs (see scripts/sources.json "note").

const root = process.cwd();
const catalogPath = path.join(root, 'data', 'catalog.json');
const sourcesPath = path.join(root, 'scripts', 'sources.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const centsToDollars = (value) => {
  if (value == null) return 0;
  if (typeof value === 'number') return Math.round(value) / 100;
  if (typeof value === 'object' && typeof value.cents === 'number') return Math.round(value.cents) / 100;
  const n = Number(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const slug = (s) => String(s).toLowerCase().replace(/[\u2122\u00ae]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// "ComfortMode\u2122 Lux Mattress" -> "ComfortMode Lux Smart Bed"
const toModel = (apiName) => {
  const base = String(apiName)
    .replace(/[\u2122\u00ae]/g, '')
    .replace(/\bMattress\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${base} Smart Bed`;
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function main() {
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  const config = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
  const apiBase = (config.apiBase || '').replace(/\/$/, '');
  const collections = config.collections || [];
  const sizeOrder = config.sizeOrder || [];
  const sizeRank = (s) => { const i = sizeOrder.indexOf(s); return i === -1 ? 999 : i; };
  const brandOrder = (catalog.brands || []).map((b) => b.id);

  const products = [];
  const sourceResults = [];

  for (const col of collections) {
    const url = `${apiBase}/categories/${col.slug}`;
    try {
      const data = await fetchJson(url);
      const apiProducts = data.products || [];
      let rows = 0;
      for (const p of apiProducts) {
        const model = toModel(p.name || p.slug);
        const variants = p.variants || [];
        for (const v of variants) {
          const size = (v.details && Array.isArray(v.details.Size) ? v.details.Size[0] : null) || v.name;
          const retailPrice = centsToDollars(v.regular);
          const salePrice = centsToDollars(v.sale ?? v.regular);
          if (!size || !retailPrice) continue;
          products.push({
            id: `${slug(model.replace(/ Smart Bed$/, ''))}-${slug(size)}`,
            brandId: col.brandId,
            series: col.series,
            model,
            type: config.type || 'Smart Bed',
            size,
            comfort: config.comfort || 'Adjustable',
            retailPrice,
            salePrice: Math.min(salePrice || retailPrice, retailPrice)
          });
          rows++;
        }
      }
      sourceResults.push({ slug: col.slug, brandId: col.brandId, ok: true, products: rows });
    } catch (error) {
      sourceResults.push({ slug: col.slug, brandId: col.brandId, ok: false, error: error.message });
    }
  }

  if (!products.length) {
    console.error('No products fetched from the Storefront API. Leaving catalog.json unchanged.');
    console.error(JSON.stringify(sourceResults, null, 2));
    process.exitCode = 1;
    return;
  }

  // Stable de-dup by id, then sort by brand order, then size order, then price.
  const byId = new Map();
  for (const p of products) byId.set(p.id, p);
  const sorted = [...byId.values()].sort((a, b) => {
    const bo = brandOrder.indexOf(a.brandId) - brandOrder.indexOf(b.brandId);
    if (bo !== 0) return bo;
    const so = sizeRank(a.size) - sizeRank(b.size);
    if (so !== 0) return so;
    return a.retailPrice - b.retailPrice;
  });

  const nextCatalog = {
    ...catalog,
    lastUpdated: new Date().toISOString(),
    sourceNotes: config.note || 'Bed pricing pulled live from the Sleep Number Storefront API; brands, addons and promos are curated.',
    sourceResults,
    products: sorted
  };

  await fs.writeFile(catalogPath, JSON.stringify(nextCatalog, null, 2) + '\n', 'utf8');
  const perBrand = brandOrder.map((id) => `${id}=${sorted.filter((p) => p.brandId === id).length}`).join(', ');
  console.log(`Catalog updated from live API: ${sorted.length} products (${perBrand}); ${catalog.addons?.length || 0} addons + ${catalog.promos?.length || 0} promos preserved.`);
}

main().catch((error) => {
  console.error('Catalog update failed:', error.message);
  process.exitCode = 1;
});
