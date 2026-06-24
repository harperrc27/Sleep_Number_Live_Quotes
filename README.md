# Sleep Quote Studio

A phone-friendly, offline-first mattress quote builder for GitHub Pages.

## What it does

- Loads a static catalog from `data/catalog.json`
- Saves the catalog locally in the browser for offline quoting
- Guides the quote flow: brand/logo-style cards, mattress, base, furniture, layers, bedding/pillows, protection plans, promos/discounts
- Runs a GitHub Actions updater every morning at 5 AM Central during daylight saving time
- Supports manual catalog refresh from the app

## Setup

1. Upload these files to your GitHub repository.
2. Go to **Settings → Pages**.
3. Set the source to **GitHub Actions** or deploy from the `main` branch root.
4. Open the GitHub Pages URL on your phone.
5. Tap **Refresh catalog** before going onto restricted Wi-Fi.
6. Add the site to your phone home screen.

## Add real product sources

Edit:

```json
scripts/sources.json
```

Add public product/deal pages or JSON feeds:

```json
{
  "name": "Store mattress deals",
  "type": "html",
  "url": "https://example.com/mattress-deals"
}
```

The updater tries structured product data first, then basic text/promo extraction. Most real websites need a little tuning after the first test run.

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

## 5 AM schedule

The workflow uses:

```yaml
cron: '0 10 * * *'
```

That is 5 AM Central during daylight saving time. During Central Standard Time, switch to:

```yaml
cron: '0 11 * * *'
```

## Important

This tool is meant to use public product/promo pages or approved feeds. Do not scrape employee-only systems or login-protected internal tools without explicit permission.
