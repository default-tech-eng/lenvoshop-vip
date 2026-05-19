/* sync.js — pulls the live product catalog from api.lenvoshop.com (or any
 * configured source), normalizes to our schema, downloads new images, and
 * writes data/products.json + asset_map.json.
 *
 * Configuration via env vars:
 *   SYNC_API_BASE     base URL (default: https://api.lenvoshop.com/api/v1)
 *   SYNC_LOCALE       locale param (default: en)
 *   SYNC_DOWNLOAD_IMAGES  '1' to download images, '0' to skip (default: 1)
 *   SYNC_PER_PAGE     items per page (default: 8 — server-fixed for lenvoshop)
 *   SYNC_MAX_PAGES    safety cap (default: 200)
 *   SYNC_DRY_RUN      '1' to skip writes, just log what would change
 *
 * Run:  node scripts/sync.js
 *
 * Exit codes:
 *   0  = success, no changes (caller can skip deploy)
 *   10 = success, changes written (caller should rebuild + deploy)
 *   1  = failure (network, parse, etc.)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const ASSETS_DIR = path.join(ROOT, 'working', 'assets');
const PRODUCTS_PATH = path.join(DATA_DIR, 'products.json');
const ASSET_MAP_PATH = path.join(ROOT, 'asset_map.json');

const CONFIG = {
  apiBase: process.env.SYNC_API_BASE || 'https://api.lenvoshop.com/api/v1',
  locale: process.env.SYNC_LOCALE || 'en',
  downloadImages: (process.env.SYNC_DOWNLOAD_IMAGES || '1') !== '0',
  perPage: parseInt(process.env.SYNC_PER_PAGE || '8', 10),
  maxPages: parseInt(process.env.SYNC_MAX_PAGES || '200', 10),
  dryRun: process.env.SYNC_DRY_RUN === '1',
};

// ----------------------------------------------------------------------------

function fetchJson(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      method: 'GET',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: {
        'User-Agent': 'lenvoshop-sync/1.0',
        'Accept': 'application/json',
        'Origin': 'https://lenvoshop.com',
        'Referer': 'https://lenvoshop.com/',
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} ${urlStr}: ${body.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Parse error ${urlStr}: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error(`Timeout ${urlStr}`)); });
    req.end();
  });
}

function fetchBinary(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    lib.get({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'lenvoshop-sync/1.0' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, urlStr).href;
        return resolve(fetchBinary(next));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} ${urlStr}`));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

function pickImage(p) {
  const bi = p.base_image;
  if (bi && typeof bi === 'object') {
    return bi.medium_image_url || bi.large_image_url || bi.original_image_url || bi.small_image_url || null;
  }
  if (typeof bi === 'string') return bi;
  if (Array.isArray(p.images) && p.images[0]) {
    const i = p.images[0];
    return (i && (i.medium_image_url || i.large_image_url || i.original_image_url)) || (typeof i === 'string' ? i : null);
  }
  return null;
}

function normalize(apiProduct) {
  const baseImage = pickImage(apiProduct);
  const cleanedDesc = apiProduct.description
    ? apiProduct.description.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').slice(0, 300).trim()
    : '';
  return {
    id: apiProduct.id,
    sku: String(apiProduct.sku || ''),
    name: apiProduct.name || '',
    url_key: apiProduct.url_key || '',
    price: apiProduct.formatted_price || (apiProduct.price ? '$' + parseFloat(apiProduct.price).toFixed(2) : ''),
    raw_price: apiProduct.price ? String(apiProduct.price) : '0',
    compare_at_price: apiProduct.compare_at_price ? '$' + parseFloat(apiProduct.compare_at_price).toFixed(2) : null,
    description: cleanedDesc,
    base_image: baseImage,
    images: (apiProduct.images || []).slice(0, 5).map((i) =>
      i && (i.medium_image_url || i.large_image_url || i.original_image_url) || (typeof i === 'string' ? i : null)
    ).filter(Boolean),
    in_stock: typeof apiProduct.in_stock === 'boolean' ? apiProduct.in_stock : true,
    type: apiProduct.type || null,
  };
}

async function fetchAllProducts() {
  const all = [];
  const seen = new Set();
  for (let page = 1; page <= CONFIG.maxPages; page++) {
    const url = `${CONFIG.apiBase}/products?page=${page}&per_page=${CONFIG.perPage}&locale=${CONFIG.locale}`;
    const r = await fetchJson(url);
    if (!r || !Array.isArray(r.data) || r.data.length === 0) break;
    for (const p of r.data) {
      if (!p.sku) continue;
      const key = String(p.sku);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(normalize(p));
    }
    process.stdout.write(`page ${page}/${r.meta && r.meta.last_page || '?'} (${all.length} products)\r`);
    if (r.meta && r.meta.last_page && page >= r.meta.last_page) break;
  }
  process.stdout.write('\n');
  return all;
}

async function downloadImage(remoteUrl, sku, urlKey, assetsDir) {
  const m = remoteUrl.match(/\.(webp|jpg|jpeg|png|gif)(\?|$)/i);
  const ext = (m ? m[1] : 'webp').toLowerCase();
  const safe = (urlKey || sku).slice(0, 60).replace(/[^a-z0-9-]/gi, '-');
  const filename = `product-${safe}.${ext}`;
  const dest = path.join(assetsDir, filename);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return filename;
  try {
    const buf = await fetchBinary(remoteUrl);
    if (!buf || buf.length < 200) throw new Error('image too small');
    fs.writeFileSync(dest, buf);
    return filename;
  } catch (e) {
    console.warn(`  [image fail] ${sku}: ${e.message}`);
    return null;
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

(async () => {
  console.log('=== sync.js ===');
  console.log('Source:', CONFIG.apiBase);
  console.log('Mode:  ', CONFIG.dryRun ? 'dry-run' : 'write');
  console.log('Images:', CONFIG.downloadImages ? 'download' : 'skip');

  // Read existing
  let existing = { version: 1, synced_at: null, source: null, products: [] };
  if (fs.existsSync(PRODUCTS_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8')); } catch (e) {}
  }
  const existingBySku = {};
  for (const p of existing.products || []) existingBySku[p.sku] = p;

  let assetMap = {};
  if (fs.existsSync(ASSET_MAP_PATH)) {
    try { assetMap = JSON.parse(fs.readFileSync(ASSET_MAP_PATH, 'utf8')); } catch (e) {}
  }
  // Index asset map by sku for quick lookup
  const assetBySku = {};
  for (const [filename, info] of Object.entries(assetMap)) {
    if (info && info.sku) assetBySku[info.sku] = filename;
  }

  // Fetch
  console.log('\nFetching catalog…');
  const fetched = await fetchAllProducts();
  console.log(`Fetched ${fetched.length} products from API.`);

  if (fetched.length === 0) {
    console.error('Empty catalog from API — refusing to overwrite. Exit 1.');
    process.exit(1);
  }

  // Diff
  const fetchedBySku = {};
  for (const p of fetched) fetchedBySku[p.sku] = p;

  const newProducts = [];
  const updatedProducts = [];
  const removedProducts = [];
  const unchangedProducts = [];

  for (const p of fetched) {
    const ex = existingBySku[p.sku];
    if (!ex) newProducts.push(p);
    else if (!deepEqual(ex, p)) updatedProducts.push({ before: ex, after: p });
    else unchangedProducts.push(p);
  }
  for (const ex of existing.products || []) {
    if (!fetchedBySku[ex.sku]) removedProducts.push(ex);
  }

  console.log(`\nDiff: +${newProducts.length} new, ~${updatedProducts.length} updated, =${unchangedProducts.length} unchanged, -${removedProducts.length} gone`);

  // Download images for new products
  if (CONFIG.downloadImages && newProducts.length && !CONFIG.dryRun) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
    console.log('\nDownloading images for new products…');
    for (const p of newProducts) {
      if (!p.base_image) continue;
      const filename = await downloadImage(p.base_image, p.sku, p.url_key, ASSETS_DIR);
      if (filename) {
        assetMap[filename] = { sku: p.sku, src: p.base_image, local: 'assets/' + filename };
        process.stdout.write('.');
      } else {
        process.stdout.write('x');
      }
    }
    console.log('');
  }

  // Build new products.json — preserve order: keep existing order for unchanged/updated, append new at end
  const finalList = [];
  const handled = new Set();
  for (const ex of existing.products || []) {
    if (fetchedBySku[ex.sku]) {
      finalList.push(fetchedBySku[ex.sku]);
      handled.add(ex.sku);
    }
  }
  for (const p of fetched) {
    if (!handled.has(p.sku)) finalList.push(p);
  }

  const out = {
    version: 1,
    synced_at: new Date().toISOString(),
    source: CONFIG.apiBase,
    count: finalList.length,
    products: finalList,
  };

  if (CONFIG.dryRun) {
    console.log('\n[dry-run] would write data/products.json with', finalList.length, 'products');
    if (newProducts.length) console.log('  + new SKUs:', newProducts.map(p => p.sku).slice(0, 10).join(', '), newProducts.length > 10 ? '…' : '');
    if (removedProducts.length) console.log('  - removed SKUs:', removedProducts.map(p => p.sku).slice(0, 10).join(', '));
    process.exit(newProducts.length || updatedProducts.length || removedProducts.length ? 10 : 0);
  }

  fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(out, null, 2));
  fs.writeFileSync(ASSET_MAP_PATH, JSON.stringify(assetMap, null, 2));
  console.log('\nWrote data/products.json (', finalList.length, ' products) and asset_map.json');

  if (newProducts.length || updatedProducts.length || removedProducts.length) {
    console.log('\n✓ Changes written. Caller should rebuild + deploy. Exit 10.');
    process.exit(10);
  } else {
    console.log('\n✓ No changes. Nothing to deploy. Exit 0.');
    process.exit(0);
  }
})().catch((e) => {
  console.error('SYNC FAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
});
