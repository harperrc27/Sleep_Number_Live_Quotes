import fs from 'node:fs/promises';
import path from 'node:path';
import { validateCatalogShape } from '../src/quote-engine.mjs';

const root = process.cwd();
const catalogPath = path.join(root, 'data', 'catalog.json');
const reportPath = path.join(root, 'data', 'refresh-report.json');
const sourcesPath = path.join(root, 'scripts', 'sources.json');

const moneyNumber = (value) => {
  const n = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 90);

function flattenJsonLd(value) {
  const arr = Array.isArray(value) ? value : [value];
  return arr.flatMap((item) => item?.['@graph'] ? flattenJsonLd(item['@graph']) : [item]);
}

function extractFromJson(data, source) {
  const items = Array.isArray(data) ? data : data?.products || data?.items || data?.results || [];
  return items.flatMap((item) => {
    const name = item.name || item.title || item.productName;
    const price = moneyNumber(item.salePrice ?? item.price ?? item.currentPrice ?? item.offerPrice);
    if (!name || !price) return [];
    return [{
      id: slug(`${source.name}-${name}`),
      name,
      brand: item.brand || 'Sleep Number',
      category: 'mattress',
      subcategory: item.type || item.category || 'smart-bed',
      series: item.series || 'Imported',
      model: item.model || name,
      size: item.size || 'Queen',
      price,
      regularPrice: moneyNumber(item.regularPrice ?? item.msrp ?? price),
      salePrice: price,
      priceLabel: 'Imported from public JSON source',
      availability: item.availability || 'unknown',
      imageUrl: item.imageUrl || '',
      productUrl: item.productUrl || source.url,
      description: item.description || '',
      tags: [item.comfort || 'Medium'].filter(Boolean),
      compatibleWith: [],
      requires: [],
      warnings: [],
      sourceUrls: [source.url],
      lastVerified: new Date().toISOString(),
      confidenceScore: 0.75
    }];
  });
}

function extractFromHtml(html, source) {
  const products = [];
  const promotions = [];
  const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  for (const match of jsonLdMatches) {
    try {
      const nodes = flattenJsonLd(JSON.parse(match[1].replace(/&quot;/g, '"').trim()));
      for (const node of nodes) {
        if (!String(node?.['@type'] || '').toLowerCase().includes('product')) continue;
        const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers || {};
        const price = moneyNumber(offer.price || offer.lowPrice || node.price);
        if (!node.name || !price) continue;
        products.push({
          id: slug(`${source.name}-${node.name}`),
          name: node.name,
          brand: node.brand?.name || node.brand || 'Sleep Number',
          category: 'mattress',
          subcategory: 'smart-bed',
          series: node.name,
          model: node.name,
          size: 'Queen',
          price,
          regularPrice: price,
          salePrice: price,
          priceLabel: 'Structured data extraction',
          availability: offer.availability || 'unknown',
          imageUrl: Array.isArray(node.image) ? node.image[0] : (node.image || ''),
          productUrl: node.url || source.url,
          description: node.description || '',
          tags: [],
          compatibleWith: [],
          requires: [],
          warnings: [],
          sourceUrls: [source.url],
          lastVerified: new Date().toISOString(),
          confidenceScore: 0.85
        });
      }
    } catch {}
  }

  const plain = html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  for (const match of plain.matchAll(/\$([0-9,]+)\s*(off|savings|discount)/gi)) {
    const amount = moneyNumber(match[1]);
    if (!amount) continue;
    promotions.push({
      id: slug(`${source.name}-${match[0]}`),
      name: match[0],
      description: 'Imported from public promo text. Verification required before use.',
      publicLegalText: 'Verify qualification and legal terms before final quote.',
      sourceUrl: source.url,
      type: 'toggle',
      discountAmount: amount,
      discountPercent: null,
      freeItem: null,
      requiredCategories: [],
      excludedCategories: [],
      requiredProducts: [],
      excludedProducts: [],
      requiredMinimum: 0,
      stackable: null,
      customerQualificationRequired: true,
      verificationRequired: true,
      priority: 50,
      confidenceScore: 0.55,
      startDate: null,
      endDate: null,
      expirationLabel: 'Verify'
    });
  }

  return { products, promotions };
}

function mergeById(primary, fallback) {
  const map = new Map(primary.map((item) => [item.id, item]));
  for (const item of fallback) if (!map.has(item.id)) map.set(item.id, item);
  return [...map.values()];
}

function diffCatalog(prev, next) {
  const prevProducts = new Map((prev.products || []).map((p) => [p.id, p]));
  const nextProducts = new Map((next.products || []).map((p) => [p.id, p]));
  const prevPromos = new Map((prev.promotions || []).map((p) => [p.id, p]));
  const nextPromos = new Map((next.promotions || []).map((p) => [p.id, p]));

  const productsAdded = [...nextProducts.keys()].filter((id) => !prevProducts.has(id));
  const productsRemoved = [...prevProducts.keys()].filter((id) => !nextProducts.has(id));
  const pricesChanged = [...nextProducts.keys()].filter((id) => prevProducts.has(id) && Number(prevProducts.get(id).price) !== Number(nextProducts.get(id).price));
  const promosChanged = [...nextPromos.keys()].filter((id) => !prevPromos.has(id) || JSON.stringify(prevPromos.get(id)) !== JSON.stringify(nextPromos.get(id)));
  const missingPrices = (next.products || []).filter((p) => !Number.isFinite(Number(p.price)) || Number(p.price) <= 0).map((p) => p.id);
  const lowConfidenceItems = (next.products || []).filter((p) => Number(p.confidenceScore || 0) < 0.7).map((p) => p.id);
  const sourceFailures = (next.sources || []).filter((s) => s.status !== 'ok').map((s) => s.id);

  return {
    generatedAt: new Date().toISOString(),
    productsAdded,
    productsRemoved,
    pricesChanged,
    promosChanged,
    brokenPages: sourceFailures,
    missingPrices,
    lowConfidenceItems,
    sourceFailures
  };
}

async function main() {
  const previous = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  const config = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));

  const activeSources = (config.sources || []).filter((s) => s.url && /^https?:\/\//.test(s.url));
  const importedProducts = [];
  const importedPromotions = [];
  const sourceResults = [];

  for (const source of activeSources) {
    try {
      const res = await fetch(source.url, { headers: { 'user-agent': 'SleepNumberQuoteAssistant/1.0 (GitHub Actions refresh)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const text = await res.text();
      if (source.type === 'json') {
        importedProducts.push(...extractFromJson(JSON.parse(text), source));
      } else {
        const extracted = extractFromHtml(text, source);
        importedProducts.push(...extracted.products);
        importedPromotions.push(...extracted.promotions);
      }

      sourceResults.push({
        id: slug(source.name),
        name: source.name,
        url: source.url,
        type: source.type || 'html',
        status: 'ok',
        httpStatus: res.status,
        lastChecked: new Date().toISOString(),
        error: null
      });
    } catch (error) {
      sourceResults.push({
        id: slug(source.name),
        name: source.name,
        url: source.url,
        type: source.type || 'html',
        status: 'failed',
        httpStatus: null,
        lastChecked: new Date().toISOString(),
        error: error.message
      });
    }
  }

  const next = {
    ...previous,
    metadata: {
      ...(previous.metadata || {}),
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      sourceNotes: activeSources.length ? 'Catalog refresh completed from configured public sources.' : 'No active public sources configured. Existing catalog retained.'
    },
    sources: sourceResults,
    sourceHealth: {
      total: sourceResults.length,
      ok: sourceResults.filter((s) => s.status === 'ok').length,
      failed: sourceResults.filter((s) => s.status !== 'ok').length,
      warnings: sourceResults.filter((s) => s.status !== 'ok').length
    },
    products: importedProducts.length ? mergeById(importedProducts, previous.products || []) : (previous.products || []),
    promotions: importedPromotions.length ? mergeById(importedPromotions, previous.promotions || []) : (previous.promotions || [])
  };

  validateCatalogShape(next);

  const report = diffCatalog(previous, next);
  await fs.writeFile(catalogPath, JSON.stringify(next, null, 2) + '\n');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');

  console.log(`Catalog refresh complete. Products: ${next.products.length}. Promotions: ${next.promotions.length}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
