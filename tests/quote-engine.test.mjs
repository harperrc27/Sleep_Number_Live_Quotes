import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { calculateQuote, deriveHardwareOutcome, validateCatalogShape } from '../src/quote-engine.mjs';

const catalog = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'catalog.json'), 'utf8'));

test('catalog schema validates and prevents NaN prices', () => {
  assert.doesNotThrow(() => validateCatalogShape(catalog));
  assert.throws(() => validateCatalogShape({ ...catalog, products: [{ id: 'x', name: 'x', category: 'mattress', sourceUrls: ['u'], price: 'NaN' }] }), /NaN price/);
});

test('quote math applies automatic promo when requirements are met', () => {
  const quote = {
    productId: 'sleep-number-i8-king',
    baseId: 'flexfit-adjustable',
    planId: 'none',
    furniture: {},
    hardware: {},
    bedding: {},
    pillows: {},
    toggles: {},
    customDiscount: 0,
    taxRate: 0
  };
  const calc = calculateQuote(quote, catalog, Date.parse('2026-06-25T00:00:00.000Z'));
  assert.equal(calc.automaticPromos.length, 1);
  assert.equal(calc.automaticPromos[0].id, 'public-500-smart-bed-bundle');
  assert.ok(calc.total < calc.subtotal);
});

test('hardware recommendations include bracket and compatibility warning', () => {
  const result = deriveHardwareOutcome({
    usingAdjustableBase: true,
    usingIntegratedBase: false,
    addingHeadboard: true,
    hasFootboard: true,
    hasSideRails: false,
    hasExistingFrame: true,
    usingPlatformSlats: false,
    furnitureType: 'third-party',
    heightPreference: 'higher',
    missingRetainerBar: true,
    missingRemote: true,
    missingPowerCord: true
  });

  assert.ok(result.recommendations.includes('headboard-bracket-kit'));
  assert.ok(result.recommendations.includes('retainer-bar'));
  assert.ok(result.warnings.some((w) => w.includes('Compatibility warning')));
  assert.ok(result.warnings.some((w) => w.includes('Verify in store')));
});
