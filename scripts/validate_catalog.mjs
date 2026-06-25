import fs from 'node:fs/promises';
import { validateCatalogShape } from '../src/quote-engine.mjs';

const catalog = JSON.parse(await fs.readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
validateCatalogShape(catalog);
console.log('Catalog schema validation passed.');
