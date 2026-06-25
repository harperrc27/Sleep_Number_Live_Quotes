# Sleep Number Quote Studio

A fast, mobile-first Sleep Number quote assistant for GitHub Pages. Works offline after the first load.

## What it does

- Guides a complete Sleep Number quote in under 60 seconds
- Sleep Number–specific catalog: mattresses (c2 → 360 i9), FlexFit bases, hardware, furniture, bedding, protection plans, promotions
- Smart **hardware wizard**: asks setup questions and recommends the right brackets, retainer bars, legs, etc.
- Offline-first: caches the catalog locally so it works on restricted store Wi-Fi
- Daily 5 AM catalog refresh via GitHub Actions
- PWA — installable on iPhone/Android home screen

## Setup (GitHub Pages)

1. Fork or push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Set source to **GitHub Actions**.
4. Wait for the first **Deploy to GitHub Pages** workflow to complete.
5. Open the URL on your phone. Tap **Refresh catalog** once while on Wi-Fi.
6. Add to home screen for instant PWA access.

## Daily catalog refresh

The **Update Catalog** workflow runs automatically at 5 AM Central every morning:
- Fetches Sleep Number public product/promo pages
- Extracts structured data (JSON-LD) or falls back to HTML parsing
- Validates no NaN prices enter the catalog
- Commits only when something changed
- Prints a catalog health report to the workflow log

To trigger a manual refresh:
1. Go to **Actions → Update Catalog** in your GitHub repo
2. Click **Run workflow**

The app also has a **Refresh catalog** button that re-fetches the latest committed catalog from GitHub Pages.

## Quote flow

| Step | What happens |
|------|-------------|
| 1 — Customer | Optional customer name and notes |
| 2 — Mattress | Select Sleep Number series (c2, c4, p5, p6, i8, i10, 360 i7/i9) |
| 3 — Size | Select bed size; price updates automatically |
| 4 — Base | FlexFit 1/2/3, Modular Base, Integrated Base, or skip |
| 5 — Hardware | Setup wizard: headboard, footboard, rails, height, platform? → smart recommendations |
| 6 — Bedding | Sheets, pillows, protectors |
| 7 — Protection | 3-year, 5-year, or 10-year plan |
| 8 — Promos | Auto-applied savings + toggle promos (military, first responder, manager override, etc.) |

## Hardware wizard

The wizard asks simple questions and surfaces recommendations:

| Situation | Recommendation |
|-----------|---------------|
| Adjustable base + headboard | Headboard Bracket Kit (recommended) |
| Adjustable base + footboard | Compatibility warning — verify clearance |
| Third-party headboard | Verify bolt spacing and bracket fit |
| Platform bed with adjustable base | Verify flat support and clearance |
| No base selected | Recommend Modular Base as minimum |
| Customer wants bed higher | Tall Modular Base Legs |
| Customer wants bed lower | Low-Profile Modular Base Legs |
| Adjustable base (any) | Retainer Bar (recommended) |
| Split King or FlexTop King | Center Support Bar (recommended) |

## Adding or adjusting promo rules

Edit `data/catalog.json`, in the `"promos"` array:

```json
{
  "id": "my-promo",
  "type": "automatic",
  "name": "Seasonal Sale",
  "description": "Verify current eligibility before applying.",
  "discountAmount": 400,
  "verificationRequired": true,
  "conditions": {
    "requiresCategories": ["mattress", "adjustable-base"],
    "minimumSubtotal": 2000
  }
}
```

- `type: "automatic"` — applies automatically when conditions are met
- `type: "toggle"` — shown as a manual checkbox
- `discountAmount` — fixed dollar amount
- `discountPercent` — percentage of subtotal
- `verificationRequired: true` — shows "Verify eligibility" note in UI

## Adding or adjusting hardware rules

Edit `data/catalog.json`, in the `"hardwareRules"` array:

```json
{
  "id": "rule-my-rule",
  "label": "Custom hardware rule",
  "conditions": {
    "baseCategories": ["adjustable-base"],
    "hasHeadboard": true
  },
  "recommendation": "recommended",
  "message": "This accessory is recommended.",
  "productId": "headboard-bracket-kit"
}
```

Condition keys:
- `baseCategories` — array of base categories that must match
- `hasHeadboard` / `hasFootboard` / `isPlatformBed` — boolean (true = customer said yes)
- `headboardType` — `"sleep-number"` or `"third-party"`
- `noBase` — `true` if no base is selected
- `heightConcern` — `"higher"` or `"lower"`
- `sizes` — array of bed sizes (e.g., `["Split King", "FlexTop King"]`)

Recommendation types: `"recommended"`, `"warning"`, `"verify"`

## Adding live product sources

Edit `scripts/sources.json`:

```json
{
  "sources": [
    {
      "name": "Sleep Number deals page",
      "type": "html",
      "url": "https://www.sleepnumber.com/pages/special-offers"
    }
  ]
}
```

Supported types: `"html"` (extracts JSON-LD structured data + promo patterns), `"json"` (parses product arrays).

## Running tests

```bash
npm test
```

Or directly:

```bash
node tests/quote.test.mjs
```

Tests cover: catalog schema validation, quote math, promo engine, hardware rules.

## Refreshing the catalog locally

```bash
npm run refresh:catalog
```

This fetches the latest Sleep Number public pages and writes `data/catalog.json`.

## Known limitations

- Prices in the default catalog are approximate. The **Refresh catalog** button and daily GitHub Action fetch the latest public data, but Sleep Number does not expose a public API — prices are extracted from page HTML/JSON-LD which can change.
- All prices are marked `verificationRequired: true`. Always verify at `sleepnumber.com` or in your internal system before quoting.
- Promotions change frequently. Imported promos are always marked "verify before applying."
- This tool is for internal sales use with **public** Sleep Number data only. Do not bypass authentication or scrape employee-only systems.

## File structure

```
index.html          — Main app HTML
app.js              — App logic (quote flow, hardware engine, promo engine)
styles.css          — Styles (Sleep Number navy/warm palette, mobile-first)
service-worker.js   — Offline cache
manifest.webmanifest — PWA manifest
data/
  catalog.json      — Product catalog (updated daily by GitHub Actions)
scripts/
  update_catalog.mjs — Catalog updater script
  sources.json       — Public URLs to fetch data from
tests/
  quote.test.mjs    — Unit tests (quote math, promos, hardware rules)
.github/workflows/
  update-catalog.yml — Daily 5 AM refresh + manual dispatch
  deploy.yml         — GitHub Pages deployment
```

## Important

This tool uses **public** product/promo pages only. Do not add login-protected, employee-only, or internal system URLs. All imported data is publicly accessible information.

