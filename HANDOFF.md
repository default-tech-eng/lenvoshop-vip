# Lenvoshop Static Site — Handoff

A redesigned static frontend for lenvoshop.com. Reads your live catalog from `api.lenvoshop.com`; rebuilds nightly with fresh products. You manage inventory in your existing Shopline backend — this site mirrors it.

---

## What this is (and isn't)

**This IS:**
- A complete static frontend — HTML / CSS / JS files you can upload to any web host (Cloudflare Pages, Vercel, Netlify, S3, your existing server via FTP, etc.)
- A daily catalog sync against your existing `api.lenvoshop.com` (no new backend required for catalog freshness)
- A drop-in design replacement that looks and feels like a 2025 ecommerce site

**This is NOT:**
- A working payment processor — checkout posts to a configurable endpoint that **you wire** to NMI / your processor
- An order management system — orders flow to your existing CRM via your processor's webhook
- A review platform — 10 real reviews + curated category fallbacks ship inline; swap in your own review system later if desired
- A replacement for your fulfillment / inventory / customer-data systems

---

## What plugs in vs what you wire

| Component | Status | Owner |
|---|---|---|
| Catalog (products + prices + images) | ✅ Auto-syncs daily from `api.lenvoshop.com/api/v1/products` | Already wired |
| CMS pages (shipping, returns, privacy, etc.) | ✅ Verbatim from `api.lenvoshop.com/api/v1/categories/cms-detail` | Already wired |
| Cart + drawer + discount codes | ✅ Fully functional client-side | Already wired |
| Free-shipping threshold | ✅ $69 (configurable in `config.js`) | Already wired |
| Email-popup discount code (`WELCOME10`) | ✅ Shows code inline + auto-applies to cart | Already wired |
| Search | ✅ Client-side filter on `shop.html?q=...` | Already wired |
| 7 quizzes, 10 listicles, 3 bundles, 3 buying guides | ✅ All editorial content rendered statically | Already wired |
| **Payment processing (NMI)** | ⚠️ Endpoint placeholder in `config.js` — checkout POSTs JSON to it | **You wire (2 hours)** |
| **Order persistence + CRM** | ⚠️ Your NMI webhook handles this | **You wire (your existing CRM flow)** |
| Tracking pixels (Meta, GA, TikTok) | ⚠️ Not installed | **You add to `<head>` template in `build.js`** |
| Real review platform (Yotpo, etc.) | ⚠️ Not connected — curated reviews ship inline | **Optional**, swap in if desired |

---

## Quickstart — two paths

### Path A: Just use the HTML files (simplest)
You don't need GitHub. The `working/` folder is a static site. Upload it anywhere:
```bash
cd working/
# rsync to your server
rsync -av --delete ./ user@your-server:/var/www/lenvoshop/
# OR drag to Vercel/Netlify
# OR scp / FTP / your existing deploy
```
That's it. Site works. To update content later, edit `data/*.json` locally, run `node build.js`, re-upload `working/`.

### Path B: GitHub-based with daily sync (full automation)
Useful if you want the catalog to auto-refresh every day without anyone touching anything.

```bash
# 1. Create a private GitHub repo (e.g. lenvoshop) under your org
# 2. Generate a Personal Access Token with `repo` and `workflow` scopes
# 3. Locally:
mkdir -p ~/sites
echo '{ "token": "ghp_YOUR_TOKEN" }' > ~/sites/.deploy-config.json

# 4. Build + deploy
node build.js
LV_REPO=lenvoshop node deploy.js
LV_REPO=lenvoshop node scripts/push-source.js

# 5. Enable daily sync (one-time, in the cloned repo)
mkdir -p .github/workflows
git mv ci-templates/sync.yml ci-templates/deploy.yml .github/workflows/
git commit -m "ci: enable workflows"
git push
```
After that, the cron runs daily at 06:00 UTC: pulls fresh products from your API → commits if changed → rebuilds → redeploys.

---

## Wiring the checkout to NMI

`working/config.js` has one knob:
```js
window.LV_CONFIG = {
  checkoutEndpoint: '',  // ← set this
  // ...
};
```

When the customer clicks Pay on `checkout.html`, the page POSTs JSON to `checkoutEndpoint`:
```json
{
  "items": [{ "sku": "BC647", "name": "...", "qty": 1, "price": 49.90 }],
  "shipping": { "email": "...", "firstName": "...", "address1": "...", "zip": "..." },
  "discountCode": "WELCOME10",
  "subtotal": 49.90,
  "shippingFee": 9.99,
  "total": 54.89,
  "currency": "USD"
}
```

Your endpoint expects to:
1. Receive this JSON
2. Tokenize the card via NMI's Collect.js (or call `transact.php` directly with the security key)
3. Submit the transaction to NMI
4. Fire your normal CRM webhook
5. Return JSON: `{ "redirect": "..." }` OR `{ "success": true, "orderId": "..." }` (whichever — both work)

The browser will redirect to your `successUrl` (default: `/success.html?orderid=<your-order-id>`).

**Recommended endpoint host:** Cloudflare Worker (free tier, runs server-side, can hold the NMI security key as a secret).

Until `checkoutEndpoint` is set, the Pay button shows: *"Checkout endpoint not configured. Set `checkoutEndpoint` in `config.js`."* No fake charges.

---

## About the catalog (when sync runs)

Currently `data/products.json` has the **41 hand-curated products** from our initial scrape. When you run `node scripts/sync.js`, it pulls your full catalog (~688 products as of last check) and adds the rest.

**What that looks like:**
- The 41 curated products keep their cleaned display names, badges (BEST SELLER / NEW / STAFF PICK), and appearances in listicles / bundles / quiz outcomes
- The other ~647 products appear on `shop.html` and on their own product detail pages with **raw API data**: original name, original description, base price
- No badges, no listicle features, no bundle inclusion — just plain product cards
- This is **not broken** — it's just unpolished. To polish a new product, add an entry to `data/product-overrides.json` (display name + 2-line description) and optionally tag it in `BADGES` (in `build.js`) or add it to a listicle/bundle in `data/*.json`.

**If you don't want the full 688 catalog**, set `SYNC_MAX_PAGES=5` (env var on the sync script) to cap at the first ~40 products, or run sync once and then comment out the GitHub Actions cron.

---

## Editing content

Everything content-related lives in `data/*.json`:

| File | Purpose | When to edit |
|---|---|---|
| `data/products.json` | Catalog (synced) | **Don't hand-edit** — sync overwrites it |
| `data/product-overrides.json` | Per-SKU display name + short description overrides | When sync pulls a product with bad raw name |
| `data/listicles.json` | Top-10 editorial lists | Add/edit gift guides |
| `data/bundles.json` | Bundle landing pages with auto-discount codes | Add/edit promo bundles |
| `data/buying-guides.json` | Long-form SEO articles | Add/edit deep-dive content |
| `data/quizzes.json` | Multi-step recommendation quizzes | Add seasonal quizzes |
| `data/reviews.json` | Review pool by category (shown on checkout) | Add/swap reviews |

After editing, run `node build.js` and re-upload `working/` (Path A) or commit and push (Path B).

---

## Discount codes

In `build.js`, find `var DEMO_CODES = {`:
```js
var DEMO_CODES = {
  'WELCOME10':      { type: 'pct',  value: 10 },
  'SUMMER15':       { type: 'pct',  value: 15 },
  'GRANDPARENTS15': { type: 'pct',  value: 15 },
  'SAFETY15':       { type: 'pct',  value: 15 },
};
```
Add your own; `type: 'pct'` = percent, `type: 'flat'` = dollar amount.

The popup that auto-applies `WELCOME10` lives near `<div class="email-popup">` in `build.js` — change the code there to match.

---

## Files you'll touch vs not

**Touch:**
- `data/*.json` — content
- `build.js` (`CSS` const, `DEMO_CODES`, `BADGES`) — design + codes
- `config.js` — `checkoutEndpoint`, shipping rates

**Don't touch:**
- `data/products.json` — managed by sync
- `asset_map.json` — managed by sync
- `working/*.html` — generated; rebuild instead
- `scripts/sync.js` — only if you change source API
- `deploy.js` — already handles config

---

## Troubleshooting

**Build prints "sku-validator: N issue(s)"**
A listicle/bundle references a SKU that's no longer in the catalog (likely deprecated). Edit the relevant `data/*.json` and remove or swap that pick.

**Sync exits with "Empty catalog from API"**
Refused-to-overwrite safety. Your API returned `data: []` — likely a transient issue. Existing `data/products.json` stays unchanged.

**Pay button shows "configure me" message**
`config.js` → set `checkoutEndpoint` to your NMI bridge URL.

**Daily cron isn't running (Path B)**
Check the GitHub Actions tab. Common causes: token scope, branch protection, or `SYNC_API_BASE` unreachable from GitHub's runners.

**GitHub Pages on private repo returns 404**
Pages on private repos requires GitHub Pro/Team/Enterprise. Either upgrade plan, OR set the repo variable `LV_PRIVATE=false` to make the canonical repo public.
