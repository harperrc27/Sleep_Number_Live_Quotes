# Sleep Number Quote Assistant (PWA)

Mobile-first, offline-first quote assistant using **public Sleep Number website data snapshots**.

## Plan (before implementation)

- Assess current repo and keep architecture simple/static.
- Define normalized `catalog.json` model with validation.
- Build guided quote wizard optimized for under-60-second quoting.
- Add hardware/furniture decision flow with compatibility warnings.
- Separate promo logic from hardware rules and add verification safeguards.
- Cache catalog locally for offline use after first refresh.
- Add scheduled + manual catalog refresh via GitHub Actions.
- Add refresh reporting for changed products/prices/promos and source health.
- Add focused tests for quote math, promo behavior, hardware recommendations, and schema validation.

## Current architecture

Public Sleep Number pages
→ GitHub Action (5:00 AM Central + manual dispatch)
→ `scripts/update_catalog.mjs`
→ normalized `data/catalog.json` + `data/refresh-report.json`
→ static mobile-first PWA (`index.html`, `app.js`, `styles.css`)
→ local cache (service worker + localStorage)

## Required screens included

1. Home / catalog status (header + status card)
2. New quote (button)
3. Customer basics
4. Mattress selection
5. Size/comfort selection
6. Base selection
7. Furniture/hardware setup wizard
8. Bedding/pillows
9. Protection plan
10. Promotions/discounts
11. Review quote
12. Customer-facing quote summary
13. Admin/catalog health

## Run locally

Open `index.html` with a static file server.

## Test

```bash
npm test
```

## Deploy on GitHub Pages

1. Push to GitHub.
2. In **Settings → Pages**, use GitHub Actions (or deploy root static files).
3. Open Pages URL on phone, tap **Refresh catalog**, then install as PWA.

## Daily refresh workflow

Workflow file: `.github/workflows/catalog-refresh.yml`

- Scheduled at 10:00 and 11:00 UTC with guard to run only at 5:00 AM America/Chicago.
- Also supports `workflow_dispatch` for manual refresh.
- Runs `node scripts/update_catalog.mjs`.
- Validates normalized schema.
- Commits only when `data/catalog.json` or `data/refresh-report.json` changed.

## Manual refresh options

- In app: tap **Refresh catalog**.
- In GitHub: run **Daily Catalog Refresh** via Actions.
- Local CLI: `npm run refresh:catalog`.

## Promo and hardware rules

- Promotions live in `data/catalog.json` under `promotions`.
- Hardware guidance rules live in app logic (`src/quote-engine.mjs` → `deriveHardwareOutcome`) plus `hardwareRules` metadata in catalog.
- Mark uncertain promos/items with `verificationRequired: true` and/or low `confidenceScore`.

## Known limitations

- Product extraction/parsing is intentionally lightweight for durability.
- Some public promo wording may still require manual verification.
- UI uses sample public snapshot values; verify pricing before final sale.

## Next best improvements

1. Add richer product image extraction and fallback icons by category.
2. Add stronger parser coverage for more Sleep Number public pages.
3. Improve financing promo parsing and explicit legal text capture.
4. Add printable/PDF summary export.
5. Add saved quote history and admin rule overrides.
