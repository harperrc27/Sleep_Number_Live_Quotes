# Sleep Quote Studio

A phone-friendly, offline-first mattress quote builder for GitHub Pages.

## What it does

- Loads a static catalog from `data/catalog.json`
- Saves the catalog locally in the browser for offline quoting
- Guides the quote flow: brand/logo-style cards, mattress, base, furniture, layers, bedding/pillows, protection plans, promos/discounts
- Runs a **fast catalog updater** every morning at 5 AM Central (fetches configured sources, one pass)
- Runs a **deep research agent** every morning at 6 AM Central (multi-pass: discover sub-pages → reconcile across sources → validate → report)
- Supports manual catalog refresh from the app

## Setup

1. Upload these files to your GitHub repository.
2. Go to **Settings → Pages**.
3. Set the source to **GitHub Actions** or deploy from the `main` branch root.
4. Open the GitHub Pages URL on your phone.
5. Tap **Refresh catalog** before going onto restricted Wi-Fi.
6. Add the site to your phone home screen.

## Catalog update agents

### Fast updater (`scripts/update_catalog.mjs`)

Single-pass fetcher. Reads every source in `scripts/sources.json`, extracts structured product data (JSON-LD) and promo text, and merges results into `data/catalog.json`. Runs at **5 AM Central**.

### Deep research agent (`scripts/deep_research_agent.mjs`)

Slow, methodical multi-pass agent. Runs at **6 AM Central** (one hour after the fast updater so it always starts from a fresh catalog).

**Eight phases:**

| Phase | What it does |
|-------|-------------|
| 1 – Primary Fetch | Fetches all configured sources with polite delays and automatic retries |
| 2 – Link Discovery | Finds product/promo sub-page links on each primary page |
| 3 – Deep Fetch | Fetches every discovered sub-page (up to 15 per source) |
| 4 – Reconcile | Groups the same product across sources; uses **median pricing** to smooth out stale or outlier prices |
| 5 – Promo Deep Scan | Re-scans all collected HTML with an expanded 9-pattern promo ruleset (dollar-off, percent-off, free items, gift cards, financing) |
| 6 – Validate | Schema checks, price-range sanity, brand-ID consistency; flags anomalies |
| 7 – Report | Writes `data/research-report.json` — a full audit trail of every phase |
| 8 – Catalog Merge | Merges validated products and promos; attaches a `deepResearch` summary block to the catalog |

**Confidence scoring:** products found in 3+ sources are rated `high`; 2 sources `medium`; 1 source `low`. Confidence levels appear in the research report.

Run locally:

```bash
node scripts/deep_research_agent.mjs
```

Or via npm:

```bash
npm run deep:research
```

## Running both agents manually

Go to **Actions → Update Catalog → Run workflow** and choose a mode:

| Mode | What runs |
|------|-----------|
| `fast` | Fast updater only |
| `deep` | Deep research agent only |
| `both` | Fast updater first, then deep research agent |

## Add real product sources

Edit `scripts/sources.json`. The file already contains the public product and promo pages for every brand in the catalog. Add additional public pages:

```json
{
  "name": "Store mattress deals",
  "type": "html",
  "url": "https://example.com/mattress-deals"
}
```

The updater tries structured product data (JSON-LD) first, then basic text/promo extraction. The deep research agent will also follow links it discovers on each configured page.

## Replace text-logo cards with actual logos

Put logo files in:

```text
assets/logos/
```

Then update `data/catalog.json` brand records:

```json
{
  "id": "tempur",
  "name": "Tempur-Pedic",
  "logoUrl": "assets/logos/tempur.png",
  "description": "Pressure relief and contouring foam feel."
}
```

Only use logo files you are allowed to use for your workplace tool.

## Schedule

| Agent | Cron | Central time (DST) |
|-------|------|--------------------|
| Fast updater | `0 10 * * *` | 5 AM |
| Deep research | `0 11 * * *` | 6 AM |

During Central Standard Time (UTC-6), adjust both crons by one hour:

```yaml
- cron: '0 11 * * *'   # fast  → 5 AM CST
- cron: '0 12 * * *'   # deep  → 6 AM CST
```

## Important

This tool is meant to use public product/promo pages or approved feeds. Do not scrape employee-only systems or login-protected internal tools without explicit permission.
