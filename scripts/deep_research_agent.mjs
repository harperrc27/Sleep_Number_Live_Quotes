import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Deep Research Agent
 * ===================
 * A slow, methodical multi-pass catalog research agent.
 *
 * Phase 1  – PRIMARY FETCH     Fetch all configured sources; extract products & promos.
 * Phase 2  – LINK DISCOVERY    Discover product-related sub-page links from each primary page.
 * Phase 3  – DEEP FETCH        Fetch discovered sub-pages and extract additional data.
 * Phase 4  – RECONCILE         Cross-reference the same product across sources; use median pricing.
 * Phase 5  – PROMO DEEP SCAN   Re-scan all collected HTML with an expanded promo pattern set.
 * Phase 6  – VALIDATE          Schema and price-sanity checks; build a confidence score per item.
 * Phase 7  – REPORT            Write data/research-report.json with a full audit trail.
 * Phase 8  – CATALOG MERGE     Merge validated results into data/catalog.json.
 */

const root = process.cwd();
const catalogPath   = path.join(root, 'data', 'catalog.json');
const sourcesPath   = path.join(root, 'scripts', 'sources.json');
const reportPath    = path.join(root, 'data', 'research-report.json');

const UA = 'SleepQuoteStudio/1.0 (+GitHub Actions deep-research-agent)';
const MAX_SUBPAGES_PER_SOURCE = 15;
const FETCH_DELAY_MS          = 800;  // polite crawl delay between requests
const PRICE_MIN               = 150;
const PRICE_MAX               = 25_000;

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

const moneyNumber = (value) => {
  const n = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

const slug = (value) =>
  String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);

const dedupeById = (items) =>
  [...new Map(items.map((item) => [item.id, item])).values()];

const mergeById = (primary, fallback) => [
  ...dedupeById(primary),
  ...fallback.filter((x) => !primary.some((p) => p.id === x.id)),
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const median = (nums) => {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

function guessBrandId(value = '') {
  const v = String(value).toLowerCase();
  if (v.includes('tempur'))    return 'tempur';
  if (v.includes('sealy'))     return 'sealy';
  if (v.includes('stearns'))   return 'stearns';
  if (v.includes('purple'))    return 'purple';
  if (v.includes('beautyrest'))return 'beautyrest';
  if (v.includes('serta'))     return 'serta';
  return null;
}

function guessSeries(value = '') { return String(value).split(/[-–|]/)[0].trim() || 'Imported'; }
function guessSize(value = '') {
  const v = String(value).toLowerCase();
  return ['Twin XL','Twin','Full','Queen','King','California King'].find((s) => v.includes(s.toLowerCase())) || 'Queen';
}
function guessComfort(value = '') {
  const v = String(value).toLowerCase();
  if (v.includes('plush')) return 'Plush';
  if (v.includes('firm'))  return 'Firm';
  if (v.includes('soft'))  return 'Soft';
  return 'Medium';
}

function flattenJsonLd(value) {
  const arr = Array.isArray(value) ? value : [value];
  return arr.flatMap((item) => (item['@graph'] ? flattenJsonLd(item['@graph']) : [item]));
}

function cleanJson(value) { return value.replace(/&quot;/g, '"').trim(); }

// ---------------------------------------------------------------------------
// Fetch with retry & polite delay
// ---------------------------------------------------------------------------

async function fetchText(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = attempt * 1500;
      console.log(`  ↻ retry ${attempt}/${retries - 1} for ${url} (${err.message}) — waiting ${delay}ms`);
      await sleep(delay);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 1 – PRIMARY FETCH
// ---------------------------------------------------------------------------

function extractProductsFromHtml(html, source) {
  const products = [];
  const jsonLdMatches = [
    ...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (const match of jsonLdMatches) {
    try {
      const nodes = flattenJsonLd(JSON.parse(cleanJson(match[1])));
      for (const node of nodes) {
        if (!String(node['@type'] || '').toLowerCase().includes('product')) continue;
        const offer  = Array.isArray(node.offers) ? node.offers[0] : node.offers || {};
        const price  = moneyNumber(offer.price || offer.lowPrice || node.price);
        if (!node.name || !price) continue;
        products.push({
          id:          slug(`${source.name}-${node.name}`),
          brandId:     guessBrandId(node.brand?.name || node.brand || node.name),
          series:      guessSeries(node.name),
          model:       node.name,
          type:        'Mattress',
          size:        guessSize(node.name),
          comfort:     guessComfort(node.name),
          retailPrice: price,
          salePrice:   price,
          sourceUrl:   source.url,
          _sourceName: source.name,
        });
      }
    } catch {}
  }
  return dedupeById(products);
}

function extractPromosFromHtml(html, source) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  return extractPromosFromText(text, source);
}

// ---------------------------------------------------------------------------
// Phase 2 – LINK DISCOVERY
// ---------------------------------------------------------------------------

function discoverSubpageLinks(html, baseUrl, limit = MAX_SUBPAGES_PER_SOURCE) {
  const base   = new URL(baseUrl);
  const hrefs  = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const SUBPAGE_PATTERNS = [
    /\/mattress/i, /\/beds?\b/i, /\/product/i, /\/sleep/i,
    /\/collection/i, /\/deals?/i, /\/sale/i, /\/promotion/i,
    /\/offers?/i, /\/specials?/i, /\/savings/i,
  ];
  const seen   = new Set([baseUrl]);
  const result = [];
  for (const href of hrefs) {
    if (result.length >= limit) break;
    try {
      const url = new URL(href, base).href.split('#')[0];
      if (url === baseUrl) continue;
      if (new URL(url).hostname !== base.hostname) continue;
      if (seen.has(url)) continue;
      if (!SUBPAGE_PATTERNS.some((p) => p.test(url))) continue;
      seen.add(url);
      result.push(url);
    } catch {}
  }
  return result;
}

// ---------------------------------------------------------------------------
// Phase 4 – RECONCILE  (cross-source median pricing)
// ---------------------------------------------------------------------------

function reconcileProducts(allProducts) {
  // Group by normalised key: brandId + series + comfort + size
  const groups = new Map();
  for (const p of allProducts) {
    const key = [p.brandId || 'unknown', guessSeries(p.model), p.comfort, p.size]
      .join('|')
      .toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const reconciled = [];
  for (const [, items] of groups) {
    const retailPrices = items.map((i) => i.retailPrice).filter(Boolean);
    const salePrices   = items.map((i) => i.salePrice).filter(Boolean);
    const best         = items[0]; // primary source entry as base
    const sourceCount  = new Set(items.map((i) => i._sourceName)).size;
    reconciled.push({
      ...best,
      retailPrice:  median(retailPrices) || best.retailPrice,
      salePrice:    median(salePrices)   || best.salePrice,
      _sourceCount: sourceCount,
      _confidence:  sourceCount >= 3 ? 'high' : sourceCount === 2 ? 'medium' : 'low',
      _allSources:  [...new Set(items.map((i) => i._sourceName))],
    });
  }
  return reconciled;
}

// ---------------------------------------------------------------------------
// Phase 5 – PROMO DEEP SCAN (expanded pattern set)
// ---------------------------------------------------------------------------

function extractPromosFromText(text, source) {
  const promos = [];
  const patterns = [
    { re: /\$([0-9,]+)\s*(off|savings?|discount)/gi,        type: 'dollar' },
    { re: /(save|get)\s*\$([0-9,]+)/gi,                     type: 'dollar' },
    { re: /([0-9]{1,2})%\s*off/gi,                          type: 'percent' },
    { re: /up\s+to\s+([0-9]{1,2})%\s*off/gi,                type: 'percent' },
    { re: /([0-9]{1,2})%\s+savings?/gi,                     type: 'percent' },
    { re: /free\s+(adjustable\s+base|base|sheets?|pillows?)/gi, type: 'free-item' },
    { re: /bonus\s+\$([0-9,]+)\s*(gift\s*card|credit)/gi,   type: 'gift-card' },
    { re: /\$([0-9,]+)\s*(gift\s*card|store\s*credit)/gi,   type: 'gift-card' },
    { re: /([0-9]{1,3})\s*months?\s*(no\s+interest|0%|interest.free)/gi, type: 'financing' },
  ];
  for (const { re, type } of patterns) {
    for (const match of text.matchAll(re)) {
      const raw    = match[0].trim().replace(/\s+/g, ' ').slice(0, 80);
      const amount = moneyNumber(match[1] || match[2] || '0');
      if (type === 'financing' && amount < 6)  continue; // skip "0 months"
      if (type === 'dollar'    && amount < 10) continue;
      if (type === 'percent'   && amount < 1)  continue;
      promos.push({
        id:              slug(`${source.name}-${raw}`),
        type:            'toggle',
        promoType:       type,
        name:            raw,
        description:     `Imported from ${source.name}. Verify eligibility before applying.`,
        discountAmount:  type === 'dollar'   ? amount : undefined,
        discountPercent: type === 'percent'  ? amount : undefined,
        freeItem:        type === 'free-item'? raw : undefined,
        months:          type === 'financing'? amount : undefined,
        _sourceName:     source.name,
      });
    }
  }
  return dedupeById(promos).slice(0, 20);
}

// ---------------------------------------------------------------------------
// Phase 6 – VALIDATE
// ---------------------------------------------------------------------------

function validateProduct(p, knownBrandIds) {
  const issues = [];
  if (!p.model)                                   issues.push('missing model name');
  if (!p.brandId || !knownBrandIds.has(p.brandId))issues.push(`unrecognised brandId "${p.brandId}"`);
  if (!p.salePrice || p.salePrice < PRICE_MIN)    issues.push(`salePrice ${p.salePrice} below minimum ${PRICE_MIN}`);
  if (p.salePrice > PRICE_MAX)                    issues.push(`salePrice ${p.salePrice} above maximum ${PRICE_MAX}`);
  if (p.retailPrice && p.retailPrice < p.salePrice) issues.push('retailPrice < salePrice');
  return issues;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Deep Research Agent ===');
  console.log(`Started: ${new Date().toISOString()}\n`);

  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  const config  = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
  const knownBrandIds = new Set((catalog.brands || []).map((b) => b.id));

  const activeSources = (config.sources || []).filter(
    (s) => s.url && /^https?:\/\//.test(s.url),
  );

  const report = {
    startedAt:    new Date().toISOString(),
    phases:       {},
    anomalies:    [],
    summary:      {},
  };

  // ── Phase 1: Primary Fetch ──────────────────────────────────────────────
  console.log('Phase 1 – Primary Fetch');
  const primaryResults = [];
  for (const source of activeSources) {
    console.log(`  → ${source.name} (${source.url})`);
    await sleep(FETCH_DELAY_MS);
    try {
      const html      = await fetchText(source.url);
      const products  = extractProductsFromHtml(html, source);
      const promos    = extractPromosFromHtml(html, source);
      primaryResults.push({ source, html, products, promos, ok: true });
      console.log(`     ✓ ${products.length} products, ${promos.length} promos`);
    } catch (err) {
      primaryResults.push({ source, html: '', products: [], promos: [], ok: false, error: err.message });
      console.log(`     ✗ ${err.message}`);
    }
  }
  report.phases.primaryFetch = primaryResults.map(({ source, ok, error, products, promos }) => ({
    name: source.name, url: source.url, ok, error,
    productCount: products.length, promoCount: promos.length,
  }));

  // ── Phase 2: Link Discovery ─────────────────────────────────────────────
  console.log('\nPhase 2 – Link Discovery');
  const discoveredLinks = [];
  for (const { source, html, ok } of primaryResults) {
    if (!ok) continue;
    const links = discoverSubpageLinks(html, source.url);
    discoveredLinks.push(...links.map((url) => ({ url, parentSource: source })));
    console.log(`  → ${source.name}: found ${links.length} sub-page(s)`);
  }
  report.phases.linkDiscovery = { totalLinksFound: discoveredLinks.length };

  // ── Phase 3: Deep Fetch ─────────────────────────────────────────────────
  console.log('\nPhase 3 – Deep Fetch');
  const deepResults = [];
  for (const { url, parentSource } of discoveredLinks) {
    console.log(`  → ${url}`);
    await sleep(FETCH_DELAY_MS);
    try {
      const html     = await fetchText(url);
      const subSrc   = { name: `${parentSource.name} (sub)`, url };
      const products = extractProductsFromHtml(html, subSrc);
      const promos   = extractPromosFromHtml(html, subSrc);
      deepResults.push({ url, parentSource: parentSource.name, products, promos, ok: true });
      if (products.length || promos.length) {
        console.log(`     ✓ ${products.length} products, ${promos.length} promos`);
      }
    } catch (err) {
      deepResults.push({ url, parentSource: parentSource.name, products: [], promos: [], ok: false, error: err.message });
      console.log(`     ✗ ${err.message}`);
    }
  }
  report.phases.deepFetch = {
    pagesAttempted: deepResults.length,
    pagesOk:        deepResults.filter((r) => r.ok).length,
    extraProducts:  deepResults.reduce((s, r) => s + r.products.length, 0),
    extraPromos:    deepResults.reduce((s, r) => s + r.promos.length, 0),
  };

  // ── Phase 4: Reconcile ──────────────────────────────────────────────────
  console.log('\nPhase 4 – Cross-Source Reconciliation');
  const allProducts = [
    ...primaryResults.flatMap((r) => r.products),
    ...deepResults.flatMap((r) => r.products),
  ];
  const allPromos = dedupeById([
    ...primaryResults.flatMap((r) => r.promos),
    ...deepResults.flatMap((r) => r.promos),
  ]);
  const reconciledProducts = reconcileProducts(allProducts);
  const highConf   = reconciledProducts.filter((p) => p._confidence === 'high').length;
  const medConf    = reconciledProducts.filter((p) => p._confidence === 'medium').length;
  const lowConf    = reconciledProducts.filter((p) => p._confidence === 'low').length;
  console.log(`  Total raw: ${allProducts.length} → reconciled: ${reconciledProducts.length}`);
  console.log(`  Confidence: high=${highConf}, medium=${medConf}, low=${lowConf}`);
  report.phases.reconcile = {
    rawProductCount: allProducts.length,
    reconciledCount: reconciledProducts.length,
    highConfidence: highConf, mediumConfidence: medConf, lowConfidence: lowConf,
  };

  // ── Phase 5: Promo Deep Scan ────────────────────────────────────────────
  console.log('\nPhase 5 – Promo Deep Scan');
  const allHtmlTexts = [
    ...primaryResults.filter((r) => r.ok).map((r) => ({ text: r.html, source: r.source })),
    ...deepResults.filter((r) => r.ok).map((r) => ({
      text: r.html || '',
      source: { name: `${r.parentSource} (sub)`, url: r.url },
    })),
  ];
  const deepPromos = dedupeById(
    allHtmlTexts.flatMap(({ text, source }) => {
      const clean = text
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
      return extractPromosFromText(clean, source);
    }),
  );
  const mergedPromos = mergeById(deepPromos, allPromos);
  console.log(`  Found ${mergedPromos.length} unique promos after deep scan`);
  report.phases.promoDeepScan = { totalPromos: mergedPromos.length };

  // ── Phase 6: Validate ───────────────────────────────────────────────────
  console.log('\nPhase 6 – Validation');
  const validProducts   = [];
  const invalidProducts = [];
  for (const p of reconciledProducts) {
    const issues = validateProduct(p, knownBrandIds);
    if (issues.length) {
      invalidProducts.push({ ...p, _validationIssues: issues });
      report.anomalies.push({ type: 'product', id: p.id, issues });
    } else {
      validProducts.push(p);
    }
  }
  console.log(`  Valid: ${validProducts.length}, Invalid/flagged: ${invalidProducts.length}`);
  report.phases.validation = {
    valid: validProducts.length,
    flagged: invalidProducts.length,
    flaggedItems: invalidProducts.map((p) => ({ id: p.id, issues: p._validationIssues })),
  };

  // ── Phase 7: Report ─────────────────────────────────────────────────────
  console.log('\nPhase 7 – Writing Research Report');
  report.finishedAt = new Date().toISOString();
  report.summary = {
    sourcesConfigured: activeSources.length,
    subPagesDiscovered: discoveredLinks.length,
    rawProductsFound: allProducts.length,
    reconciledProducts: reconciledProducts.length,
    validProductsForMerge: validProducts.length,
    promosFound: mergedPromos.length,
    anomalies: report.anomalies.length,
  };
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`  → data/research-report.json written`);

  // ── Phase 8: Catalog Merge ──────────────────────────────────────────────
  console.log('\nPhase 8 – Catalog Merge');

  // Strip internal tracking fields before writing
  const cleanProduct = ({ _sourceName, _sourceCount, _confidence, _allSources, ...p }) => p;

  const nextCatalog = {
    ...catalog,
    lastUpdated:  new Date().toISOString(),
    sourceNotes:  activeSources.length
      ? `Deep research agent ran. ${validProducts.length} products merged from ${activeSources.length} sources (+ ${discoveredLinks.length} sub-pages). ${invalidProducts.length} items flagged for review.`
      : 'Deep research agent ran with no active public sources. Add URLs in scripts/sources.json.',
    deepResearch: {
      ranAt:             new Date().toISOString(),
      sourcesUsed:       activeSources.length,
      subPagesSearched:  discoveredLinks.length,
      reconciledProducts: reconciledProducts.length,
      promosFound:       mergedPromos.length,
      anomalies:         report.anomalies.length,
    },
  };

  if (validProducts.length) {
    nextCatalog.products = mergeById(validProducts.map(cleanProduct), catalog.products || []);
  }
  if (mergedPromos.length) {
    const cleanPromo = ({ _sourceName, ...p }) => p;
    nextCatalog.promos = mergeById(mergedPromos.map(cleanPromo), catalog.promos || []);
  }

  await fs.writeFile(catalogPath, JSON.stringify(nextCatalog, null, 2) + '\n');

  console.log(`\n=== Complete ===`);
  console.log(`Products: ${nextCatalog.products?.length ?? 0} total in catalog`);
  console.log(`Promos:   ${nextCatalog.promos?.length ?? 0} total in catalog`);
  console.log(`Report:   data/research-report.json`);
}

main().catch((error) => { console.error(error); process.exit(1); });
