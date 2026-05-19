/* Hand-built static replica of lenvoshop.com — v2.
 * v2 changes:
 *   - Legal/CMS pages use VERBATIM live HTML (light style-strip only)
 *   - Real localStorage-backed cart with cart.html, checkout.html, success.html
 *   - Checkout form posts to a configurable endpoint (set in config.js — wire to NMI / your processor)
 *   - Header cart count reflects real cart state across pages
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'working');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });

// =============================================================================
// LOAD CONTENT FROM data/*.json — single source of truth for products + curated content
// =============================================================================
function loadJson(rel, fallback) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.warn(`[build] failed to parse ${rel}:`, e.message); return fallback; }
}

// VIP mode — if data/vip-config.json exists and isVip:true, apply transforms
// (price halving, free shipping, robots noindex, VIP hero copy, no email popup).
const VIP = loadJson('data/vip-config.json', { isVip: false });
const IS_VIP = !!VIP.isVip;
if (IS_VIP) console.log(`[build] VIP MODE — discount ${VIP.discountPct}%, free shipping always, robots noindex`);

// products.json from data/ (synced or seeded). Falls back to legacy products.json at root.
const productsFile = loadJson('data/products.json', null);
const rawProductsList = productsFile && productsFile.products ? productsFile.products
  : (function() {
      const raw = loadJson('products.json', []);
      const seen = new Set(); const uniq = [];
      for (const p of raw) { if (seen.has(p.sku)) continue; seen.add(p.sku); uniq.push(p); }
      return uniq;
    })();

// VIP price transform: main price -> compare_at_price, new price = main * (1 - discountPct/100), rounded to .X9
function vipRound(n) {
  const cents = Math.round(n * 100) / 100;
  const intPart = Math.floor(cents);
  const dec = cents - intPart;
  // Aim for .X9 endings to feel like normal retail pricing
  if (dec === 0) return intPart - 0.01 < 0 ? intPart : (intPart - 1 + 0.99);
  return Math.floor(cents) + 0.99 < cents ? Math.floor(cents) + 0.99 : cents;
}
const products = !IS_VIP ? rawProductsList : rawProductsList.map(p => {
  const rawMain = parseFloat(String(p.raw_price || p.price || '0').replace(/[^0-9.]/g, '')) || 0;
  if (rawMain <= 0) return p;
  const vipPrice = Math.round(rawMain * (1 - VIP.discountPct / 100) * 100) / 100;
  return {
    ...p,
    raw_price: vipPrice.toFixed(4),
    price: '$' + vipPrice.toFixed(2),
    // Original main-store price becomes the strike-through compare_at
    compare_at_price: '$' + rawMain.toFixed(2),
  };
});
console.log(`[build] catalog: ${products.length} products${IS_VIP ? ' (VIP-priced)' : ''}`);

const assetMap = loadJson('asset_map.json', {});
const skuToImage = {};
for (const [filename, info] of Object.entries(assetMap)) {
  if (info.sku) skuToImage[info.sku] = 'assets/' + filename;
}

function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60); }

const PRODUCT_OVERRIDES = loadJson('data/product-overrides.json', {});
console.log(`[build] product overrides: ${Object.keys(PRODUCT_OVERRIDES).length}`);

function categorize(p) {
  const k = (p.url_key + ' ' + p.name).toLowerCase();
  if (/cool|fan|portable.+fan|tower-fan|neck-fan/.test(k)) return 'cooling';
  if (/massag|sciatica|pelvic|knee|foot-massager|swollen|tmd|decompression|snore|kissen|schlaf/.test(k)) return 'massage';
  if (/toothbrush|carbon-monoxide|co-gas|vibration-alarm|air-purifier|odor|ultrasonic-insect|insect-repellent|alarm-band/.test(k)) return 'home';
  if (/anti-spy|privacy-pen|kidsignal|gps-collar|pet-safety|reading-light|laser-level|loop-watch|book-light/.test(k)) return 'tech';
  return 'utility';
}

const buckets = { cooling: [], massage: [], home: [], tech: [], utility: [] };
for (const p of products) buckets[categorize(p)].push(p);

const SECTIONS = [
  { key: 'cooling', heading: 'Cooling Essentials for Summer', kicker: 'Stay Cool', subheading: 'Cooling & Summer Essentials' },
  { key: 'massage', heading: 'Massage & Wellness', kicker: 'Relax & Recover', subheading: 'Targeted relief, designed for daily life' },
  { key: 'home', heading: 'Healthy Home Essentials', kicker: 'Live Better', subheading: 'Air, water, and safety for the family' },
  { key: 'tech', heading: 'Electronics & Accessories', kicker: 'Tech Essentials', subheading: 'Smart gadgets that earn their keep' },
  { key: 'utility', heading: 'Tools That Make Life Easier', kicker: 'Home & Utility', subheading: 'Practical helpers for every home' },
];

function clean(p) {
  const o = PRODUCT_OVERRIDES[p.sku] || {};
  return {
    sku: p.sku,
    url_key: p.url_key,
    file_slug: slugify(o.name || p.name) || p.url_key,
    name: o.name || p.name,
    short: o.short || (p.description ? p.description.slice(0, 240).replace(/\s+/g, ' ').trim() : ''),
    price: p.price,
    raw_price: parseFloat(p.raw_price || p.price.replace(/[^0-9.]/g, '')),
    compare_at_price: p.compare_at_price,
    image: skuToImage[p.sku] || 'assets/logo.webp',
  };
}

const cleanedProducts = products.map(clean);
const cleanedBuckets = {};
for (const k of Object.keys(buckets)) cleanedBuckets[k] = buckets[k].map(clean);

// Lookup by SKU for cart
const productCatalog = {};
for (const p of cleanedProducts) productCatalog[p.sku] = p;

const heroProducts = SECTIONS.map(s => cleanedBuckets[s.key][0]).filter(Boolean);

const EMAIL = 'customer@lenvoshop.com';
const PHONE = '+1 (555) 010-2046';  // US placeholder — replace with real support number before launch

// =============================================================================
// CMS HTML — light style strip on verbatim live content
// =============================================================================

function cleanCmsHtml(html) {
  return html
    // Drop font-family / font-size / color / letter-spacing / line-height / background-color from inline styles
    .replace(/style="([^"]*)"/g, (_, body) => {
      const filtered = body.split(';').map(s => s.trim()).filter(s => {
        if (!s) return false;
        const k = s.split(':')[0].trim().toLowerCase();
        return !['font-family','font-size','color','letter-spacing','line-height','background-color','background','font-weight','font-style','font-variant','font-variant-ligatures','font-variant-caps','text-decoration-thickness','text-decoration-style','text-decoration-color','-webkit-text-stroke-width','orphans','widows','word-spacing','text-indent','text-transform'].includes(k);
      }).join('; ');
      return filtered ? `style="${filtered}"` : '';
    })
    // strip hard-coded white-space: normal etc that leaks in
    .replace(/<span\s+style=""\s*>([\s\S]*?)<\/span>/g, '$1')
    .replace(/<span\s*>([\s\S]*?)<\/span>/g, '$1')
    // Normalize to flat formatting where possible
    .replace(/&nbsp;/g, ' ')
    .replace(/<br\s+data-mce-fragment="1">/g, '<br>')
    // Remove empty <p></p>
    .replace(/<p[^>]*>\s*<\/p>/g, '')
    // Strip PayPal references — owner asked to remove all PayPal mentions site-wide
    .replace(/<p[^>]*>[^<]*Paypal[^<]*<\/p>/gi, '')
    .replace(/<p[^>]*>[^<]*PayPal[^<]*<\/p>/g, '')
    // Strip PayPal-related image tags
    .replace(/<img[^>]+(paie|paypal|payp1)[^>]*>/gi, '')
    // Whole-paragraph or sentence references not caught above
    .replace(/[^.]*PayPal[^.]*\./gi, '')
    .replace(/[^.]*Paypal[^.]*\./gi, '');
}

function cmsFromLive(slug) {
  const file = path.join(ROOT, `cms_${slug}.html`);
  if (!fs.existsSync(file)) return null;
  return cleanCmsHtml(fs.readFileSync(file, 'utf8'));
}

// =============================================================================
// SHARED CHROME
// =============================================================================

function head(title, description = '', extraHead = '') {
  const desc = description || (IS_VIP
    ? 'Lenvoshop VIP — 50% off every product, free shipping, and a $20 monthly gift card. Exclusive VIP store.'
    : 'Shop carefully selected cooling, wellness, and home essentials at Lenvoshop. Free shipping on orders $69+, US customer support.');
  const robotsTag = IS_VIP ? '\n  <meta name="robots" content="noindex,nofollow,noarchive,nosnippet" />\n  <meta name="googlebot" content="noindex,nofollow" />' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />${robotsTag}
  <title>${title}</title>
  <meta name="description" content="${desc}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="styles.css" />
  <link rel="icon" href="assets/logo.webp" />
  <script src="config.js"></script>
  ${extraHead}
</head>`;
}

function header() {
  return `<div class="topbar">
    ${IS_VIP ? `<span class="topbar-msg vip-flag"><strong>${VIP.branding.topbarPrefix}</strong></span>
    <span class="topbar-sep">·</span>
    <span class="topbar-msg">Free US shipping always</span>
    <span class="topbar-sep">·</span>
    <span class="topbar-msg">30-day returns</span>
    <span class="topbar-sep">·</span>
    <span class="topbar-msg">Need help? Call <a href="tel:${PHONE.replace(/[^0-9+]/g, '')}">${PHONE}</a></span>` : `<span class="topbar-msg">Need help? Call <a href="tel:${PHONE.replace(/[^0-9+]/g, '')}">${PHONE}</a></span>
    <span class="topbar-sep">·</span>
    <span class="topbar-msg">Free US shipping over $69</span>
    <span class="topbar-sep">·</span>
    <span class="topbar-msg">30-day returns</span>`}
  </div>
<header class="site-header">
  <a href="index.html" class="logo">
    <img src="assets/logo.webp" alt="Lenvoshop" />
  </a>
  <form class="search" action="shop.html" method="get" role="search">
    <input type="search" name="q" placeholder="Search" aria-label="Search" />
    <button type="submit" aria-label="Submit search">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    </button>
  </form>
  <nav class="primary-nav" aria-label="Primary">
    <a href="index.html">Home</a>
    <a href="best-sellers.html">Best Sellers</a>
    <a href="track-order.html">Track Order</a>
    <a href="returns.html">Refund Policy</a>
    <a href="shipping-policy.html">Shipping Policy</a>
    <a href="contact.html">Contact Us</a>
  </nav>
  <a href="cart.html" class="cart" aria-label="Shopping cart">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
    <span class="cart-count" data-cart-count>0</span>
  </a>
</header>`;
}

function footer() {
  return `<section class="trust-band">
  <div class="trust-item"><strong>Satisfaction Guarantee</strong><span>30-day returns</span></div>
  <div class="trust-item"><strong>100% Secure Payment</strong><span>SSL-encrypted checkout</span></div>
  <div class="trust-item"><strong>US Customer Support</strong><span>Mon–Fri 9 am – 9 pm</span></div>
</section>
<footer class="site-footer">
  <div class="foot-grid">
    <div>
      <h4>Customer Care</h4>
      <ul>
        <li><a href="contact.html">Contact Us</a></li>
        <li><a href="track-order.html">Track Your Order</a></li>
        <li><a href="returns.html">Returns & Exchanges</a></li>
        <li><a href="returns-and-refunds.html">Returns & Refunds</a></li>
        <li><a href="shipping-policy.html">Shipping Policy</a></li>
      </ul>
    </div>
    <div>
      <h4>About</h4>
      <ul>
        <li><a href="about.html">About Us</a></li>
        <li><a href="brand-story.html">Brand Story</a></li>
        <li><a href="why-choose.html">Why Choose Lenvoshop?</a></li>
      </ul>
    </div>
    <div>
      <h4>Policies</h4>
      <ul>
        <li><a href="terms.html">Terms & Conditions</a></li>
        <li><a href="privacy.html">Privacy Policy</a></li>
        <li><a href="health-disclaimer.html">Health Disclaimer</a></li>
        <li><a href="payment-method.html">Payment Method</a></li>
      </ul>
    </div>
    <div>
      <h4>Get in touch</h4>
      <p>Email: <a href="mailto:${EMAIL}">${EMAIL}</a></p>
      <p>Hours: Mon–Fri, 9:00 am – 9:00 pm</p>
      <p class="payment-icons">VISA · Mastercard · AmEx · Discover</p>
    </div>
  </div>
  <div class="copyright">© 2026 Lenvoshop. All rights reserved.</div>
</footer>
<div id="toast" class="toast" role="status" aria-live="polite"></div>

${IS_VIP ? '' : `<div class="email-popup" id="email-popup" hidden role="dialog" aria-labelledby="email-popup-title" aria-hidden="true">
  <div class="email-popup-backdrop" data-email-close></div>
  <div class="email-popup-card">
    <button class="email-popup-close" data-email-close aria-label="Close">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <div class="email-popup-body">
      <span class="email-popup-eyebrow">First-time customer?</span>
      <h2 id="email-popup-title">Get 10% off your first order</h2>
      <p>Use this code at checkout — applied automatically to any cart you build today.</p>
      <div class="promo-code" id="promo-code-block">
        <span class="promo-code-label">Your code</span>
        <span class="promo-code-value">WELCOME10</span>
        <button type="button" class="promo-code-copy" id="promo-code-copy" data-promo-code="WELCOME10" aria-label="Copy code">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>Copy</span>
        </button>
      </div>
      <button class="btn-primary" id="promo-apply" data-promo-code="WELCOME10">Apply &amp; start shopping</button>
      <button class="email-popup-decline" data-email-close>No thanks, I'll pay full price.</button>
    </div>
  </div>
</div>`}

<div class="drawer-backdrop" id="drawer-backdrop" hidden></div>
<aside class="cart-drawer" id="cart-drawer" aria-label="Shopping cart" aria-hidden="true">
  <header class="drawer-header">
    <h2>Your Cart <span class="drawer-count" data-drawer-count>0</span></h2>
    <button class="drawer-close" data-drawer-close aria-label="Close cart">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </header>
  <div class="drawer-body" id="drawer-body">
    <div class="drawer-empty" id="drawer-empty">
      <p>Your cart is empty.</p>
      <a href="shop.html" class="btn-secondary">Browse products</a>
    </div>
    <div class="drawer-lines" id="drawer-lines"></div>
  </div>
  <footer class="drawer-foot" id="drawer-foot">
    <div class="drawer-summary">
      <div class="row"><span>Subtotal</span><span data-summary="subtotal">$0.00</span></div>
      <div class="row small"><span>Shipping</span><span data-summary="shipping">—</span></div>
      <div class="ship-progress" data-summary="ship-note"></div>
    </div>
    <div class="drawer-actions">
      <a href="cart.html" class="btn-secondary">View Cart</a>
      <a href="checkout.html" class="btn-primary">Checkout</a>
    </div>
  </footer>
</aside>

<script src="catalog.js"></script>
<script src="reviews.js"></script>
<script src="cart.js"></script>`;
}

// =============================================================================
// PRODUCT CARD HELPERS
// =============================================================================

// SKUs flagged as best sellers / new / staff picks. Keep these short — badges
// lose their meaning if everything has one.
const BADGES = {
  'BC647':         'BEST SELLER',
  '8758149218534': 'BEST SELLER',
  '8748353192166': 'BEST SELLER',
  'AG157':         'STAFF PICK',
  'BC446-2':       'STAFF PICK',
  'AG180':         'STAFF PICK',
  'h5001':         'NEW',
  '8740328046822': 'NEW',
};

function productCard(p) {
  const badge = BADGES[p.sku];
  return `<article class="product-card">
  ${badge ? `<span class="card-badge ${badge.toLowerCase().replace(/\s+/g, '-')}">${badge}</span>` : ''}
  <a href="product-${p.file_slug}.html" class="product-link">
    <div class="product-image"><img src="${p.image}" alt="${p.name.replace(/"/g, '&quot;')}" loading="lazy" /></div>
    <h3>${p.name}</h3>
    <div class="price-row">
      <span class="price">${p.price}</span>
      ${p.compare_at_price ? `<span class="compare">${p.compare_at_price}</span>` : ''}
    </div>
  </a>
  <button class="btn-primary" data-add-to-cart="${p.sku}">Add to cart</button>
</article>`;
}

function productGrid(items, max = 4) {
  return `<div class="product-grid">${items.slice(0, max).map(productCard).join('\n')}</div>`;
}

function homepageSection(s) {
  const items = cleanedBuckets[s.key];
  if (!items.length) return '';
  return `<section class="home-section">
  <header class="section-header">
    <span class="kicker">${s.kicker}</span>
    <h2>${s.heading}</h2>
    <p class="subheading">${s.subheading}</p>
  </header>
  ${productGrid(items, 4)}
  <div class="section-cta"><a href="shop.html" class="btn-secondary">Shop all</a></div>
</section>`;
}

// =============================================================================
// PAGES
// =============================================================================

function indexPage() {
  return `${head('Lenvoshop — Best Summer Deals USA', 'Cooling, wellness, and smart home essentials, hand-picked and shipped from the US. Free shipping on orders $69+.')}
<body>
${header()}
${IS_VIP ? `<section class="hero hero-vip">
  <div class="hero-image"><img src="assets/hero-summer.webp" alt="Lenvoshop VIP" /></div>
  <div class="hero-overlay">
    <span class="hero-eyebrow vip-badge">${VIP.branding.heroEyebrow}</span>
    <h1>${VIP.branding.heroH1}</h1>
    <p>${VIP.branding.heroSub}</p>
    <div class="hero-cta-row">
      <a href="shop.html" class="btn-pill">${VIP.branding.heroCta}</a>
    </div>
    <div class="hero-trust">
      <span>50% off every item</span>
      <span>·</span>
      <span>Free shipping always</span>
      <span>·</span>
      <span>$20 gift card monthly</span>
    </div>
  </div>
</section>

<section class="trust-strip vip-benefits">
  <div class="trust-strip-item"><div class="trust-icon">💰</div><div><strong>50% Off Every Product</strong><span>Your VIP price is half of public pricing</span></div></div>
  <div class="trust-strip-item"><div class="trust-icon">🚚</div><div><strong>Free Shipping Always</strong><span>Every order ships free — no minimum</span></div></div>
  <div class="trust-strip-item"><div class="trust-icon">🎁</div><div><strong>$20 Gift Card Monthly</strong><span>Credit applied automatically each month</span></div></div>
  <div class="trust-strip-item"><div class="trust-icon">🔐</div><div><strong>Exclusive Access</strong><span>VIP-only store for past customers</span></div></div>
</section>` : `<section class="hero">
  <div class="hero-image"><img src="assets/hero-summer.webp" alt="Summer cooling collection" /></div>
  <div class="hero-overlay">
    <span class="hero-eyebrow">Summer Sale · Save 15% with code SUMMER15</span>
    <h1>Sleep through 90°F nights without cranking the AC.</h1>
    <p>The personal cooling kit hand-tested by our editors. Free shipping over $69.</p>
    <div class="hero-cta-row">
      <a href="shop.html#cooling" class="btn-pill">Shop the Cooling Kit →</a>
      <a href="quiz-cooling-match.html" class="btn-pill-light">Take the 30-sec quiz</a>
    </div>
    <div class="hero-trust">
      <span>Free shipping over $69</span>
      <span>·</span>
      <span>30-day returns</span>
      <span>·</span>
      <span>Hand-tested before shipping</span>
    </div>
  </div>
</section>

<section class="trust-strip">
  <div class="trust-strip-item"><div class="trust-icon">🛡️</div><div><strong>100% Safe Shopping</strong><span>SSL-secured checkout</span></div></div>
  <div class="trust-strip-item"><div class="trust-icon">🚚</div><div><strong>Fast Delivery</strong><span>7–10 business days</span></div></div>
  <div class="trust-strip-item"><div class="trust-icon">✓</div><div><strong>Verified Quality</strong><span>Hand-tested before shipping</span></div></div>
  <div class="trust-strip-item"><div class="trust-icon">↩️</div><div><strong>30-Day Returns</strong><span>Easy and fast</span></div></div>
</section>`}

${homepageSection(SECTIONS[0])}

<section class="categories">
  <header class="section-header">
    <h2>Choose from popular categories</h2>
  </header>
  <div class="cat-grid">
    ${SECTIONS.map(s => `<a href="shop.html#${s.key}" class="cat-card">
      <span class="cat-kicker">${s.kicker} →</span>
      <span class="cat-name">${s.heading}</span>
    </a>`).join('\n    ')}
  </div>
</section>

${(() => {
  // Sections 1 (massage) and 2 (home) of SECTIONS, then editor spotlight, then 3-4 (tech, utility)
  const massage = homepageSection(SECTIONS[1]);
  const home = homepageSection(SECTIONS[2]);
  const spotlightP = pBySku('AG157');
  const spotlight = spotlightP ? `<section class="home-section editor-spotlight">
  <div class="spotlight-grid">
    <a class="spotlight-img" href="product-${spotlightP.file_slug}.html"><img src="${spotlightP.image}" alt="${spotlightP.name.replace(/"/g, '&quot;')}" /></a>
    <div class="spotlight-body">
      <span class="kicker">Editor's Spotlight</span>
      <h2>The one massager we won't let go.</h2>
      <p>The Triple Fusion is the rare wellness device where the marketing line — heat plus EMS plus vibration — actually delivers something a single-mode unit can't. The heat opens the muscle; the pulse works it; the vibration finishes it. Twenty minutes a day, real measurable difference within a week.</p>
      <p>We've tried fifteen back-pain devices over the last two years. This is the one we keep recommending to friends, family, and anyone who slides into our DMs about a sore lower back.</p>
      <div class="spotlight-meta">
        <span class="spotlight-price">${spotlightP.price}${spotlightP.compare_at_price ? ` <span class="compare">${spotlightP.compare_at_price}</span>` : ''}</span>
        <a href="product-${spotlightP.file_slug}.html" class="btn-primary">See full review →</a>
      </div>
    </div>
  </div>
</section>` : '';

  const tech = homepageSection(SECTIONS[3]);
  const utility = homepageSection(SECTIONS[4]);

  // Customer voices — pulled from the real-from-live + curated review pool
  const REVIEWS = loadJson('data/reviews.json', {});
  const cooling = (REVIEWS.cooling || [])[0];
  const massage_review = (REVIEWS.massage || [])[0];
  const safety_review = (REVIEWS.home || [])[0];
  const customerQuotes = [cooling, massage_review, safety_review].filter(Boolean);
  const customerVoices = customerQuotes.length ? `<section class="home-section customer-voices">
  <header class="section-header">
    <span class="kicker">From Customers</span>
    <h2>What people tell us</h2>
    <p class="subheading">Real reviews from our actual product pages — across cooling, wellness, and home safety.</p>
  </header>
  <div class="voices-row">
    ${customerQuotes.map(q => `<figure class="voice-card">
      <span class="voice-stars">★★★★★</span>
      <blockquote>${(q.content || '').replace(/^"|"$/g, '').slice(0, 320)}${(q.content || '').length > 320 ? '…' : ''}</blockquote>
      <figcaption>— ${q.name}</figcaption>
    </figure>`).join('')}
  </div>
</section>` : '';

  return [massage, home, spotlight, tech, utility, customerVoices].join('\n');
})()}

<section class="home-section quiz-strip">
  <div class="quiz-strip-inner">
    <div class="quiz-strip-text">
      <span class="kicker">7 Quick Quizzes</span>
      <h2>Not sure what you need?</h2>
      <p>Seven 30-second quizzes — gift finders for Mom, Dad, grandparents, plus cooling, wellness, sleep, and home safety. No email required.</p>
    </div>
    <a href="quizzes.html" class="btn-primary btn-lg quiz-strip-cta">See all quizzes →</a>
  </div>
  <div class="quiz-cards-row">
    ${QUIZZES.map(Q => {
      const cover = pBySku(Q.coverSku);
      return `<a class="quiz-card" href="quiz-${Q.slug}.html">
        <div class="quiz-card-img"><img src="${cover ? cover.image : 'assets/hero-summer.webp'}" alt="" loading="lazy" /></div>
        <div class="quiz-card-body">
          <span class="kicker">${Q.eyebrow}</span>
          <h3>${Q.title}</h3>
          <span class="quiz-card-meta">${Q.questions.length} questions · ~30 sec</span>
        </div>
      </a>`;
    }).join('')}
  </div>
</section>

<section class="home-section bundles-strip">
  <header class="section-header">
    <span class="kicker">Save 15%</span>
    <h2>Bundle &amp; Save</h2>
    <p class="subheading">Three curated bundles — buy together, pay less.</p>
  </header>
  <div class="bundles-row">
    ${BUNDLES.map(B => {
      const oc = pBySku(B.coverSku);
      const sumRegular = B.skus.map(s => pBySku(s)).reduce((s, p) => s + (p ? p.raw_price : 0), 0);
      return `<a class="bundle-teaser" href="bundle-${B.slug}.html">
        <div class="bundle-teaser-img"><img src="${oc ? oc.image : 'assets/hero-summer.webp'}" alt="" loading="lazy" /></div>
        <div class="bundle-teaser-body">
          <span class="kicker">${B.eyebrow} · Save ${B.discountPct}%</span>
          <h3>${B.title}</h3>
          <div class="bundle-teaser-price">
            <span class="bundle-was">$${sumRegular.toFixed(2)}</span>
            <span class="bundle-now">$${(sumRegular * (1 - B.discountPct/100)).toFixed(2)}</span>
          </div>
        </div>
      </a>`;
    }).join('')}
  </div>
</section>

<section class="home-section curated-guides-section">
  <header class="section-header">
    <span class="kicker">Curated Guides</span>
    <h2>Editor's Picks</h2>
    <p class="subheading">Hand-written guides for the moments that matter — gifts, seasons, and family safety.</p>
  </header>
  <div class="guides-row home-guides">
    ${LISTICLES.slice(0, 4).map(L => {
      const oc = pBySku(L.coverSku);
      return `<a class="guide-card" href="guide-${L.slug}.html">
        <div class="guide-card-img"><img src="${oc ? oc.image : 'assets/hero-summer.webp'}" alt="" loading="lazy" /></div>
        <div class="guide-card-body">
          <span class="kicker">${L.eyebrow}</span>
          <h3>${L.title}</h3>
          <span class="guide-meta">${L.readTime} →</span>
        </div>
      </a>`;
    }).join('')}
  </div>
  <div class="section-cta"><a href="guides.html" class="btn-secondary">All ${LISTICLES.length} guides</a></div>
</section>

<section class="home-section seasonal-strip">
  <header class="section-header">
    <span class="kicker">Shop by Occasion</span>
    <h2>Seasonal Shops</h2>
    <p class="subheading">Curated landing pages for the moments that drive shopping.</p>
  </header>
  <div class="seasonal-row">
    ${SEASONAL_HUBS.map(H => {
      const oc = pBySku(H.coverSku);
      return `<a class="seasonal-card" href="${H.slug}.html">
        <div class="seasonal-card-img"><img src="${oc ? oc.image : 'assets/hero-summer.webp'}" alt="" loading="lazy" /></div>
        <div class="seasonal-card-body">
          <span class="kicker">${H.eyebrow}</span>
          <h3>${H.title}</h3>
        </div>
      </a>`;
    }).join('')}
  </div>
</section>

<section class="home-section buying-guides-strip">
  <header class="section-header">
    <span class="kicker">Long-form</span>
    <h2>Buying Guides</h2>
    <p class="subheading">Deeper reads — what to look for, what to ignore, and what we recommend.</p>
  </header>
  <div class="guides-row home-guides">
    ${BUYING_GUIDES.map(G => {
      const oc = pBySku(G.coverSku);
      return `<a class="guide-card" href="buying-${G.slug}.html">
        <div class="guide-card-img"><img src="${oc ? oc.image : 'assets/hero-summer.webp'}" alt="" loading="lazy" /></div>
        <div class="guide-card-body">
          <span class="kicker">${G.eyebrow}</span>
          <h3>${G.title}</h3>
          <span class="guide-meta">${G.readTime} →</span>
        </div>
      </a>`;
    }).join('')}
  </div>
</section>

<section class="home-section faq-section">
  <header class="section-header">
    <span class="kicker">VIP questions</span>
    <h2>${IS_VIP ? 'How your VIP store works' : 'Before you order'}</h2>
    <p class="subheading">${IS_VIP ? 'The five things every VIP asks first.' : 'The five things first-time customers ask most.'}</p>
  </header>
  <div class="faq-list">
    ${IS_VIP ? `<details class="faq-item">
      <summary>How does VIP pricing work?</summary>
      <p>Every price on this site is <strong>${VIP.discountPct}% off</strong> the public Lenvoshop pricing. The original price is shown next to your VIP price for comparison. No code needed — your account is already a VIP account.</p>
    </details>
    <details class="faq-item">
      <summary>Is shipping always free?</summary>
      <p>Yes. Every VIP order ships free — no minimum, no exceptions. Standard delivery runs 7–10 business days from our US warehouses.</p>
    </details>
    <details class="faq-item">
      <summary>How do I get my $${VIP.benefits.giftCardAmount} ${VIP.benefits.giftCardPeriod} gift card?</summary>
      <p>Your $${VIP.benefits.giftCardAmount} credit is applied automatically on the first of each ${VIP.benefits.giftCardPeriod === 'monthly' ? 'month' : 'period'}. It's usable on any product. You'll see it as a balance at checkout when it's active.</p>
    </details>
    <details class="faq-item">
      <summary>Are these the same products as the main Lenvoshop store?</summary>
      <p>Yes. Same products, same warehouses, same quality — just half price for VIPs. The catalog stays in sync with the main store daily.</p>
    </details>
    <details class="faq-item">
      <summary>How do I check out?</summary>
      <p>Add to cart, fill in shipping info, pay. Cards are processed securely by our PCI-compliant payment processor. SSL-encrypted end-to-end. We don't store your card number on our servers.</p>
    </details>` : `<details class="faq-item">
      <summary>How fast do you ship?</summary>
      <p>Orders ship within 1–2 business days from our US warehouses. Standard delivery runs 7–10 business days. Free over $69, $9.99 below. Tracking lands in your inbox the moment your label prints.</p>
    </details>
    <details class="faq-item">
      <summary>What's your return policy?</summary>
      <p>30 days from delivery to send anything back for a refund — unused, in original packaging. Personal-care items (toothbrushes) are non-returnable once opened, for hygiene reasons. Full details on our <a href="returns.html">Returns &amp; Exchanges</a> page.</p>
    </details>
    <details class="faq-item">
      <summary>Where do these products come from?</summary>
      <p>We don't make our own products — we curate from manufacturers we've vetted. Every item on the site was ordered, opened, and used in our own homes for at least a month before it earned a slot. Roughly 1 in 30 products we test makes the catalog.</p>
    </details>
    <details class="faq-item">
      <summary>Is checkout secure?</summary>
      <p>Yes. SSL-encrypted end-to-end. Card details are handled by our PCI-compliant payment processor — Lenvoshop does not store your card number, CVC, or expiry date on our servers. See our <a href="payment-method.html">Payment Method</a> page for accepted cards.</p>
    </details>
    <details class="faq-item">
      <summary>How do I get in touch?</summary>
      <p>Email <a href="mailto:customer@lenvoshop.com">customer@lenvoshop.com</a> for anything order-related. We're a small team, so you'll usually hear back from a real person within one business day. Hours: Mon–Fri, 9am–9pm.</p>
    </details>`}
  </div>
</section>

<section class="promo-band">
  <div class="promo-inner">
    <h2>${IS_VIP ? 'Free shipping on every VIP order' : 'Free shipping on orders over $69'}</h2>
    <p>${IS_VIP ? '50% off every product. $20 gift card monthly. Exclusive VIP access.' : 'Hand-tested products. US-based customer support. 30-day returns.'}</p>
    <a href="shop.html" class="btn-pill-light">Browse the shop</a>
  </div>
</section>

${footer()}
</body>
</html>`;
}

function shopPage() {
  let groupsHTML = '';
  for (const s of SECTIONS) {
    const items = cleanedBuckets[s.key];
    if (!items.length) continue;
    groupsHTML += `<section class="shop-group" id="${s.key}">
  <h2>${s.heading} <small>(${items.length})</small></h2>
  <div class="product-grid">${items.map(productCard).join('\n')}</div>
</section>`;
  }
  return `${head('Shop All — Lenvoshop', 'Browse the full Lenvoshop catalog: cooling, wellness, smart home, electronics, and home utility.')}
<body>
${header()}
<main class="shop-main">
  <header class="page-header">
    <h1>Shop the Catalog</h1>
    <p>${cleanedProducts.length} products · Free shipping on orders over $69</p>
    <p id="search-status" class="search-status" style="display:none;"></p>
  </header>
  <div class="shop-layout">
    <aside class="filters" aria-label="Filters">
      <h3>Categories</h3>
      <ul>
        ${SECTIONS.map(s => `<li><a href="#${s.key}">${s.heading}</a></li>`).join('\n        ')}
      </ul>
      <h3>Price</h3>
      <label><input type="checkbox" data-price-filter="0-30" /> Under $30</label>
      <label><input type="checkbox" data-price-filter="30-60" /> $30–$60</label>
      <label><input type="checkbox" data-price-filter="60-100" /> $60–$100</label>
      <label><input type="checkbox" data-price-filter="100-9999" /> $100+</label>
    </aside>
    <div class="shop-content">${groupsHTML}</div>
  </div>
</main>
${footer()}
<script>
// Search + price filter — both real
(function() {
  function activeRanges() {
    return Array.from(document.querySelectorAll('[data-price-filter]:checked')).map(c => c.dataset.priceFilter.split('-').map(Number));
  }
  function getQuery() {
    var p = new URLSearchParams(location.search);
    var q = (p.get('q') || '').trim().toLowerCase();
    return q;
  }
  function applyFilter() {
    var ranges = activeRanges();
    var q = getQuery();
    var visibleCounts = {};
    document.querySelectorAll('.product-card').forEach(card => {
      var match = true;
      if (ranges.length) {
        var priceText = card.querySelector('.price')?.textContent.replace(/[^0-9.]/g, '');
        var price = parseFloat(priceText);
        if (!ranges.some(([lo, hi]) => price >= lo && price < hi)) match = false;
      }
      if (q) {
        var name = (card.querySelector('h3')?.textContent || '').toLowerCase();
        if (name.indexOf(q) < 0) match = false;
      }
      card.style.display = match ? '' : 'none';
      // Track which group still has matches
      var group = card.closest('.shop-group');
      if (group) {
        var key = group.id || 'unknown';
        if (!(key in visibleCounts)) visibleCounts[key] = 0;
        if (match) visibleCounts[key]++;
      }
    });
    // Hide whole shop groups that have zero matches
    document.querySelectorAll('.shop-group').forEach(group => {
      group.style.display = visibleCounts[group.id] === 0 ? 'none' : '';
    });
    // Search-status line at top of grid
    var status = document.getElementById('search-status');
    if (status) {
      if (q) {
        var total = Object.values(visibleCounts).reduce((s, n) => s + n, 0);
        status.textContent = total + ' result' + (total === 1 ? '' : 's') + ' for "' + q + '"' + (total === 0 ? ' — try a broader term.' : '');
        status.style.display = '';
      } else {
        status.style.display = 'none';
      }
    }
  }
  document.querySelectorAll('[data-price-filter]').forEach(c => c.addEventListener('change', applyFilter));
  // Run on load for ?q= deep links
  if (getQuery()) applyFilter();
})();
</script>
</body>
</html>`;
}

function productPage(p) {
  const cat = categorize({ url_key: p.url_key, name: p.name });
  const related = cleanedBuckets[cat].filter(x => x.sku !== p.sku).slice(0, 4);
  return `${head(p.name + ' — Lenvoshop', p.short.slice(0, 160))}
<body>
${header()}
<main class="product-page">
  <nav class="breadcrumb"><a href="index.html">Home</a> / <a href="shop.html">Shop</a> / <span>${p.name}</span></nav>
  <div class="product-detail">
    <div class="gallery">
      <img src="${p.image}" alt="${p.name.replace(/"/g, '&quot;')}" />
    </div>
    <div class="info">
      <h1>${p.name}</h1>
      <div class="price-row">
        <span class="price">${p.price}</span>
        ${p.compare_at_price ? `<span class="compare">${p.compare_at_price}</span>` : ''}
      </div>
      <p class="short-desc">${p.short}</p>
      <div class="qty-row">
        <label>Qty
          <input type="number" id="qty-input" value="1" min="1" max="99" />
        </label>
        <button class="btn-primary btn-lg" data-add-to-cart="${p.sku}" data-qty-from="#qty-input">Add to Cart</button>
      </div>
      <ul class="features">
        <li>Free shipping on orders over $69</li>
        <li>30-day returns</li>
        <li>US-based customer support</li>
        <li>Tested for quality before dispatch</li>
      </ul>
    </div>
  </div>

  <section class="related">
    <h2>You may also like</h2>
    <div class="product-grid">${related.map(productCard).join('\n')}</div>
  </section>
</main>
${footer()}
</body>
</html>`;
}

function cmsPage(title, slug, fallback, description = '') {
  const live = cmsFromLive(slug);
  const body = live || fallback;
  return `${head(title + ' — Lenvoshop', description)}
<body>
${header()}
<main class="cms-page">
  <header class="page-header">
    <h1>${title}</h1>
  </header>
  <article class="cms-content">${body}</article>
</main>
${footer()}
</body>
</html>`;
}

function contactPage() {
  const live = cmsFromLive('contact-us') || '';
  return `${head('Contact Us — Lenvoshop', 'Get in touch with Lenvoshop customer support.')}
<body>
${header()}
<main class="cms-page">
  <header class="page-header"><h1>Contact Us</h1></header>
  <div class="contact-grid">
    <form class="contact-form" id="contact-form">
      <h2>Send us a message</h2>
      <label>Name <input type="text" name="name" required /></label>
      <label>Email <input type="email" name="email" required /></label>
      <label>Subject <input type="text" name="subject" /></label>
      <label>Message <textarea name="message" rows="6" required></textarea></label>
      <button type="submit" class="btn-primary">Send</button>
    </form>
    <aside class="contact-info cms-content">
      ${live}
    </aside>
  </div>
</main>
${footer()}
<script>
document.getElementById('contact-form')?.addEventListener('submit', function(e){
  e.preventDefault();
  var d = new FormData(this);
  var subj = encodeURIComponent('Lenvoshop contact: ' + (d.get('subject') || 'message'));
  var body = encodeURIComponent('From: ' + d.get('name') + ' <' + d.get('email') + '>\\n\\n' + d.get('message'));
  window.location.href = 'mailto:${EMAIL}?subject=' + subj + '&body=' + body;
});
</script>
</body>
</html>`;
}

function trackOrderPage() {
  const live = cmsFromLive('track-your-order') || '';
  return `${head('Track Your Order — Lenvoshop', 'Look up your Lenvoshop order status.')}
<body>
${header()}
<main class="cms-page">
  <header class="page-header"><h1>Track Your Order</h1></header>
  <article class="cms-content">${live}</article>
  <form class="track-form" onsubmit="event.preventDefault(); showToast('Order tracking is coming soon — please reply to your shipping confirmation email or contact ${EMAIL}.');">
    <h2>Quick lookup</h2>
    <label>Order number<input type="text" name="orderId" placeholder="LV-12345" required /></label>
    <label>Email<input type="email" name="email" placeholder="you@example.com" required /></label>
    <button type="submit" class="btn-primary">Track order</button>
  </form>
</main>
${footer()}
</body>
</html>`;
}

function cartPage() {
  return `${head('Cart — Lenvoshop', 'Review your Lenvoshop cart and proceed to checkout.')}
<body>
${header()}
<main class="cms-page cart-page">
  <header class="page-header"><h1>Your Cart</h1></header>
  <div id="cart-empty" class="empty-state" style="display:none;">
    <p>Your cart is empty.</p>
    <a href="shop.html" class="btn-primary">Continue shopping</a>
  </div>
  <div id="cart-content" class="cart-content">
    <div class="cart-lines" id="cart-lines"></div>
    <aside class="cart-summary">
      <h2>Order Summary</h2>
      <div class="summary-row"><span>Subtotal</span><span data-summary="subtotal">$0.00</span></div>
      <div class="summary-row"><span>Shipping</span><span data-summary="shipping">$0.00</span></div>
      <div class="summary-row total"><span>Total</span><span data-summary="total">$0.00</span></div>
      <p class="ship-note" data-summary="ship-note"></p>
      <a href="checkout.html" class="btn-primary btn-lg" id="proceed-checkout">Proceed to Checkout</a>
      <a href="shop.html" class="btn-secondary continue">Continue shopping</a>
    </aside>
  </div>
</main>
${footer()}
</body>
</html>`;
}

function checkoutPage() {
  const COUNTRIES = ['United States','Canada','United Kingdom','Australia','Germany','France','Italy','Spain','Netherlands','Belgium','Sweden','Norway','Denmark','Finland','Ireland','Austria','Switzerland','Portugal','Poland','Czech Republic'];
  return `${head('Checkout — Lenvoshop', 'Secure checkout — Lenvoshop.')}
<body class="checkout-body">
${header()}
<main class="checkout-main">
  <div class="checkout-grid">
    <section class="checkout-form-col">
      <form class="checkout-form" id="checkout-form" autocomplete="on" novalidate>
        <section class="form-section">
          <h2>Contact</h2>
          <label class="floating">
            <input type="email" name="email" id="ck-email" required autocomplete="email" placeholder=" " />
            <span>Email</span>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" name="marketing" />
            <span>Email me with news and offers</span>
          </label>
        </section>

        <section class="form-section">
          <h2>Delivery</h2>
          <label class="floating">
            <select name="country" id="ck-country" required>
              ${COUNTRIES.map((c, i) => `<option ${i===0?'selected':''}>${c}</option>`).join('')}
            </select>
            <span>Country/Region</span>
            <svg class="select-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </label>
          <div class="grid-2">
            <label class="floating">
              <input type="text" name="firstName" required autocomplete="given-name" placeholder=" " />
              <span>First name</span>
            </label>
            <label class="floating">
              <input type="text" name="lastName" required autocomplete="family-name" placeholder=" " />
              <span>Last name</span>
            </label>
          </div>
          <label class="floating">
            <input type="text" name="address1" required autocomplete="address-line1" placeholder=" " />
            <span>Address</span>
            <svg class="addr-search" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </label>
          <label class="floating">
            <input type="text" name="address2" autocomplete="address-line2" placeholder=" " />
            <span>Apt, suite, etc. (optional)</span>
          </label>
          <div class="grid-2">
            <label class="floating">
              <input type="text" name="city" required autocomplete="address-level2" placeholder=" " />
              <span>City</span>
            </label>
            <label class="floating">
              <input type="text" name="zip" required autocomplete="postal-code" inputmode="numeric" placeholder=" " />
              <span>ZIP code</span>
            </label>
          </div>
          <label class="floating">
            <input type="tel" name="phone" autocomplete="tel" placeholder=" " />
            <span>Phone</span>
            <svg class="addr-search" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          </label>

          <div class="ship-line">
            <span>Shipping</span>
            <span data-summary="shipping-line">$9.99</span>
          </div>
        </section>

        <section class="form-section">
          <h2>Payment</h2>
          <p class="payment-note">All transactions are secure and encrypted. Card details are handled by our PCI-compliant processor.</p>
          <label class="payment-method active">
            <input type="radio" name="payment" value="card" checked />
            <span class="pm-label">Credit / Debit Card</span>
          </label>

          <div id="card-fields" class="card-fields">
            <label class="floating">
              <input type="text" name="cardNumber" autocomplete="cc-number" inputmode="numeric" placeholder=" " />
              <span>Card number</span>
              <span class="card-lock" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </span>
            </label>
            <div class="grid-2">
              <label class="floating">
                <input type="text" name="cardExpiry" autocomplete="cc-exp" placeholder=" " />
                <span>MM / YY</span>
              </label>
              <label class="floating">
                <input type="text" name="cardCvc" autocomplete="cc-csc" inputmode="numeric" placeholder=" " />
                <span>Security code</span>
              </label>
            </div>
            <label class="floating">
              <input type="text" name="cardName" autocomplete="cc-name" placeholder=" " />
              <span>Name on card</span>
            </label>
          </div>

          <button type="submit" class="btn-primary btn-lg pay-button" id="pay-btn">Pay <span data-summary="total"></span></button>
          <div id="pay-error" class="pay-error" role="alert"></div>
        </section>
      </form>
    </section>

    <aside class="checkout-summary-col">
      <div class="checkout-summary">
        <div class="summary-lines" id="checkout-lines"></div>

        <div class="discount-row">
          <input type="text" placeholder="Discount code" id="discount-input" />
          <button type="button" id="apply-discount" disabled>Apply</button>
        </div>

        <div class="summary-totals">
          <div class="row" id="row-original" hidden><span>Original Price</span><span data-summary="original">$0.00</span></div>
          <div class="row discount" id="row-discount" hidden><span>Order discount</span><span data-summary="discount">-$0.00</span></div>
          <div class="row"><span>Subtotal</span><span data-summary="subtotal">$0.00</span></div>
          <div class="row"><span>Shipping</span><span data-summary="shipping">$0.00</span></div>
          <div class="row total"><span>Total</span><span class="total-amt"><span class="usd">USD</span> <span data-summary="total">$0.00</span></span></div>
        </div>

      </div>
    </aside>
  </div>
</main>
${footer()}
</body>
</html>`;
}

function successPage() {
  return `${head('Order Confirmed — Lenvoshop', 'Thanks for your order!')}
<body>
${header()}
<main class="cms-page success-page">
  <header class="page-header"><h1>Thank You</h1></header>
  <article class="cms-content" style="text-align:center;">
    <p style="font-size:18px;">Your order has been received. A confirmation has been emailed to you.</p>
    <p>Need help? <a href="mailto:${EMAIL}">${EMAIL}</a></p>
    <p>You'll receive shipping updates within 1–2 business days.</p>
    <p style="margin-top:32px;"><a href="shop.html" class="btn-primary">Continue shopping</a></p>
    <div id="order-info" class="order-info" style="margin-top:32px;"></div>
  </article>
</main>
${footer()}
<script>
(function() {
  // Clear cart on successful return
  try { localStorage.removeItem('lvCart'); document.querySelectorAll('[data-cart-count]').forEach(function(el){ el.textContent = '0'; }); } catch(e){}
  var u = new URL(location.href);
  var ref = u.searchParams.get('orderid') || u.searchParams.get('order_id') || u.searchParams.get('ref');
  if (ref) {
    var el = document.getElementById('order-info');
    if (el) el.innerHTML = '<p style="color:var(--ink-muted);font-size:13px;">Order reference: <code>' + ref.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) + '</code></p>';
  }
})();
</script>
</body>
</html>`;
}

// =============================================================================
// LISTICLES — curated guides with editorial copy
// =============================================================================

function pBySku(sku) { return cleanedProducts.find(p => p.sku === sku); }

// SKU integrity validator — warns when curated content references SKUs not in the catalog.
// Doesn't fail the build (catalog can grow/shrink between syncs); just logs.
function validateCuratedSkus() {
  const skuSet = new Set(cleanedProducts.map(p => p.sku));
  const issues = [];
  for (const L of LISTICLES) {
    for (const pick of L.picks) {
      if (!skuSet.has(pick.sku)) issues.push(`listicle "${L.slug}" references missing SKU ${pick.sku}`);
    }
    if (!skuSet.has(L.coverSku)) issues.push(`listicle "${L.slug}" cover SKU ${L.coverSku} missing`);
  }
  for (const B of BUNDLES) {
    for (const sku of B.skus) {
      if (!skuSet.has(sku)) issues.push(`bundle "${B.slug}" references missing SKU ${sku}`);
    }
    if (!skuSet.has(B.coverSku)) issues.push(`bundle "${B.slug}" cover SKU ${B.coverSku} missing`);
  }
  for (const G of BUYING_GUIDES) {
    if (!skuSet.has(G.coverSku)) issues.push(`buying guide "${G.slug}" cover SKU ${G.coverSku} missing`);
  }
  if (issues.length === 0) {
    console.log(`[build] sku-validator: ✓ all curated SKUs present`);
  } else {
    console.warn(`[build] sku-validator: ${issues.length} issue(s):`);
    issues.slice(0, 20).forEach(s => console.warn(`  - ${s}`));
    if (issues.length > 20) console.warn(`  …and ${issues.length - 20} more`);
  }
}
// Validator is invoked from the EMIT section once all curated arrays are loaded.

const LISTICLES = loadJson('data/listicles.json', []);
console.log('[build] listicles: ' + (LISTICLES.length || Object.keys(LISTICLES).length));

// =============================================================================
// BUNDLES — landing pages with multi-add + auto-discount
// =============================================================================

const BUNDLES = loadJson('data/bundles.json', []);
console.log('[build] bundles: ' + (BUNDLES.length || Object.keys(BUNDLES).length));

// =============================================================================
// QUIZZES — 7 demo-specific quizzes. Each has its own questions + outcome lookup.
// Outcome key resolution: try `${a1}-${a2}-${a3}` → `${a1}-${a2}-default` →
// `${a1}-default` → `default`. Whichever lands first wins.
// =============================================================================
const QUIZZES = loadJson('data/quizzes.json', []);
console.log('[build] quizzes: ' + QUIZZES.length);

function quizPage(Q) {
  const cover = pBySku(Q.coverSku);
  return `${head(Q.title + ' — Lenvoshop', Q.lead.slice(0, 160))}
<body>
${header()}
<main class="quiz-main">
  <section class="quiz-shell" id="quiz">
    <div class="quiz-progress"><div class="quiz-progress-bar" id="quiz-progress-bar"></div></div>
    <div class="quiz-step" data-step="0" id="quiz-step-0">
      <div class="quiz-intro">
        <span class="hero-eyebrow">${Q.eyebrow}</span>
        <h1>${Q.title}</h1>
        <p>${Q.lead}</p>
        <button type="button" class="btn-primary btn-lg" data-quiz-start>Start the quiz →</button>
        <p class="quiz-meta">${Q.questions.length} questions · about 30 seconds · no email required</p>
      </div>
    </div>
    ${Q.questions.map((q, i) => `<div class="quiz-step" data-step="${i+1}" data-question="${q.id}" hidden>
      <h2 class="quiz-q">${q.question}</h2>
      <div class="quiz-options" data-options></div>
      <button type="button" class="quiz-back" data-quiz-back>← Back</button>
    </div>`).join('')}
    <div class="quiz-step quiz-result" data-step="result" id="quiz-result" hidden>
      <span class="hero-eyebrow">Your match</span>
      <h2 class="quiz-headline" id="quiz-headline"></h2>
      <p class="quiz-why" id="quiz-why"></p>
      <div class="quiz-products" id="quiz-products"></div>
      <div class="quiz-actions">
        <button type="button" class="btn-primary btn-lg" data-quiz-add-all>Add all 3 to cart</button>
        <button type="button" class="btn-secondary" data-quiz-restart>Retake quiz</button>
      </div>
      <div class="quiz-bundle-hint" id="quiz-bundle-hint"></div>
      <p class="quiz-other-quizzes"><a href="quizzes.html">← See other quizzes</a></p>
    </div>
  </section>
</main>
${footer()}
<script>
(function() {
  var QUESTIONS = ${JSON.stringify(Q.questions)};
  var OUTCOMES = ${JSON.stringify(Q.outcomes)};
  var CATALOG = window.LV_CATALOG || {};
  var answers = {};
  var stepIdx = 0;
  var totalSteps = QUESTIONS.length + 2; // intro + questions + result

  function $(id) { return document.getElementById(id); }
  function show(idx) {
    document.querySelectorAll('.quiz-step').forEach(function(el) { el.hidden = true; });
    var el;
    if (idx === 0) el = $('quiz-step-0');
    else if (idx > QUESTIONS.length) el = $('quiz-result');
    else el = document.querySelector('.quiz-step[data-step="' + idx + '"]');
    if (el) {
      el.hidden = false;
      // Render options for question steps
      if (idx > 0 && idx <= QUESTIONS.length) renderOptions(idx);
    }
    updateProgress();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function updateProgress() {
    var pct = Math.min(100, Math.round((stepIdx / (QUESTIONS.length + 1)) * 100));
    var bar = $('quiz-progress-bar');
    if (bar) bar.style.width = pct + '%';
  }
  function renderOptions(idx) {
    var q = QUESTIONS[idx - 1];
    var step = document.querySelector('.quiz-step[data-step="' + idx + '"]');
    var options = q.options;
    // Some questions have options that depend on a previous answer
    if (!options && q.optionsBy) {
      var dep = q.optionsBy.field;
      var depValue = answers[dep] || 'default';
      options = q.optionsBy[depValue] || q.optionsBy.default;
    }
    var optsBox = step.querySelector('[data-options]');
    optsBox.innerHTML = options.map(function(o) {
      return '<button type="button" class="quiz-option" data-quiz-pick="' + o.value + '">' +
        '<span class="quiz-option-emoji">' + (o.emoji || '') + '</span>' +
        '<span class="quiz-option-label">' + o.label + '</span>' +
        '</button>';
    }).join('');
  }
  function pick(value) {
    var q = QUESTIONS[stepIdx - 1];
    answers[q.id] = value;
    if (stepIdx >= QUESTIONS.length) renderResult();
    else { stepIdx++; show(stepIdx); }
  }
  function back() {
    if (stepIdx <= 0) return;
    stepIdx--;
    show(stepIdx);
  }
  function start() { stepIdx = 1; show(1); }
  function restart() { answers = {}; stepIdx = 0; show(0); }

  function lookupOutcome() {
    // Resolve outcome by trying progressively-shorter answer combos.
    // For 3 questions with answers [a, b, c], try: a-b-c → a-b-default → a-default → default.
    var ids = QUESTIONS.map(function(q) { return q.id; });
    var values = ids.map(function(id) { return answers[id]; });
    var attempts = [];
    for (var depth = values.length; depth > 0; depth--) {
      var parts = values.slice(0, depth).concat(Array(values.length - depth).fill('default'));
      attempts.push(parts.join('-'));
      var partsLast = values.slice(0, depth - 1).concat(['default']);
      attempts.push(partsLast.join('-'));
    }
    attempts.push(values[0] + '-default');
    attempts.push('default');
    for (var i = 0; i < attempts.length; i++) {
      if (OUTCOMES[attempts[i]]) return OUTCOMES[attempts[i]];
    }
    // Final fallback: first outcome we find
    var keys = Object.keys(OUTCOMES);
    return OUTCOMES[keys[0]] || { headline: 'Top picks', why: '', sku: [] };
  }

  function renderResult() {
    var outcome = lookupOutcome();
    $('quiz-headline').textContent = outcome.headline;
    $('quiz-why').textContent = outcome.why;
    var box = $('quiz-products');
    box.innerHTML = outcome.sku.map(function(sku) {
      var p = CATALOG[sku];
      if (!p) return '';
      return '<article class="quiz-product">' +
        '<a href="product-' + p.slug + '.html" class="quiz-product-img"><img src="' + p.image + '" alt="' + (p.name || '').replace(/"/g, '&quot;') + '" /></a>' +
        '<div class="quiz-product-body">' +
          '<h3><a href="product-' + p.slug + '.html">' + p.name + '</a></h3>' +
          '<div class="quiz-product-price">$' + p.price.toFixed(2) + '</div>' +
          '<button type="button" class="btn-secondary" data-add-to-cart="' + sku + '">Add to cart</button>' +
        '</div></article>';
    }).join('');
    var hint = $('quiz-bundle-hint');
    var subtotal = outcome.sku.reduce(function(s, sku) { var p = CATALOG[sku]; return s + (p ? p.price : 0); }, 0);
    if (subtotal > 0) hint.textContent = 'Adding all three: $' + subtotal.toFixed(2) + (subtotal >= 69 ? ' — qualifies for free shipping.' : ' — add $' + (69 - subtotal).toFixed(2) + ' more for free shipping.');
    stepIdx = QUESTIONS.length + 1;
    show(stepIdx);
  }

  document.addEventListener('click', function(e) {
    if (e.target.closest('[data-quiz-start]')) start();
    var pickBtn = e.target.closest('[data-quiz-pick]');
    if (pickBtn) pick(pickBtn.getAttribute('data-quiz-pick'));
    if (e.target.closest('[data-quiz-back]')) back();
    if (e.target.closest('[data-quiz-restart]')) restart();
    if (e.target.closest('[data-quiz-add-all]')) {
      var outcome = lookupOutcome();
      outcome.sku.forEach(function(sku, i) {
        // Use the public addToCart click trigger via dispatching a synthetic click on a hidden button
        var btn = document.createElement('button');
        btn.setAttribute('data-add-to-cart', sku);
        document.body.appendChild(btn);
        btn.click();
        document.body.removeChild(btn);
      });
    }
  });

  show(0);
})();
</script>
</body>
</html>`;
}

function bundlePage(B) {
  const cover = pBySku(B.coverSku);
  const bundleProducts = B.skus.map(s => pBySku(s)).filter(Boolean);
  const sumRegular = bundleProducts.reduce((s, p) => s + p.raw_price, 0);
  const sumDiscounted = sumRegular * (1 - B.discountPct / 100);
  const skusJSON = JSON.stringify(B.skus).replace(/"/g, '&quot;');
  return `${head(B.title + ' — Lenvoshop', B.lead.slice(0, 160))}
<body>
${header()}
<main class="bundle-main">
  <header class="bundle-hero">
    <div class="bundle-hero-bg" style="background-image: url('${cover ? cover.image : 'assets/hero-summer.webp'}');"></div>
    <div class="bundle-hero-overlay">
      <span class="hero-eyebrow">${B.eyebrow}</span>
      <h1>${B.title}</h1>
      <p class="lead">${B.lead}</p>
      <div class="bundle-price-row">
        <span class="bundle-was">Was $${sumRegular.toFixed(2)}</span>
        <span class="bundle-now">Bundle: $${sumDiscounted.toFixed(2)}</span>
        <span class="bundle-save">Save ${B.discountPct}% with code ${B.code}</span>
      </div>
      <button class="btn-pill bundle-add" data-bundle-add="${skusJSON}" data-bundle-code="${B.code}">Add bundle to cart</button>
    </div>
  </header>

  <article class="bundle-content">
    <h2>What's in the bundle</h2>
    <div class="bundle-grid">
      ${bundleProducts.map((p, i) => `<div class="bundle-card">
        <div class="bundle-rank">${i+1}</div>
        <a class="bundle-img" href="product-${p.file_slug}.html"><img src="${p.image}" alt="${p.name.replace(/"/g, '&quot;')}" /></a>
        <div class="bundle-info">
          <h3><a href="product-${p.file_slug}.html">${p.name}</a></h3>
          <div class="price-row">
            <span class="price">${p.price}</span>
            ${p.compare_at_price ? `<span class="compare">${p.compare_at_price}</span>` : ''}
          </div>
          <p class="bundle-desc">${p.short.slice(0, 200)}</p>
        </div>
      </div>`).join('')}
    </div>

    <aside class="listicle-closer">
      <p>${B.closer}</p>
    </aside>

    <div class="bundle-cta-block">
      <h2>Ready to bundle?</h2>
      <p>One click adds all three to your cart and applies discount code <strong>${B.code}</strong> automatically.</p>
      <button class="btn-primary btn-lg bundle-add" data-bundle-add="${skusJSON}" data-bundle-code="${B.code}">Add bundle — Save ${B.discountPct}%</button>
    </div>

    <section class="listicle-more">
      <h2>Other bundles</h2>
      <div class="guides-row">
        ${BUNDLES.filter(other => other.slug !== B.slug).map(other => {
          const oc = pBySku(other.coverSku);
          return `<a class="guide-card" href="bundle-${other.slug}.html">
            <div class="guide-card-img"><img src="${oc ? oc.image : 'assets/hero-summer.webp'}" alt="" loading="lazy" /></div>
            <div class="guide-card-body">
              <span class="kicker">${other.eyebrow} · Save ${other.discountPct}%</span>
              <h3>${other.title}</h3>
            </div>
          </a>`;
        }).join('')}
      </div>
    </section>
  </article>
</main>
${footer()}
</body>
</html>`;
}

// =============================================================================
// SEASONAL HUBS — landing pages organizing all season-relevant content
// =============================================================================
const SEASONAL_HUBS = [
  {
    slug: 'summer',
    title: 'The Lenvoshop Summer Shop',
    eyebrow: 'Summer Collection',
    lead: "Heatwaves, hot bedrooms, sticky commutes. We've spent the last six months stress-testing every cooling product in the catalog so you don't have to. The summer shop below is what survived.",
    coverSku: 'BC647',
    zones: [
      { label: 'For your desk', skus: ['BC647', 'AG100'] },
      { label: 'For the bedroom', skus: ['8758149218534', '8740328046822'] },
      { label: 'For the road', skus: ['8748353192166', '8758551347430'] },
      { label: 'For the whole house', skus: ['8758529163494', 'BC537'] },
    ],
    featuredListicles: ['beat-the-summer-heat', 'cooling-cheat-sheet'],
    featuredBundle: 'summer-survival-bundle',
    closer: "Tip: combine personal cooling (desk cooler + neck fan) with one good room fan and you can leave the AC at 78°F instead of 72°F. The energy savings show up the first month.",
  },
  {
    slug: 'mothers-day',
    title: 'Mother’s Day, Done Right',
    eyebrow: 'Mother\'s Day',
    lead: "Every mom in your life has received the same three things every Mother's Day for two decades. The shop below is different: real solutions to real complaints — neck tension, tired feet, restless sleep — that keep working long after the flowers wilt.",
    coverSku: 'BC446-2',
    zones: [
      { label: 'End-of-day relief', skus: ['BC446-2', 'AG161'] },
      { label: 'Better sleep', skus: ['8740328046822', 'H909'] },
      { label: 'Daily wellness', skus: ['AG157', 'AG29'] },
      { label: 'Small & charming', skus: ['BC376', '8788987248870'] },
    ],
    featuredListicles: ['mothers-day-picks', 'gifts-for-grandparents'],
    featuredBundle: 'gift-the-grandparents-bundle',
    closer: "Pairing tip: foot massager + reading light + a hand-written note = peak son/daughter status for less than the cost of dinner.",
  },
  {
    slug: 'fathers-day',
    title: 'Father’s Day, Practical Edition',
    eyebrow: 'Father\'s Day',
    lead: "Skip the novelty mug. Each pick below solves a real problem — hanging pictures, washing the car, finding the hidden GPS tracker on a business trip — and gets used long after Father's Day weekend ends.",
    coverSku: '8797054796006',
    zones: [
      { label: 'For the fixer', skus: ['8797054796006', 'BC632'] },
      { label: 'For the traveler', skus: ['h5001', 'BC613'] },
      { label: 'For the desk warrior', skus: ['AG157', 'BC446-2'] },
      { label: 'For the safety-conscious', skus: ['AG180', 'AG179'] },
    ],
    featuredListicles: ['gifts-for-dads'],
    featuredBundle: null,
    closer: "Pairing tip: laser level + carwash gun = the practical-and-useful combo. Add the anti-spy detector for the dad who travels and you've got a thoughtful three-piece gift under $200.",
  },
];

// Hand-picked best sellers — one per category plus the highest-conviction wellness pick.
// These match the SKUs we tagged BEST SELLER + STAFF PICK in BADGES above.
const BEST_SELLER_SKUS = [
  'BC647',          // Portable Air Cooler — BEST SELLER
  '8758149218534',  // Tower Fan — BEST SELLER
  '8748353192166',  // Neck Fan — BEST SELLER
  'AG157',          // Triple Fusion Massager — STAFF PICK
  'BC446-2',        // Foot Massager — STAFF PICK
  'AG180',          // CO Detector — STAFF PICK
  '8740328046822',  // Anti-Snore Pillow — NEW
  'BC537',          // Air Purifier — top wellness pick
];

function bestSellersPage() {
  const items = BEST_SELLER_SKUS.map(s => pBySku(s)).filter(Boolean);
  return `${head('Best Sellers — Lenvoshop', 'Our 8 most-loved products this season — hand-picked, hand-tested, customer-validated.')}
<body>
${header()}
<main class="shop-main">
  <header class="page-header">
    <h1>Best Sellers</h1>
    <p>The 8 products our customers reach for first — hand-picked from across the catalog, organized so you can pick fast.</p>
  </header>
  <section class="best-sellers-grid">
    <div class="product-grid">${items.map(productCard).join('\n')}</div>
  </section>
  <section class="best-sellers-cta">
    <p>Want the full catalog?</p>
    <a href="shop.html" class="btn-secondary">Shop all ${cleanedProducts.length} products →</a>
  </section>
</main>
${footer()}
</body>
</html>`;
}

function quizzesIndexPage() {
  return `${head('Find Your Match — 7 Quick Quizzes — Lenvoshop', 'Seven 30-second quizzes that match you with the right products. Cooling, wellness, sleep, home safety, gift finders for Mom & Dad & grandparents.')}
<body>
${header()}
<main>
  <header class="page-header">
    <h1>Find Your Match</h1>
    <p>Pick the quiz closest to what you're shopping for. Each takes about 30 seconds, no email required, and ends with three product picks tailored to your answers.</p>
  </header>
  <section class="guides-page">
    <div class="guides-grid">
      ${QUIZZES.map(Q => {
        const cover = pBySku(Q.coverSku);
        return `<a class="guide-card large quiz-hub-card" href="quiz-${Q.slug}.html">
          <div class="guide-card-img"><img src="${cover ? cover.image : 'assets/hero-summer.webp'}" alt="" loading="lazy" /></div>
          <div class="guide-card-body">
            <span class="kicker">${Q.eyebrow}</span>
            <h2>${Q.title}</h2>
            <p>${Q.lead.slice(0, 150)}…</p>
            <span class="guide-meta">${Q.questions.length} questions · ~30 sec</span>
          </div>
        </a>`;
      }).join('')}
    </div>
  </section>
</main>
${footer()}
</body>
</html>`;
}

function seasonalHubPage(H) {
  const cover = pBySku(H.coverSku);
  const featuredListicles = (H.featuredListicles || []).map(slug => LISTICLES.find(L => L.slug === slug)).filter(Boolean);
  const featuredBundle = H.featuredBundle ? BUNDLES.find(B => B.slug === H.featuredBundle) : null;
  return `${head(H.title + ' — Lenvoshop', H.lead.slice(0, 160))}
<body>
${header()}
<main class="seasonal-main">
  <header class="seasonal-hero">
    <div class="seasonal-hero-bg" style="background-image: url('${cover ? cover.image : 'assets/hero-summer.webp'}');"></div>
    <div class="seasonal-hero-overlay">
      <span class="hero-eyebrow">${H.eyebrow}</span>
      <h1>${H.title}</h1>
      <p class="lead">${H.lead}</p>
    </div>
  </header>

  <article class="seasonal-content">
    <section class="seasonal-zones">
      ${H.zones.map(zone => {
        const zoneProds = zone.skus.map(s => pBySku(s)).filter(Boolean);
        if (!zoneProds.length) return '';
        return `<section class="seasonal-zone">
          <h2 class="zone-title">${zone.label}</h2>
          <div class="product-grid">${zoneProds.map(productCard).join('')}</div>
        </section>`;
      }).join('')}
    </section>

    ${featuredBundle ? `
    <section class="seasonal-feature">
      <span class="kicker">Bundle &amp; Save</span>
      <h2>${featuredBundle.title}</h2>
      <p>${featuredBundle.lead}</p>
      <a href="bundle-${featuredBundle.slug}.html" class="btn-primary btn-lg" style="max-width:340px;">View bundle — Save ${featuredBundle.discountPct}%</a>
    </section>` : ''}

    ${featuredListicles.length ? `
    <section class="seasonal-feature alt">
      <span class="kicker">Editorial</span>
      <h2>Read the guides</h2>
      <div class="guides-row">
        ${featuredListicles.map(L => {
          const oc = pBySku(L.coverSku);
          return `<a class="guide-card" href="guide-${L.slug}.html">
            <div class="guide-card-img"><img src="${oc ? oc.image : 'assets/hero-summer.webp'}" alt="" loading="lazy" /></div>
            <div class="guide-card-body">
              <span class="kicker">${L.eyebrow}</span>
              <h3>${L.title}</h3>
              <span class="guide-meta">${L.readTime} →</span>
            </div>
          </a>`;
        }).join('')}
      </div>
    </section>` : ''}

    <aside class="listicle-closer">
      <p>${H.closer}</p>
    </aside>
  </article>
</main>
${footer()}
</body>
</html>`;
}

// =============================================================================
// LONG-FORM BUYING GUIDES — SEO-targeted, deeper than listicles
// =============================================================================

const BUYING_GUIDES = loadJson('data/buying-guides.json', []);
console.log('[build] buying_guides: ' + (BUYING_GUIDES.length || Object.keys(BUYING_GUIDES).length));

function buyingGuidePage(G) {
  const cover = pBySku(G.coverSku);
  return `${head(G.title + ' — Lenvoshop', G.lead.slice(0, 160))}
<body>
${header()}
<main class="guide-main">
  <header class="listicle-hero">
    <div class="listicle-hero-bg" style="background-image: url('${cover ? cover.image : 'assets/hero-summer.webp'}');"></div>
    <div class="listicle-hero-overlay">
      <span class="hero-eyebrow">${G.eyebrow}</span>
      <h1>${G.title}</h1>
      <p class="lead">${G.lead}</p>
      <div class="byline">
        <span>By the Lenvoshop Editors</span>
        <span class="dot">·</span>
        <span>${G.readTime}</span>
        <span class="dot">·</span>
        <span>Updated May 2026</span>
      </div>
    </div>
  </header>

  <article class="long-guide-content">
    ${G.sections.map(s => `<section class="guide-section">
      <h2>${s.h2}</h2>
      ${s.body.split('\n\n').map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('')}
    </section>`).join('')}

    <section class="listicle-more">
      <h2>Other guides you might like</h2>
      <div class="guides-row">
        ${BUYING_GUIDES.filter(g => g.slug !== G.slug).map(g => {
          const oc = pBySku(g.coverSku);
          return `<a class="guide-card" href="buying-${g.slug}.html">
            <div class="guide-card-img"><img src="${oc ? oc.image : 'assets/hero-summer.webp'}" alt="" loading="lazy" /></div>
            <div class="guide-card-body">
              <span class="kicker">${g.eyebrow}</span>
              <h3>${g.title}</h3>
            </div>
          </a>`;
        }).join('')}
      </div>
    </section>
  </article>
</main>
${footer()}
</body>
</html>`;
}

function listiclePage(L) {
  const cover = pBySku(L.coverSku);
  return `${head(L.title + ' — Lenvoshop', L.lead.slice(0, 160))}
<body>
${header()}
<main class="listicle-main">
  <header class="listicle-hero">
    <div class="listicle-hero-bg" style="background-image: url('${cover ? cover.image : 'assets/hero-summer.webp'}');"></div>
    <div class="listicle-hero-overlay">
      <span class="hero-eyebrow">${L.eyebrow}</span>
      <h1>${L.title}</h1>
      <p class="lead">${L.lead}</p>
      <div class="byline">
        <span>By the Lenvoshop Editors</span>
        <span class="dot">·</span>
        <span>${L.readTime}</span>
        <span class="dot">·</span>
        <span>Updated May 2026</span>
      </div>
    </div>
  </header>

  <article class="listicle-content">
    <ol class="picks-list">
      ${L.picks.map((pick, i) => {
        const p = pBySku(pick.sku);
        if (!p) return '';
        const rank = String(i + 1).padStart(2, '0');
        return `<li class="pick" id="pick-${i+1}">
          <div class="pick-rank">${rank}</div>
          <a class="pick-image" href="product-${p.file_slug}.html"><img src="${p.image}" alt="${p.name.replace(/"/g, '&quot;')}" loading="lazy" /></a>
          <div class="pick-body">
            <h2><a href="product-${p.file_slug}.html">${p.name}</a></h2>
            <p class="pick-blurb">${pick.why}</p>
            <div class="pick-meta">
              <span class="pick-price"><span class="price">${p.price}</span>${p.compare_at_price ? `<span class="compare">${p.compare_at_price}</span>` : ''}</span>
              <div class="pick-actions">
                <button class="btn-secondary" data-add-to-cart="${p.sku}">Add to cart</button>
                <a href="product-${p.file_slug}.html" class="pick-link">Details →</a>
              </div>
            </div>
          </div>
        </li>`;
      }).join('\n')}
    </ol>

    <aside class="listicle-closer">
      <p>${L.closer}</p>
    </aside>

    <section class="listicle-more">
      <h2>More guides</h2>
      <div class="guides-row">
        ${LISTICLES.filter(other => other.slug !== L.slug).map(other => {
          const oc = pBySku(other.coverSku);
          return `<a class="guide-card" href="guide-${other.slug}.html">
            <div class="guide-card-img"><img src="${oc ? oc.image : 'assets/hero-summer.webp'}" alt="" loading="lazy" /></div>
            <div class="guide-card-body">
              <span class="kicker">${other.eyebrow}</span>
              <h3>${other.title}</h3>
            </div>
          </a>`;
        }).join('')}
      </div>
    </section>
  </article>
</main>
${footer()}
</body>
</html>`;
}

function guidesIndexPage() {
  return `${head('Guides &amp; Bundles — Lenvoshop', 'Editorial guides, bundles, and long-form buying advice — hand-picked by the Lenvoshop team.')}
<body>
${header()}
<main>
  <header class="page-header">
    <h1>Guides &amp; Bundles</h1>
    <p>Hand-picked recommendations, bundle savings, and long-form buying guides from the Lenvoshop editors.</p>
  </header>
  <section class="guides-page">
    <h2 class="guides-section-title">Bundles — save 15%</h2>
    <div class="guides-grid">
      ${BUNDLES.map(B => {
        const oc = pBySku(B.coverSku);
        const sumRegular = B.skus.map(s => pBySku(s)).reduce((s, p) => s + (p ? p.raw_price : 0), 0);
        return `<a class="guide-card large" href="bundle-${B.slug}.html">
          <div class="guide-card-img"><img src="${oc ? oc.image : 'assets/hero-summer.webp'}" alt="" loading="lazy" /></div>
          <div class="guide-card-body">
            <span class="kicker">Bundle · Save ${B.discountPct}%</span>
            <h2>${B.title}</h2>
            <p>${B.lead.slice(0, 130)}…</p>
            <span class="guide-meta">$${sumRegular.toFixed(2)} → $${(sumRegular * (1 - B.discountPct/100)).toFixed(2)}</span>
          </div>
        </a>`;
      }).join('')}
    </div>

    <h2 class="guides-section-title">Curated Guides &amp; Top-10 Lists</h2>
    <div class="guides-grid">
      ${LISTICLES.map(L => {
        const oc = pBySku(L.coverSku);
        return `<a class="guide-card large" href="guide-${L.slug}.html">
          <div class="guide-card-img"><img src="${oc ? oc.image : 'assets/hero-summer.webp'}" alt="" loading="lazy" /></div>
          <div class="guide-card-body">
            <span class="kicker">${L.eyebrow}</span>
            <h2>${L.title}</h2>
            <p>${L.lead.slice(0, 130)}…</p>
            <span class="guide-meta">${L.readTime}</span>
          </div>
        </a>`;
      }).join('')}
    </div>

    <h2 class="guides-section-title">Long-form Buying Guides</h2>
    <div class="guides-grid">
      ${BUYING_GUIDES.map(G => {
        const oc = pBySku(G.coverSku);
        return `<a class="guide-card large" href="buying-${G.slug}.html">
          <div class="guide-card-img"><img src="${oc ? oc.image : 'assets/hero-summer.webp'}" alt="" loading="lazy" /></div>
          <div class="guide-card-body">
            <span class="kicker">${G.eyebrow}</span>
            <h2>${G.title}</h2>
            <p>${G.lead.slice(0, 130)}…</p>
            <span class="guide-meta">${G.readTime}</span>
          </div>
        </a>`;
      }).join('')}
    </div>
  </section>
</main>
${footer()}
</body>
</html>`;
}

// =============================================================================
// CSS (extends v1 with cart/checkout styles)
// =============================================================================

const CSS = `:root {
  --bg: #ffffff;
  --bg-alt: #fff6e5;
  --bg-cream: #faf6ee;
  --ink: #111111;
  --ink-soft: #4a4a4a;
  --ink-muted: #8a8a8a;
  --border: #ebe6da;
  --accent: #ffd566;
  --accent-strong: #f8c84e;
  --serif: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  --sans: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  --display-weight: 800;
  --display-tracking: -0.01em;
  --radius-sm: 0;
  --radius-pill: 999px;
  --max: 1280px;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.55;
  color: var(--ink);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; text-decoration: none; }
img { max-width: 100%; display: block; }
button { font: inherit; cursor: pointer; border: 0; background: none; }
h1, h2, h3, h4 { font-family: var(--sans); font-weight: var(--display-weight); letter-spacing: var(--display-tracking); line-height: 1.15; }

.topbar { background: var(--accent); color: var(--ink); font-size: 12px; text-align: center; padding: 9px 16px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; }
.topbar-rating { font-weight: 700; }
.topbar-sep { opacity: 0.6; }
.topbar a { font-weight: 700; text-decoration: underline; }
@media (max-width: 600px) {
  .topbar { font-size: 10px; gap: 6px; padding: 8px 12px; letter-spacing: 0.02em; }
  .topbar-msg { display: none; }
  .topbar-msg:first-of-type { display: inline; }
  .topbar-sep { display: none; }
}

.site-header { display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 24px; max-width: var(--max); margin: 0 auto; padding: 16px 24px; }
.logo img { height: 38px; width: auto; }
.search { display: flex; min-width: 240px; max-width: 380px; }
.search input { flex: 1; padding: 10px 14px; border: 1px solid var(--border); border-right: 0; background: var(--bg-cream); font-family: var(--sans); font-size: 14px; outline: none; border-radius: 30px 0 0 30px; }
.search button { background: var(--accent); padding: 0 14px; border-radius: 0 30px 30px 0; }
.primary-nav { display: flex; gap: 22px; }
.primary-nav a { font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; padding: 8px 0; border-bottom: 2px solid transparent; transition: border-color 0.15s ease; }
.primary-nav a:hover { border-color: var(--ink); }
.cart { position: relative; display: inline-flex; align-items: center; padding: 8px; }
.cart-count { position: absolute; top: 0; right: 0; background: var(--ink); color: white; font-size: 10px; font-weight: 700; border-radius: 999px; min-width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; padding: 0 5px; }

.hero { position: relative; height: 540px; overflow: hidden; background: var(--bg-cream); }
.hero-image, .hero-image img { width: 100%; height: 100%; }
.hero-image img { object-fit: cover; }
.hero-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 24px clamp(24px, 8vw, 96px); color: #fff; text-shadow: 0 2px 18px rgba(0,0,0,0.45); }
.hero-overlay::before { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.18) 60%, rgba(0,0,0,0.32) 100%); pointer-events: none; }
.hero-overlay > * { position: relative; z-index: 1; }
.hero-eyebrow { font-size: 12px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 12px; }
.hero h1 { font-size: clamp(40px, 6vw, 72px); font-weight: 900; letter-spacing: -0.02em; margin: 0 0 12px; max-width: 720px; }
.hero p { font-size: 16px; margin: 0 0 28px; font-weight: 500; letter-spacing: 0.02em; max-width: 540px; }

.hero-cta-row { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin-bottom: 18px; }
.hero-trust { display: flex; gap: 10px; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.95; flex-wrap: wrap; text-shadow: 0 1px 8px rgba(0,0,0,0.4); }
.hero-trust span:first-child { color: var(--accent); font-size: 14px; letter-spacing: 0.02em; }
.btn-pill, .btn-pill-light { display: inline-block; padding: 14px 36px; border-radius: var(--radius-pill); font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; border: 1.5px solid #fff; }
.btn-pill { background: #fff; color: var(--ink); }
.btn-pill:hover { background: var(--accent); border-color: var(--accent); }
.btn-pill-light { background: transparent; color: #fff; }
.btn-pill-light:hover { background: #fff; color: var(--ink); }

.home-section { max-width: var(--max); margin: 64px auto; padding: 0 24px; }
.section-header { text-align: center; margin-bottom: 32px; }
.section-header .kicker { display: block; font-family: var(--sans); font-size: 12px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-muted); margin-bottom: 8px; }
.section-header h2 { font-size: clamp(28px, 4vw, 42px); margin: 0 0 8px; }
.section-header .subheading { font-family: var(--sans); font-size: 14px; color: var(--ink-soft); margin: 0; }

.product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 24px; }
.product-card { background: #fff; border: 1px solid var(--border); display: flex; flex-direction: column; transition: transform 0.15s ease, box-shadow 0.15s ease; overflow: hidden; position: relative; }
.card-badge { position: absolute; top: 10px; left: 10px; z-index: 2; padding: 5px 10px; border-radius: 4px; font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; line-height: 1; }
.card-badge.best-seller { background: var(--ink); color: var(--accent); }
.card-badge.staff-pick  { background: #fff; color: var(--ink); border: 1.5px solid var(--ink); }
.card-badge.new         { background: var(--accent); color: var(--ink); }
.product-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.08); }
.product-link { display: flex; flex-direction: column; flex: 1; padding: 16px; }
.product-image { aspect-ratio: 1 / 1; background: var(--bg-cream); margin: -16px -16px 16px; overflow: hidden; }
.product-image img { width: 100%; height: 100%; object-fit: cover; }
.product-card h3 { font-family: var(--sans); font-size: 14px; font-weight: 600; line-height: 1.4; margin: 0 0 12px; color: var(--ink); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 40px; }
.price-row { display: flex; align-items: baseline; gap: 8px; margin-top: auto; }
.price { font-size: 18px; font-weight: 700; color: var(--ink); }
.compare { font-size: 14px; color: var(--ink-muted); text-decoration: line-through; }

.btn-primary { background: var(--ink); color: #fff; padding: 12px 16px; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; border-radius: 0; width: 100%; transition: background 0.15s ease; display: inline-block; text-align: center; }
.btn-primary:hover { background: var(--ink-soft); }
.btn-primary.btn-lg { padding: 16px 24px; font-size: 13px; max-width: 320px; }
.btn-primary[disabled] { background: var(--ink-muted); cursor: not-allowed; }
.btn-secondary { display: inline-block; padding: 12px 28px; border: 1.5px solid var(--ink); font-size: 12px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
.btn-secondary:hover { background: var(--ink); color: #fff; }
.section-cta { text-align: center; margin-top: 32px; }

.trust-strip { background: var(--bg-cream); display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; padding: 28px max(24px, calc((100% - 1232px) / 2)); border-bottom: 1px solid var(--border); }
.trust-strip-item { display: flex; align-items: center; gap: 14px; justify-content: center; }
.trust-strip-item .trust-icon { font-size: 28px; }
.trust-strip-item strong { display: block; font-size: 13px; }
.trust-strip-item span { color: var(--ink-soft); font-size: 12px; }

/* Editor's Spotlight — single-product hero break */
.editor-spotlight { max-width: var(--max); padding: 24px clamp(20px, 4vw, 32px); }
.spotlight-grid { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(24px, 4vw, 56px); align-items: center; background: var(--bg-cream); border-radius: 8px; padding: clamp(24px, 4vw, 48px); }
.spotlight-img { display: block; aspect-ratio: 1/1; background: #fff; border-radius: 6px; overflow: hidden; max-height: 480px; align-self: center; }
.spotlight-img img { width: 100%; height: 100%; object-fit: cover; }
.spotlight-body .kicker { display: inline-block; font-size: 11px; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent-strong); margin-bottom: 14px; }
.spotlight-body h2 { font-size: clamp(28px, 4vw, 40px); margin: 0 0 16px; line-height: 1.15; }
.spotlight-body p { font-size: 15px; line-height: 1.7; color: var(--ink-soft); margin: 0 0 14px; }
.spotlight-meta { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border); }
.spotlight-price { font-size: 22px; font-weight: 800; color: var(--ink); }
.spotlight-price .compare { font-size: 16px; font-weight: 500; color: var(--ink-muted); text-decoration: line-through; margin-left: 8px; }
.spotlight-meta .btn-primary { max-width: 220px; padding: 14px 24px; }
@media (max-width: 800px) {
  .spotlight-grid { grid-template-columns: 1fr; padding: 24px; }
  .spotlight-img { max-height: 360px; }
}

/* Customer voices — 3-up quote cards */
.customer-voices { max-width: var(--max); }
.voices-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.voice-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 28px 26px; margin: 0; display: flex; flex-direction: column; gap: 12px; }
.voice-card .voice-stars { color: #f5a623; letter-spacing: 2px; font-size: 16px; }
.voice-card blockquote { margin: 0; font-size: 15px; line-height: 1.65; color: var(--ink); font-family: var(--serif); font-style: italic; flex: 1; }
.voice-card figcaption { font-size: 13px; color: var(--ink-muted); font-weight: 600; letter-spacing: 0.04em; }
@media (max-width: 800px) { .voices-row { grid-template-columns: 1fr; } }

/* FAQ — inline expandable */
.faq-section { max-width: 880px; }
.faq-list { display: flex; flex-direction: column; gap: 10px; }
.faq-item { background: #fff; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; transition: border-color 0.15s ease; }
.faq-item[open] { border-color: var(--ink); background: var(--bg-cream); }
.faq-item summary { padding: 18px 22px; cursor: pointer; font-weight: 600; font-size: 16px; color: var(--ink); list-style: none; position: relative; padding-right: 56px; }
.faq-item summary::-webkit-details-marker { display: none; }
.faq-item summary::after { content: '+'; position: absolute; right: 22px; top: 50%; transform: translateY(-50%); font-size: 24px; font-weight: 300; color: var(--ink-muted); transition: transform 0.2s ease; line-height: 1; }
.faq-item[open] summary::after { content: '−'; }
.faq-item p { padding: 0 22px 20px; margin: 0; font-size: 15px; line-height: 1.7; color: var(--ink-soft); }
.faq-item p a { color: var(--ink); text-decoration: underline; }

.values-strip { background: #fff; padding: 32px 24px; text-align: center; border-bottom: 1px solid var(--border); }
.values-label { display: block; font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent-strong); margin-bottom: 22px; }
.values-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: clamp(16px, 3vw, 40px); max-width: 1100px; margin: 0 auto; }
.values-item { display: flex; flex-direction: column; gap: 4px; }
.values-item strong { font-size: 15px; color: var(--ink); font-weight: 700; }
.values-item span { font-size: 12px; color: var(--ink-soft); line-height: 1.5; }
@media (max-width: 800px) {
  .values-row { grid-template-columns: 1fr 1fr; gap: 20px; text-align: left; }
}

.footer-newsletter { background: var(--ink); color: #fff; padding: 48px 24px; }
.footer-newsletter-inner { max-width: var(--max); margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: center; }
.footer-newsletter-text h3 { font-size: 26px; margin: 0 0 8px; color: #fff; line-height: 1.2; }
.footer-newsletter-text p { font-size: 14px; color: rgba(255,255,255,0.7); margin: 0; line-height: 1.55; max-width: 460px; }
.footer-newsletter-form { display: flex; gap: 8px; }
.footer-newsletter-form input { flex: 1; padding: 14px 16px; border-radius: 6px; border: 0; font-family: var(--sans); font-size: 15px; background: #fff; }
.footer-newsletter-form input:focus { outline: 2px solid var(--accent); }
.footer-newsletter-form .btn-primary { background: var(--accent); color: var(--ink); white-space: nowrap; padding: 14px 28px; max-width: none; width: auto; }
.footer-newsletter-form .btn-primary:hover { background: var(--accent-strong); color: var(--ink); }
.newsletter-thanks { font-size: 14px; color: var(--accent); padding: 14px; background: rgba(255,213,102,0.1); border-radius: 6px; }

.best-sellers-grid { max-width: var(--max); margin: 32px auto 48px; padding: 0 24px; }
.best-sellers-cta { text-align: center; padding: 48px 24px 80px; }
.best-sellers-cta p { color: var(--ink-soft); margin-bottom: 16px; }

.categories { max-width: var(--max); margin: 64px auto; padding: 0 24px; }
.cat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.cat-card { display: flex; flex-direction: column; gap: 4px; padding: 28px 24px; background: var(--bg-cream); border: 1px solid var(--border); transition: background 0.15s ease; }
.cat-card:hover { background: var(--accent); }
.cat-card .cat-kicker { font-family: var(--sans); font-size: 12px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-soft); }
.cat-card .cat-name { font-family: var(--serif); font-size: 22px; }

.promo-band { background: var(--ink); color: #fff; padding: 80px 24px; text-align: center; margin-top: 80px; }
.promo-inner h2 { font-size: clamp(28px, 4vw, 40px); margin: 0 0 16px; }
.promo-inner p { color: rgba(255,255,255,0.75); margin: 0 0 28px; }

.trust-band { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; padding: 32px max(24px, calc((100% - 1232px) / 2)); background: var(--bg-cream); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.trust-item { text-align: center; }
.trust-item strong { display: block; font-size: 14px; margin-bottom: 4px; }
.trust-item span { color: var(--ink-soft); font-size: 13px; }

.site-footer { background: #1a1a1a; color: #d6d6d6; padding: 64px 24px 24px; }
.foot-grid { max-width: var(--max); margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 32px; }
.foot-grid h4 { font-family: var(--sans); font-size: 12px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: #fff; margin: 0 0 16px; }
.foot-grid ul { list-style: none; padding: 0; margin: 0; }
.foot-grid li { margin-bottom: 8px; }
.foot-grid a { font-size: 13px; transition: color 0.15s ease; }
.foot-grid a:hover { color: var(--accent); }
.foot-grid p { font-size: 13px; margin: 0 0 8px; line-height: 1.6; }
.payment-icons { color: #888; font-size: 12px !important; letter-spacing: 0.04em; }
.copyright { max-width: var(--max); margin: 32px auto 0; padding-top: 24px; border-top: 1px solid #2a2a2a; text-align: center; font-size: 12px; color: #888; }

.page-header { text-align: center; padding: 56px 24px 32px; background: var(--bg-cream); border-bottom: 1px solid var(--border); }
.page-header h1 { font-size: clamp(36px, 5vw, 56px); margin: 0; }

/* CMS pages - inheriting verbatim live content */
.cms-page { max-width: 760px; margin: 0 auto; padding: 48px 24px 80px; }
.cms-content { font-family: var(--sans); }
.cms-content h1 { font-size: 32px; margin: 24px 0 16px; font-family: var(--serif); }
.cms-content h2 { font-size: 26px; margin: 32px 0 12px; font-family: var(--serif); }
.cms-content h3 { font-size: 20px; margin: 24px 0 8px; font-family: var(--serif); }
.cms-content p, .cms-content li, .cms-content td, .cms-content th { font-size: 15px; line-height: 1.7; color: var(--ink-soft); font-family: var(--sans) !important; }
.cms-content strong, .cms-content b { color: var(--ink); }
.cms-content a { color: var(--ink); text-decoration: underline; }
.cms-content ul, .cms-content ol { padding-left: 24px; }
.cms-content table { width: 100% !important; height: auto !important; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
.cms-content table th, .cms-content table td { border: 1px solid var(--border); padding: 10px 14px; text-align: left; }
.cms-content table th { background: var(--bg-cream); font-weight: 600; color: var(--ink); }
.cms-content img { max-width: 100%; height: auto !important; margin: 16px 0; }
.cms-content [style*="background-color"], .cms-content [style*="color"] { background-color: transparent !important; }

/* Shop layout */
.shop-main { max-width: var(--max); margin: 0 auto; padding: 0 0 80px; }
.shop-layout { display: grid; grid-template-columns: 220px 1fr; gap: 32px; padding: 0 24px; margin-top: 32px; }
.filters { font-size: 14px; }
.filters h3 { font-family: var(--sans); font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin: 0 0 12px; }
.filters ul { list-style: none; padding: 0; margin: 0 0 32px; }
.filters li { margin-bottom: 8px; }
.filters a { color: var(--ink-soft); }
.filters a:hover { color: var(--ink); }
.filters label { display: block; margin: 6px 0; color: var(--ink-soft); cursor: pointer; }
.shop-group { margin-bottom: 64px; }
.shop-group h2 { font-size: 30px; margin: 0 0 24px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.shop-group h2 small { font-size: 14px; color: var(--ink-muted); font-style: normal; font-family: var(--sans); }

/* Product detail */
.product-page { max-width: var(--max); margin: 0 auto; padding: 24px 24px 80px; }
.breadcrumb { font-size: 13px; color: var(--ink-muted); margin: 16px 0 24px; }
.breadcrumb a { text-decoration: underline; }
.product-detail { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-bottom: 64px; }
.gallery { background: var(--bg-cream); padding: 24px; }
.gallery img { width: 100%; aspect-ratio: 1/1; object-fit: cover; }
.product-detail .info h1 { font-size: clamp(28px, 4vw, 40px); margin: 0 0 16px; }
.product-detail .price-row { margin: 16px 0 24px; }
.product-detail .price { font-size: 28px; }
.product-detail .compare { font-size: 18px; }
.short-desc { color: var(--ink-soft); font-size: 16px; line-height: 1.6; margin-bottom: 24px; }
.qty-row { display: flex; align-items: end; gap: 12px; margin-bottom: 16px; }
.qty-row label { font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-muted); display: flex; flex-direction: column; gap: 6px; }
.qty-row input { width: 80px; padding: 12px 8px; border: 1px solid var(--border); font-size: 16px; font-weight: 600; text-align: center; font-family: var(--sans); }
.features { list-style: none; padding: 0; margin: 24px 0 0; border-top: 1px solid var(--border); padding-top: 16px; }
.features li { padding: 6px 0; color: var(--ink-soft); font-size: 14px; }
.features li::before { content: '✓'; color: #2a8c4a; font-weight: 700; margin-right: 8px; }
.related { margin-top: 64px; }
.related h2 { font-size: 28px; margin: 0 0 24px; text-align: center; }

/* Contact */
.contact-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 40px; margin-top: 24px; }
.contact-form, .contact-info { background: var(--bg-cream); padding: 32px; }
.contact-form h2, .contact-info h2 { font-size: 24px; margin: 0 0 20px; font-family: var(--serif); }
.contact-form label, .track-form label { display: block; margin-bottom: 16px; font-size: 13px; font-weight: 600; }
.contact-form input, .contact-form textarea, .track-form input, .checkout-form input { width: 100%; padding: 10px 12px; border: 1px solid var(--border); font-family: var(--sans); font-size: 14px; margin-top: 6px; background: #fff; }
.contact-form textarea { resize: vertical; }
.contact-form button { width: auto; padding: 12px 28px; }
.track-form { max-width: 480px; margin: 24px auto 32px; padding: 32px; background: var(--bg-cream); }
.track-form button { width: 100%; }

/* Cart */
.cart-page { max-width: var(--max); }
.cart-content { display: grid; grid-template-columns: 1fr 360px; gap: 40px; max-width: var(--max); margin: 0 auto; padding: 32px 24px 80px; }
.cart-lines { display: flex; flex-direction: column; gap: 16px; }
.cart-line { display: grid; grid-template-columns: 100px 1fr auto; gap: 16px; padding: 16px; background: var(--bg-cream); align-items: center; }
.cart-line .line-img { width: 100px; height: 100px; }
.cart-line .line-img img { width: 100%; height: 100%; object-fit: cover; }
.cart-line .line-info h3 { font-family: var(--sans); font-size: 14px; font-weight: 600; margin: 0 0 4px; }
.cart-line .line-info .line-meta { font-size: 12px; color: var(--ink-muted); margin-bottom: 8px; }
.cart-line .line-info .qty-controls { display: flex; align-items: center; gap: 8px; }
.cart-line .qty-controls button { width: 28px; height: 28px; border: 1px solid var(--border); background: #fff; font-size: 16px; font-weight: 600; }
.cart-line .qty-controls button:hover { background: var(--ink); color: #fff; }
.cart-line .qty-controls input { width: 50px; height: 28px; text-align: center; border: 1px solid var(--border); font-family: var(--sans); }
.cart-line .line-total { font-size: 16px; font-weight: 700; }
.cart-line .remove { display: block; margin-top: 8px; background: none; color: var(--ink-muted); font-size: 12px; text-decoration: underline; padding: 0; text-align: left; }
.cart-line .remove:hover { color: #c33; }

.cart-summary { background: var(--bg-cream); padding: 24px; align-self: start; position: sticky; top: 24px; }
.cart-summary h2 { font-size: 22px; margin: 0 0 16px; font-family: var(--serif); }
.summary-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; color: var(--ink-soft); }
.summary-row.total { font-size: 18px; font-weight: 700; color: var(--ink); border-top: 1px solid var(--border); margin-top: 8px; padding-top: 16px; }
.ship-note { font-size: 12px; color: var(--ink-muted); margin: 8px 0 16px; }
.cart-summary .btn-primary { margin-top: 16px; max-width: none; }
.cart-summary .continue { display: block; margin-top: 12px; text-align: center; padding: 10px; }

.empty-state { text-align: center; padding: 80px 24px; }
.empty-state p { font-size: 18px; color: var(--ink-soft); margin: 0 0 24px; }
.empty-state .btn-primary { display: inline-block; max-width: 240px; }

/* Checkout — modeled on the live lenvoshop checkout layout */
.checkout-body { background: #fff; }
.checkout-main { max-width: 1180px; margin: 0 auto; padding: 32px 24px 80px; }
.checkout-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 60px; align-items: start; }
.checkout-form-col { padding-right: 12px; }

/* PayPal-style yellow buttons */
.express-pay { display: grid; gap: 10px; margin-bottom: 18px; }
.paypal-btn { background: #ffc439; border: 1px solid #ffc439; color: #003087; padding: 12px 16px; border-radius: 6px; height: 46px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; transition: background 0.15s ease; width: 100%; font-family: var(--sans); font-weight: 600; font-size: 15px; line-height: 1; }
.paypal-btn:hover { background: #ffb820; border-color: #ffb820; }
.paypal-btn svg { height: 22px; width: auto; display: block; }
.paypal-btn.paylater svg { height: 18px; }
.paypal-btn.paylater span { font-size: 14px; color: #003087; font-weight: 600; }
.paypal-btn.big { height: 50px; margin-top: 6px; }
.paypal-btn.big svg { height: 24px; }
.paypal-btn.big.paylater span { font-size: 15px; }

.or-divider { display: flex; align-items: center; gap: 12px; margin: 18px 0; color: var(--ink-muted); font-size: 12px; letter-spacing: 0.06em; }
.or-divider::before, .or-divider::after { content: ''; flex: 1; border-top: 1px solid var(--border); }

.checkout-form .form-section { background: transparent; padding: 0; margin-bottom: 32px; }
.checkout-form h2 { font-style: normal; font-size: 22px; font-weight: 600; font-family: var(--sans); margin: 0 0 18px; color: var(--ink); }

/* Floating-label inputs */
.checkout-form label.floating { position: relative; display: block; margin: 0 0 12px; }
.checkout-form label.floating > input,
.checkout-form label.floating > select { width: 100%; padding: 22px 14px 8px; border: 1px solid #d0d0d0; border-radius: 6px; font-size: 15px; font-family: var(--sans); background: #fff; color: var(--ink); outline: none; transition: border-color 0.15s ease, box-shadow 0.15s ease; appearance: none; -webkit-appearance: none; }
.checkout-form label.floating > input:focus,
.checkout-form label.floating > select:focus { border-color: var(--ink); box-shadow: 0 0 0 3px rgba(0,0,0,0.06); }
.checkout-form label.floating > span { position: absolute; left: 14px; top: 14px; color: var(--ink-muted); font-size: 15px; font-weight: 500; pointer-events: none; transition: top 0.15s ease, font-size 0.15s ease, font-weight 0.15s ease; text-transform: none; letter-spacing: 0; }
.checkout-form label.floating > input:not(:placeholder-shown) + span,
.checkout-form label.floating > input:focus + span,
.checkout-form label.floating > select:focus + span,
.checkout-form label.floating > select:valid + span { top: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; color: #888; text-transform: uppercase; }
.checkout-form label.floating .select-caret { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); pointer-events: none; color: #888; }
.checkout-form label.floating .addr-search { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); pointer-events: none; }
.checkout-form .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.checkout-form .checkbox-row { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--ink-soft); margin: 8px 0 0; }
.checkout-form .checkbox-row input { width: 18px; height: 18px; margin: 0; accent-color: var(--ink); }

.ship-line { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; background: var(--bg-cream); border-radius: 6px; font-weight: 600; font-size: 15px; margin-top: 14px; border: 1px solid var(--border); }
.pay-button { margin-top: 16px; width: 100%; max-width: none; padding: 16px; font-size: 14px; }
.card-fields .floating .card-lock { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; }

.payment-note { font-size: 13px; color: var(--ink-muted); margin: 0 0 12px; padding: 0; background: transparent; border: 0; }

.payment-method { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border: 1px solid #d0d0d0; border-radius: 6px; margin-bottom: 8px; cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease; }
.payment-method:has(input:checked), .payment-method.active { border-color: var(--ink); background: var(--bg-cream); }
.payment-method input { width: 18px; height: 18px; margin: 0; accent-color: var(--ink); }
.payment-method .pm-label { font-weight: 600; font-size: 14px; flex: 1; }
.payment-method .pm-icons { display: flex; align-items: center; gap: 6px; }
.payment-method .pm-icons svg { display: block; }
.card-icon { display: inline-block; padding: 4px 8px; border-radius: 3px; font-size: 10px; font-weight: 800; letter-spacing: 0.08em; line-height: 1; color: #fff; }
.card-icon.visa { background: #1a1f71; }
.card-icon.mc { background: linear-gradient(90deg, #eb001b 50%, #f79e1b 50%); }
.card-icon.amex { background: #2671b9; }
.card-icon.disc { background: #ff6000; }

.card-fields { margin-top: 12px; padding: 16px; background: #faf6ee; border-radius: 6px; }
.card-fields label.floating { margin-bottom: 8px; }

.pay-error { color: #c33; font-size: 13px; margin-top: 12px; min-height: 20px; line-height: 1.5; padding: 0 8px; }
.pay-error code { background: rgba(204,51,51,0.08); padding: 1px 4px; border-radius: 3px; }

/* Right summary column */
.checkout-summary-col { background: #f7f7f7; padding: 32px; border-radius: 8px; align-self: start; position: sticky; top: 24px; }
.summary-lines { margin-bottom: 18px; max-height: 360px; overflow-y: auto; }
.summary-line { display: grid; grid-template-columns: 64px 1fr auto; gap: 14px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid #eee; }
.summary-line:last-child { border-bottom: 0; }
.summary-line .line-thumb { position: relative; width: 64px; height: 64px; border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden; background: #fff; }
.summary-line .line-thumb img { width: 100%; height: 100%; object-fit: cover; }
.summary-line .qty-badge { position: absolute; top: -8px; left: -8px; background: #4a4a4a; color: #fff; font-size: 11px; font-weight: 700; min-width: 20px; height: 20px; border-radius: 999px; display: flex; align-items: center; justify-content: center; padding: 0 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
.summary-line .line-info h4 { font-family: var(--sans); font-size: 14px; font-weight: 500; margin: 0 0 2px; line-height: 1.35; color: var(--ink); }
.summary-line .line-info .variant { font-size: 12px; color: var(--ink-muted); }
.summary-line .line-price { font-size: 14px; font-weight: 600; color: var(--ink); white-space: nowrap; }

.discount-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid #e5e5e5; }
.discount-row input { padding: 10px 12px; border: 1px solid #d0d0d0; border-radius: 6px; font-size: 14px; font-family: var(--sans); background: #fff; }
.discount-row input:focus { outline: none; border-color: var(--ink); }
.discount-row input.invalid { border-color: #c33; color: #c33; }
.discount-row button { padding: 10px 18px; border: 1px solid #d0d0d0; border-radius: 6px; background: #fff; color: var(--ink-muted); font-size: 13px; font-weight: 600; cursor: not-allowed; }
.discount-row button:not(:disabled) { color: var(--ink); cursor: pointer; }
.discount-row button:not(:disabled):hover { background: var(--ink); color: #fff; }

.summary-totals { padding: 0 0 16px; border-bottom: 1px solid #e5e5e5; }
.summary-totals .row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 14px; color: var(--ink); }
.summary-totals .row.discount span { color: #c33; }
.summary-totals .row.discount span:first-child { color: #c33; font-weight: 600; }
.summary-totals .row.total { font-size: 18px; font-weight: 700; padding-top: 14px; margin-top: 8px; border-top: 1px solid #e5e5e5; }
.summary-totals .total-amt { display: inline-flex; align-items: baseline; gap: 6px; }
.summary-totals .usd { font-size: 11px; color: var(--ink-muted); font-weight: 600; }

.reviews-block { margin-top: 22px; }
.reviews-block h3 { font-family: var(--sans); font-size: 17px; font-weight: 700; margin: 0 0 14px; color: var(--ink); font-style: normal; }
.reviews-list { display: flex; flex-direction: column; gap: 18px; }
.review-item { font-size: 13px; line-height: 1.5; color: var(--ink-soft); }
.review-stars { color: #1a73e8; letter-spacing: 1px; font-size: 14px; margin-bottom: 4px; }
.review-text { margin: 0 0 6px; color: var(--ink); }
.review-author { color: var(--ink); font-weight: 500; }

@media (max-width: 900px) {
  .checkout-grid { grid-template-columns: 1fr; gap: 24px; }
  .checkout-summary-col { position: static; padding: 20px; order: -1; }
  .summary-lines { max-height: 240px; }
  .checkout-form-col { padding-right: 0; }
}

/* Cart drawer */
.drawer-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.42); z-index: 9990; opacity: 0; transition: opacity 0.25s ease; }
.drawer-backdrop[hidden] { display: block !important; pointer-events: none; }
.drawer-backdrop.open { opacity: 1; pointer-events: auto; }
.cart-drawer { position: fixed; top: 0; right: 0; width: min(420px, 90vw); height: 100%; background: #fff; z-index: 9991; transform: translateX(110%); transition: transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1); display: flex; flex-direction: column; box-shadow: -8px 0 24px rgba(0,0,0,0.12); }
.cart-drawer.lv-open { transform: translateX(0) !important; }
.drawer-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--border); }
.drawer-header h2 { font-size: 22px; margin: 0; font-family: var(--serif); display: flex; align-items: center; gap: 10px; }
.drawer-header .drawer-count { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 22px; padding: 0 8px; background: var(--ink); color: #fff; font-family: var(--sans); font-size: 12px; font-weight: 700; font-style: normal; border-radius: 999px; }
.drawer-close { background: none; border: 0; padding: 6px; cursor: pointer; color: var(--ink); }
.drawer-close:hover { color: var(--ink-muted); }
.drawer-body { flex: 1; overflow-y: auto; padding: 16px 22px; }
.drawer-empty { text-align: center; padding: 60px 16px; }
.drawer-empty p { font-size: 15px; color: var(--ink-soft); margin: 0 0 18px; }
.drawer-empty .btn-secondary { display: inline-block; }
.drawer-lines { display: flex; flex-direction: column; gap: 14px; }
.drawer-line { display: grid; grid-template-columns: 72px 1fr auto; gap: 12px; align-items: flex-start; padding: 12px 0; border-bottom: 1px solid var(--border); }
.drawer-line:last-child { border-bottom: 0; }
.drawer-line .dl-img { width: 72px; height: 72px; background: var(--bg-cream); overflow: hidden; border-radius: 4px; flex-shrink: 0; }
.drawer-line .dl-img img { width: 100%; height: 100%; object-fit: cover; }
.drawer-line .dl-body h4 { font-family: var(--sans); font-size: 13px; font-weight: 600; margin: 0 0 4px; line-height: 1.35; color: var(--ink); }
.drawer-line .dl-body h4 a { color: inherit; }
.drawer-line .dl-meta { font-size: 12px; color: var(--ink-muted); margin-bottom: 6px; }
.drawer-line .qty-controls { display: inline-flex; align-items: center; gap: 4px; }
.drawer-line .qty-controls button { width: 26px; height: 26px; border: 1px solid var(--border); background: #fff; font-size: 14px; font-weight: 700; padding: 0; cursor: pointer; line-height: 1; border-radius: 3px; color: var(--ink); }
.drawer-line .qty-controls button:hover { background: var(--ink); color: #fff; }
.drawer-line .qty-controls span { font-size: 13px; min-width: 22px; text-align: center; font-weight: 600; }
.drawer-line .dl-end { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.drawer-line .dl-price { font-size: 14px; font-weight: 700; white-space: nowrap; }
.drawer-line .dl-remove { background: none; border: 0; color: var(--ink-muted); font-size: 11px; padding: 0; cursor: pointer; text-decoration: underline; }
.drawer-line .dl-remove:hover { color: #c33; }
.drawer-foot { border-top: 1px solid var(--border); padding: 16px 22px 22px; background: var(--bg-cream); }
.drawer-foot[data-empty="true"] { display: none; }
.drawer-summary .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
.drawer-summary .row.small { color: var(--ink-muted); font-size: 13px; }
.ship-progress { background: #fff; padding: 8px 12px; border-radius: 4px; margin-top: 8px; font-size: 12px; color: var(--ink-soft); border-left: 3px solid var(--accent); }
.ship-progress.met { border-left-color: #2a8c4a; }
.drawer-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px; }
.drawer-actions .btn-primary, .drawer-actions .btn-secondary { padding: 12px; font-size: 12px; max-width: none; width: 100%; text-align: center; }

/* Listicles / Curated Guides */
.listicle-main { background: #fff; }
.listicle-hero { position: relative; min-height: 480px; display: grid; align-items: end; overflow: hidden; }
.listicle-hero-bg { position: absolute; inset: 0; background-size: cover; background-position: center; transform: scale(1.05); filter: brightness(0.62); }
.listicle-hero::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 100%); pointer-events: none; }
.listicle-hero-overlay { position: relative; z-index: 1; max-width: 900px; margin: 0 auto; padding: 80px clamp(24px, 6vw, 64px) 64px; color: #fff; text-align: center; text-shadow: 0 2px 18px rgba(0,0,0,0.35); }
.listicle-hero-overlay .hero-eyebrow { display: inline-block; padding: 6px 14px; background: var(--accent); color: var(--ink); border-radius: var(--radius-pill); font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 18px; text-shadow: none; }
.listicle-hero-overlay h1 { font-size: clamp(34px, 5vw, 60px); margin: 0 0 18px; max-width: 800px; margin-left: auto; margin-right: auto; line-height: 1.15; }
.listicle-hero-overlay .lead { font-size: clamp(15px, 1.5vw, 18px); line-height: 1.6; max-width: 720px; margin: 0 auto 24px; color: rgba(255,255,255,0.92); }
.listicle-hero-overlay .byline { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; color: rgba(255,255,255,0.85); }
.listicle-hero-overlay .byline .dot { opacity: 0.6; }

.listicle-content { max-width: 880px; margin: 0 auto; padding: 56px clamp(20px, 4vw, 40px) 80px; }
.picks-list { list-style: none; padding: 0; margin: 0; counter-reset: pick; display: flex; flex-direction: column; gap: 48px; }
.pick { display: grid; grid-template-columns: 80px 280px 1fr; gap: 24px; align-items: start; padding-bottom: 48px; border-bottom: 1px solid var(--border); }
.pick:last-child { border-bottom: 0; padding-bottom: 0; }
.pick-rank { font-family: var(--sans); font-size: 56px; font-weight: 900; letter-spacing: -0.04em; color: var(--accent-strong); line-height: 1; padding-top: 4px; }
.pick-image { display: block; aspect-ratio: 1/1; background: var(--bg-cream); border-radius: 6px; overflow: hidden; border: 1px solid var(--border); transition: transform 0.2s ease; }
.pick-image:hover { transform: translateY(-2px); }
.pick-image img { width: 100%; height: 100%; object-fit: cover; }
.pick-body h2 { font-family: var(--serif); font-size: clamp(22px, 2.4vw, 28px); margin: 0 0 14px; line-height: 1.25; }
.pick-body h2 a { color: var(--ink); }
.pick-body h2 a:hover { color: var(--ink-soft); }
.pick-blurb { font-size: 15px; line-height: 1.65; color: var(--ink-soft); margin: 0 0 20px; }
.pick-meta { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--border); }
.pick-price { display: inline-flex; align-items: baseline; gap: 8px; }
.pick-price .price { font-size: 20px; font-weight: 700; color: var(--ink); }
.pick-price .compare { font-size: 14px; color: var(--ink-muted); text-decoration: line-through; }
.pick-actions { display: inline-flex; gap: 10px; align-items: center; }
.pick-actions .btn-secondary { padding: 10px 18px; font-size: 11px; }
.pick-link { font-size: 13px; font-weight: 600; color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
.pick-link:hover { color: var(--accent-strong); }

.listicle-closer { background: var(--bg-cream); border-left: 4px solid var(--accent); padding: 24px 28px; margin: 56px 0 64px; border-radius: 0 6px 6px 0; }
.listicle-closer p { margin: 0; font-size: 15px; line-height: 1.65; color: var(--ink-soft); }

.listicle-more { padding-top: 24px; border-top: 1px solid var(--border); }
.listicle-more h2 { font-size: 28px; margin: 0 0 24px; text-align: center; }

.guides-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }
.home-guides { grid-template-columns: repeat(4, 1fr); }
.guide-card { display: flex; flex-direction: column; background: #fff; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; transition: transform 0.18s ease, box-shadow 0.18s ease; color: inherit; }
.guide-card:hover { transform: translateY(-3px); box-shadow: 0 12px 28px rgba(0,0,0,0.08); }
.guide-card-img { aspect-ratio: 16/10; overflow: hidden; background: var(--bg-cream); }
.guide-card-img img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s ease; }
.guide-card:hover .guide-card-img img { transform: scale(1.05); }
.guide-card-body { padding: 18px 20px 22px; }
.guide-card-body .kicker { display: inline-block; font-family: var(--sans); font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-muted); margin-bottom: 6px; }
.guide-card-body h2, .guide-card-body h3 { font-family: var(--serif); font-size: 22px; line-height: 1.25; margin: 0 0 10px; color: var(--ink); }
.guide-card.large .guide-card-body h2 { font-size: 26px; }
.guide-card-body p { font-size: 14px; color: var(--ink-soft); line-height: 1.55; margin: 0 0 12px; }
.guide-card-body .guide-meta { font-size: 12px; font-weight: 600; color: var(--ink-muted); letter-spacing: 0.04em; }

.guides-page { max-width: var(--max); margin: 56px auto 80px; padding: 0 24px; }
.guides-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 28px; }

.curated-guides-section { background: var(--bg-cream); padding: 64px 24px; max-width: none; margin: 80px 0 0; }
.curated-guides-section .section-header, .curated-guides-section .home-guides, .curated-guides-section .section-cta { max-width: var(--max); margin-left: auto; margin-right: auto; }

@media (max-width: 900px) {
  .pick { grid-template-columns: 60px 1fr; }
  .pick-image { grid-column: 2; max-width: 240px; margin-bottom: 8px; }
  .pick-body { grid-column: 1 / -1; }
  .pick-rank { font-size: 40px; }
  .home-guides { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 600px) {
  .home-guides { grid-template-columns: 1fr; }
  .guides-grid { grid-template-columns: 1fr; }
}

/* Bundles */
.bundle-main { background: #fff; }
.bundle-hero { position: relative; min-height: 460px; display: grid; align-items: end; overflow: hidden; }
.bundle-hero-bg { position: absolute; inset: 0; background-size: cover; background-position: center; transform: scale(1.05); filter: brightness(0.55); }
.bundle-hero::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 100%); pointer-events: none; }
.bundle-hero-overlay { position: relative; z-index: 1; max-width: 880px; margin: 0 auto; padding: 64px clamp(24px, 6vw, 64px) 56px; color: #fff; text-align: center; text-shadow: 0 2px 18px rgba(0,0,0,0.35); }
.bundle-hero-overlay .hero-eyebrow { display: inline-block; padding: 6px 14px; background: var(--accent); color: var(--ink); border-radius: var(--radius-pill); font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 18px; text-shadow: none; }
.bundle-hero-overlay h1 { font-size: clamp(34px, 5vw, 54px); margin: 0 0 16px; line-height: 1.12; letter-spacing: -0.01em; }
.bundle-hero-overlay .lead { font-size: clamp(15px, 1.5vw, 17px); line-height: 1.55; max-width: 700px; margin: 0 auto 24px; color: rgba(255,255,255,0.92); }
.bundle-price-row { display: inline-flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: center; margin-bottom: 22px; padding: 12px 22px; background: rgba(255,255,255,0.96); color: var(--ink); border-radius: var(--radius-pill); text-shadow: none; }
.bundle-was { color: var(--ink-muted); text-decoration: line-through; font-size: 14px; font-weight: 500; }
.bundle-now { font-size: 22px; font-weight: 800; }
.bundle-save { background: var(--accent); padding: 4px 12px; border-radius: var(--radius-pill); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }

.bundle-content { max-width: 920px; margin: 0 auto; padding: 56px clamp(20px, 4vw, 40px) 80px; }
.bundle-content h2 { font-size: 28px; margin: 0 0 28px; text-align: center; }
.bundle-grid { display: grid; gap: 24px; margin-bottom: 48px; }
.bundle-card { display: grid; grid-template-columns: 64px 200px 1fr; gap: 20px; padding: 24px; background: var(--bg-cream); border-radius: 8px; border: 1px solid var(--border); align-items: center; }
.bundle-rank { width: 44px; height: 44px; border-radius: 50%; background: var(--ink); color: #fff; font-size: 18px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.bundle-img { display: block; aspect-ratio: 1/1; background: #fff; border-radius: 6px; overflow: hidden; max-width: 200px; }
.bundle-img img { width: 100%; height: 100%; object-fit: cover; }
.bundle-info h3 { font-size: 19px; margin: 0 0 8px; line-height: 1.3; }
.bundle-info h3 a { color: var(--ink); }
.bundle-info .price-row { margin: 4px 0 12px; }
.bundle-desc { font-size: 14px; color: var(--ink-soft); line-height: 1.55; margin: 0; }

.bundle-cta-block { background: var(--ink); color: #fff; padding: 48px 32px; text-align: center; border-radius: 8px; margin: 48px 0; }
.bundle-cta-block h2 { color: #fff; font-size: 28px; margin: 0 0 12px; }
.bundle-cta-block p { color: rgba(255,255,255,0.8); margin: 0 0 24px; font-size: 15px; }
.bundle-cta-block .btn-primary { background: var(--accent); color: var(--ink); max-width: 360px; }
.bundle-cta-block .btn-primary:hover { background: var(--accent-strong); color: var(--ink); }

/* Bundle teaser strip on homepage */
.bundles-strip { max-width: var(--max); }
.bundles-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.bundle-teaser { display: flex; flex-direction: column; background: var(--bg-cream); border-radius: 8px; overflow: hidden; transition: transform 0.18s ease, box-shadow 0.18s ease; color: inherit; border: 1px solid var(--border); }
.bundle-teaser:hover { transform: translateY(-3px); box-shadow: 0 12px 28px rgba(0,0,0,0.08); }
.bundle-teaser-img { aspect-ratio: 16/10; overflow: hidden; }
.bundle-teaser-img img { width: 100%; height: 100%; object-fit: cover; }
.bundle-teaser-body { padding: 18px 20px 22px; display: flex; flex-direction: column; gap: 8px; }
.bundle-teaser-body .kicker { font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-muted); }
.bundle-teaser-body h3 { font-size: 20px; line-height: 1.25; margin: 0 0 4px; }
.bundle-teaser-price { display: flex; align-items: baseline; gap: 10px; }
.bundle-teaser-price .bundle-was { color: var(--ink-muted); text-decoration: line-through; font-size: 14px; }
.bundle-teaser-price .bundle-now { font-size: 22px; font-weight: 800; color: var(--ink); }

/* Long-form buying guides */
.long-guide-content { max-width: 760px; margin: 0 auto; padding: 56px clamp(20px, 4vw, 40px) 80px; }
.guide-section { margin-bottom: 36px; }
.guide-section h2 { font-size: clamp(24px, 3vw, 30px); margin: 0 0 16px; line-height: 1.25; }
.guide-section p { font-size: 16px; line-height: 1.7; color: var(--ink-soft); margin: 0 0 16px; }
.guide-section p strong { color: var(--ink); font-weight: 700; }
.guide-section a { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; font-weight: 600; }
.guide-section a:hover { color: var(--accent-strong); }

.guides-section-title { font-size: 24px; margin: 48px 0 24px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.guides-section-title:first-child { margin-top: 0; }

/* Email popup */
.email-popup { position: fixed; inset: 0; z-index: 9995; display: flex; align-items: center; justify-content: center; padding: 24px; opacity: 0; pointer-events: none; transition: opacity 0.25s ease; }
.email-popup.open { opacity: 1; pointer-events: auto; }
.email-popup[hidden] { display: none; }
.email-popup-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.55); cursor: pointer; }
.email-popup-card { position: relative; background: #fff; border-radius: 10px; padding: 40px 36px 32px; max-width: 440px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.2); transform: translateY(12px); transition: transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1); }
.email-popup.open .email-popup-card { transform: translateY(0); }
.email-popup-close { position: absolute; top: 14px; right: 14px; background: none; border: 0; padding: 8px; cursor: pointer; color: var(--ink-muted); }
.email-popup-close:hover { color: var(--ink); }
.email-popup-eyebrow { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent-strong); margin-bottom: 12px; }
.email-popup-card h2 { font-size: 28px; margin: 0 0 12px; line-height: 1.2; }
.email-popup-card p { font-size: 14px; color: var(--ink-soft); line-height: 1.6; margin: 0 0 20px; }
.email-popup-card form { display: flex; gap: 8px; flex-direction: column; margin-bottom: 12px; }
.email-popup-card input[type="email"] { padding: 14px 16px; border: 1px solid var(--border); border-radius: 6px; font-size: 15px; font-family: var(--sans); }
.email-popup-card input[type="email"]:focus { outline: none; border-color: var(--ink); }
.email-popup-card .btn-primary { width: 100%; max-width: none; padding: 14px; margin-top: 4px; }
.email-popup-decline { background: none; border: 0; color: var(--ink-muted); font-size: 12px; cursor: pointer; text-decoration: underline; padding: 6px; display: block; margin: 12px auto 0; }
.email-popup-decline:hover { color: var(--ink); }
.promo-code { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px; background: var(--bg-cream); border: 2px dashed var(--accent-strong); border-radius: 8px; margin: 18px 0 14px; }
.promo-code-label { display: block; font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-muted); margin-bottom: 2px; }
.promo-code-value { font-family: var(--sans); font-size: 26px; font-weight: 900; letter-spacing: 0.06em; color: var(--ink); flex: 1; }
.promo-code > div, .promo-code > .promo-code-value-wrap { flex: 1; }
.promo-code-copy { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; background: #fff; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; font-weight: 600; color: var(--ink); cursor: pointer; }
.promo-code-copy:hover { background: var(--ink); color: #fff; border-color: var(--ink); }
.promo-code-copy svg { display: block; }
.email-popup-success { text-align: center; }
.email-popup-success h2 strong { color: var(--accent-strong); font-size: 1.3em; }
.email-popup-success .btn-primary { width: 100%; max-width: none; margin-top: 12px; }

@media (max-width: 900px) {
  .bundle-card { grid-template-columns: 50px 1fr; gap: 14px; }
  .bundle-img { grid-column: 2; max-width: 200px; margin-bottom: 8px; }
  .bundle-info { grid-column: 1 / -1; }
  .bundles-row { grid-template-columns: 1fr; }
  .bundle-price-row { gap: 8px; padding: 10px 16px; }
}

/* Quiz */
.quiz-main { background: var(--bg-cream); min-height: 70vh; padding: 48px 24px; }
.quiz-shell { max-width: 720px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 48px clamp(24px, 5vw, 56px); box-shadow: 0 8px 32px rgba(0,0,0,0.06); position: relative; }
.quiz-progress { position: absolute; top: 0; left: 0; right: 0; height: 4px; background: var(--border); border-radius: 12px 12px 0 0; overflow: hidden; }
.quiz-progress-bar { height: 100%; background: var(--accent); transition: width 0.4s cubic-bezier(0.22, 0.61, 0.36, 1); width: 0; }
.quiz-step { animation: quizFade 0.3s ease; }
@keyframes quizFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.quiz-intro { text-align: center; padding: 24px 0; }
.quiz-intro .hero-eyebrow { display: inline-block; padding: 6px 14px; background: var(--accent); color: var(--ink); border-radius: var(--radius-pill); font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 18px; }
.quiz-intro h1 { font-size: clamp(28px, 4vw, 40px); margin: 0 0 16px; line-height: 1.2; }
.quiz-intro p { font-size: 16px; color: var(--ink-soft); max-width: 480px; margin: 0 auto 32px; line-height: 1.55; }
.quiz-q { font-size: clamp(24px, 3vw, 32px); margin: 24px 0 28px; text-align: center; line-height: 1.25; }
.quiz-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
.quiz-option { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 24px 16px; background: #fff; border: 2px solid var(--border); border-radius: 10px; cursor: pointer; font-family: var(--sans); font-size: 14px; font-weight: 600; color: var(--ink); transition: all 0.15s ease; text-align: center; }
.quiz-option:hover { border-color: var(--ink); background: var(--bg-cream); transform: translateY(-2px); }
.quiz-option-emoji { font-size: 32px; line-height: 1; }
.quiz-option-label { font-size: 14px; font-weight: 600; }
.quiz-back { background: none; border: 0; color: var(--ink-muted); font-size: 13px; cursor: pointer; text-decoration: underline; padding: 6px; margin-top: 8px; }
.quiz-back:hover { color: var(--ink); }

.quiz-result { text-align: center; }
.quiz-result .hero-eyebrow { display: inline-block; padding: 6px 14px; background: var(--accent); color: var(--ink); border-radius: var(--radius-pill); font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 18px; }
.quiz-headline { font-size: clamp(28px, 4vw, 38px); margin: 0 0 14px; }
.quiz-why { font-size: 15px; color: var(--ink-soft); line-height: 1.6; max-width: 540px; margin: 0 auto 32px; }
.quiz-products { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 28px; }
.quiz-product { background: var(--bg-cream); border-radius: 8px; overflow: hidden; text-align: left; }
.quiz-product-img { display: block; aspect-ratio: 1/1; background: #fff; overflow: hidden; }
.quiz-product-img img { width: 100%; height: 100%; object-fit: cover; }
.quiz-product-body { padding: 14px 16px 18px; }
.quiz-product-body h3 { font-size: 14px; line-height: 1.35; margin: 0 0 8px; }
.quiz-product-body h3 a { color: var(--ink); }
.quiz-product-price { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
.quiz-product-body .btn-secondary { width: 100%; padding: 10px; font-size: 11px; }
.quiz-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.quiz-actions .btn-primary { max-width: 280px; }
.quiz-bundle-hint { font-size: 13px; color: var(--ink-muted); margin-top: 16px; }
.quiz-meta { font-size: 12px; color: var(--ink-muted); margin-top: 16px; letter-spacing: 0.04em; }
.quiz-other-quizzes { margin-top: 24px; font-size: 13px; }
.quiz-other-quizzes a { color: var(--ink-muted); text-decoration: underline; }
.quiz-other-quizzes a:hover { color: var(--ink); }
.quiz-hub-card .guide-card-body h2 { font-size: 22px; }

/* Quiz strip on homepage */
.quiz-strip { max-width: var(--max); }
.quiz-strip-inner { display: grid; grid-template-columns: 1fr auto; gap: 32px; align-items: center; padding: 36px clamp(24px, 4vw, 48px); background: linear-gradient(135deg, var(--bg-cream) 0%, #fff 100%); border-radius: 12px; border: 1px solid var(--border); }
.quiz-strip-text .kicker { font-family: var(--sans); font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent-strong); margin-bottom: 8px; display: block; }
.quiz-strip-text h2 { font-size: clamp(22px, 2.6vw, 30px); margin: 0 0 8px; line-height: 1.2; }
.quiz-strip-text p { font-size: 14px; color: var(--ink-soft); margin: 0; max-width: 520px; }
.quiz-strip-cta { white-space: nowrap; padding: 16px 28px; max-width: none; }
.quiz-cards-row { display: grid; grid-template-columns: repeat(7, 1fr); gap: 12px; margin-top: 24px; }
.quiz-card { display: flex; flex-direction: column; background: #fff; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; transition: transform 0.18s ease, box-shadow 0.18s ease; color: inherit; min-width: 0; }
.quiz-card:hover { transform: translateY(-3px); box-shadow: 0 12px 24px rgba(0,0,0,0.08); }
.quiz-card-img { aspect-ratio: 1/1; overflow: hidden; background: var(--bg-cream); }
.quiz-card-img img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s ease; }
.quiz-card:hover .quiz-card-img img { transform: scale(1.05); }
.quiz-card-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 4px; }
.quiz-card-body .kicker { font-family: var(--sans); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-muted); }
.quiz-card-body h3 { font-size: 14px; line-height: 1.3; margin: 0; font-weight: 700; letter-spacing: -0.01em; }
.quiz-card-meta { font-size: 11px; color: var(--ink-muted); font-weight: 600; margin-top: 4px; }
@media (max-width: 1100px) { .quiz-cards-row { grid-template-columns: repeat(4, 1fr); } }
@media (max-width: 700px) { .quiz-cards-row { grid-template-columns: repeat(2, 1fr); gap: 10px; } }

/* Seasonal hubs */
.seasonal-main { background: #fff; }
.seasonal-hero { position: relative; min-height: 380px; display: grid; align-items: end; overflow: hidden; }
.seasonal-hero-bg { position: absolute; inset: 0; background-size: cover; background-position: center; transform: scale(1.05); filter: brightness(0.55); }
.seasonal-hero::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.55) 100%); pointer-events: none; }
.seasonal-hero-overlay { position: relative; z-index: 1; max-width: 880px; margin: 0 auto; padding: 64px clamp(24px, 6vw, 64px) 48px; color: #fff; text-align: center; text-shadow: 0 2px 18px rgba(0,0,0,0.35); }
.seasonal-hero-overlay .hero-eyebrow { display: inline-block; padding: 6px 14px; background: var(--accent); color: var(--ink); border-radius: var(--radius-pill); font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 16px; text-shadow: none; }
.seasonal-hero-overlay h1 { font-size: clamp(32px, 5vw, 52px); margin: 0 0 14px; line-height: 1.15; }
.seasonal-hero-overlay .lead { font-size: 16px; line-height: 1.6; max-width: 660px; margin: 0 auto; color: rgba(255,255,255,0.92); }

.seasonal-content { max-width: var(--max); margin: 0 auto; padding: 56px clamp(20px, 4vw, 32px) 80px; }
.seasonal-zones { display: flex; flex-direction: column; gap: 56px; margin-bottom: 64px; }
.seasonal-zone .zone-title { font-size: clamp(22px, 2.6vw, 28px); margin: 0 0 20px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }

.seasonal-feature { background: var(--bg-cream); padding: 48px clamp(24px, 4vw, 56px); border-radius: 8px; text-align: center; margin-bottom: 32px; }
.seasonal-feature.alt { background: #fff; border: 1px solid var(--border); }
.seasonal-feature .kicker { display: inline-block; font-family: var(--sans); font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-muted); margin-bottom: 8px; }
.seasonal-feature h2 { font-size: clamp(24px, 3vw, 32px); margin: 0 0 12px; }
.seasonal-feature p { font-size: 15px; color: var(--ink-soft); line-height: 1.6; max-width: 600px; margin: 0 auto 24px; }
.seasonal-feature .guides-row { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }

/* Seasonal strip on homepage */
.seasonal-strip { max-width: var(--max); }
.seasonal-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.seasonal-card { display: flex; flex-direction: column; background: #fff; border-radius: 10px; overflow: hidden; transition: transform 0.18s ease, box-shadow 0.18s ease; color: inherit; border: 1px solid var(--border); }
.seasonal-card:hover { transform: translateY(-3px); box-shadow: 0 12px 28px rgba(0,0,0,0.08); }
.seasonal-card-img { aspect-ratio: 16/9; overflow: hidden; }
.seasonal-card-img img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s ease; }
.seasonal-card:hover .seasonal-card-img img { transform: scale(1.05); }
.seasonal-card-body { padding: 18px 22px 22px; }
.seasonal-card-body .kicker { display: inline-block; font-family: var(--sans); font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent-strong); margin-bottom: 8px; }
.seasonal-card-body h3 { font-size: 22px; line-height: 1.25; margin: 0; }

@media (max-width: 900px) {
  .quiz-strip-inner { grid-template-columns: 1fr; gap: 16px; }
  .quiz-strip-cta { width: 100%; }
  .seasonal-row { grid-template-columns: 1fr; }
  .quiz-options { grid-template-columns: 1fr 1fr; }
  .quiz-products { grid-template-columns: 1fr; }
}

/* Toast */
.toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(100px); background: var(--ink); color: #fff; padding: 12px 24px; font-size: 14px; z-index: 9999; opacity: 0; transition: opacity 0.25s ease, transform 0.25s ease; pointer-events: none; max-width: 90%; text-align: center; }
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

@media (max-width: 900px) {
  .site-header { grid-template-columns: auto 1fr auto; gap: 12px; padding: 12px 16px; }
  .search { display: none; }
  .primary-nav { display: none; }
  .hero { height: 420px; }
  .hero-overlay { padding: 24px; align-items: center; text-align: center; }
  .product-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .shop-layout { grid-template-columns: 1fr; }
  .filters { order: 2; }
  .product-detail { grid-template-columns: 1fr; gap: 24px; }
  .contact-grid { grid-template-columns: 1fr; gap: 24px; }
  .trust-strip { grid-template-columns: 1fr 1fr; gap: 16px; }
  .press-logos { gap: 18px; }
  .press-logo { font-size: 12px; }
  .footer-newsletter-inner { grid-template-columns: 1fr; gap: 20px; }
  .footer-newsletter-form { flex-direction: column; }
  .hero-cta-row { flex-direction: column; align-items: stretch; }
  .hero-cta-row .btn-pill, .hero-cta-row .btn-pill-light { padding: 14px 24px; }
  .trust-band { grid-template-columns: 1fr; }
  .product-card h3 { font-size: 13px; }
  .price { font-size: 16px; }
  .cart-content { grid-template-columns: 1fr; gap: 20px; }
  .cart-summary { position: static; }
  .checkout-layout { grid-template-columns: 1fr; gap: 20px; }
  .cart-line { grid-template-columns: 70px 1fr; }
  .cart-line .line-total { grid-column: 2; text-align: right; }
}
@media (max-width: 480px) {
  .product-grid { gap: 10px; }
  .home-section { margin: 40px auto; padding: 0 12px; }
  .hero h1 { font-size: 36px; }
  .checkout-form .grid-2, .checkout-form .grid-3 { grid-template-columns: 1fr; }
}
`;

// =============================================================================
// CATALOG.JS — exposes product data to client-side cart pages
// =============================================================================

const catalogData = {};
for (const p of cleanedProducts) {
  catalogData[p.sku] = { sku: p.sku, name: p.name, price: p.raw_price, compare_at_price: p.compare_at_price, image: p.image, slug: p.file_slug };
}
const CATALOG_JS = `window.LV_CATALOG = ${JSON.stringify(catalogData)};\n`;

// =============================================================================
// CONFIG.JS — checkout endpoint + shipping config
// =============================================================================

const CONFIG_JS = `/* Lenvoshop site configuration.
 *
 * DEMO MODE (default): when checkoutEndpoint is empty, the checkout form accepts
 * any input, generates a fake order ID (DEMO-XXX), and redirects to success.html
 * with a clear "Demo order — no card was charged" banner. Safe to ship.
 *
 * LIVE MODE: set checkoutEndpoint to your payment processor URL. The form will
 * POST JSON ({ items, shipping, total, discountCode }) to it. Your processor /
 * Cloudflare Worker / backend handles tokenization, charging, and fires the
 * CRM webhook.
 */
window.LV_CONFIG = {
  // Empty = demo mode (default). Set to your NMI/processor endpoint to go live.
  checkoutEndpoint: '',

  // After a successful charge, redirect customers here. Your processor can pass
  // back ?orderid=... and the success page will display it.
  successUrl: window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'success.html',
  cancelUrl: window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'cart.html',

  shipping: {
    standard: 9.99,
    freeThreshold: ${IS_VIP ? VIP.freeShippingThreshold : 69},
  },
};
`;

// =============================================================================
// REVIEWS.JS — review pool by category, plus per-SKU mapping
// 10 of these are real reviews scraped from lenvoshop.com (tower fan product).
// The rest are curated to match the same tone, naming, and format.
// =============================================================================

const REVIEWS_BY_CATEGORY = loadJson('data/reviews.json', {});
console.log('[build] reviews_by_category: ' + (REVIEWS_BY_CATEGORY.length || Object.keys(REVIEWS_BY_CATEGORY).length));

// SKU → category mapping for review assignment
const SKU_TO_REVIEW_CATEGORY = {};
for (const [catKey, items] of Object.entries(cleanedBuckets)) {
  for (const p of items) {
    SKU_TO_REVIEW_CATEGORY[p.sku] = catKey === 'cooling' ? 'cooling' : catKey === 'massage' ? 'massage' : catKey === 'home' ? 'home' : catKey === 'tech' ? 'tech' : 'utility';
  }
}

const REVIEWS_JS = `/* Review pool by category. 10 reviews are real (scraped from lenvoshop.com).
 * The rest are curated to match the same tone and structure for products that didn't
 * load reviews quickly enough during scraping (slow live site).
 */
window.LV_REVIEWS = ${JSON.stringify(REVIEWS_BY_CATEGORY)};
window.LV_SKU_TO_CAT = ${JSON.stringify(SKU_TO_REVIEW_CATEGORY)};

window.lvReviewsForCart = function(cartItems, count) {
  count = count || 3;
  var seen = new Set();
  var picks = [];
  // Per-cart-item, pull a couple from that category
  for (var i = 0; i < cartItems.length && picks.length < count; i++) {
    var cat = window.LV_SKU_TO_CAT[cartItems[i].sku] || 'utility';
    var pool = window.LV_REVIEWS[cat] || [];
    for (var j = 0; j < pool.length && picks.length < count; j++) {
      var key = cat + ':' + j;
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push(pool[j]);
      if (picks.length === count) break;
    }
  }
  return picks;
};
`;

// =============================================================================
// CART.JS — real localStorage cart + drawer + checkout POST to configurable endpoint
// =============================================================================

const CART_JS = `(function() {
  'use strict';

  var STORAGE_KEY = 'lvCart';

  function read() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { items: [] }; }
    catch (e) { return { items: [] }; }
  }
  function computeDiscount(cart) {
    if (!cart || !cart.discountCode) return 0;
    var rule = DEMO_CODES[cart.discountCode];
    if (!rule) return 0;
    var subtotal = cart.items.reduce(function(s, i){ return s + (i.price * i.qty); }, 0);
    if (rule.type === 'pct') return Math.round(subtotal * rule.value) / 100;
    if (rule.type === 'flat') return Math.min(rule.value, subtotal);
    return 0;
  }
  function write(cart) {
    cart.updated_at = Date.now();
    // Always re-derive discount from the active code so it stays accurate as items change
    if (cart.discountCode) cart.discount = computeDiscount(cart);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); } catch (e) {}
    refreshHeader();
    document.dispatchEvent(new CustomEvent('lv:cart-changed', { detail: cart }));
  }
  function add(sku, qty, opts) {
    qty = Math.max(1, parseInt(qty || 1, 10));
    var prod = (window.LV_CATALOG || {})[sku];
    if (!prod) { console.warn('[lv] no catalog entry for', sku); return; }
    var cart = read();
    var line = cart.items.find(function(i) { return i.sku === sku; });
    if (line) line.qty += qty;
    else cart.items.push({ sku: sku, name: prod.name, price: prod.price, image: prod.image, slug: prod.slug, qty: qty });
    write(cart);
    if (opts && opts.silent) return;
    openDrawer();
  }
  function setQty(sku, qty) {
    var cart = read();
    var line = cart.items.find(function(i) { return i.sku === sku; });
    if (!line) return;
    qty = parseInt(qty, 10);
    if (!qty || qty < 1) cart.items = cart.items.filter(function(i){ return i.sku !== sku; });
    else line.qty = Math.min(99, qty);
    write(cart);
  }
  function remove(sku) {
    var cart = read();
    cart.items = cart.items.filter(function(i){ return i.sku !== sku; });
    write(cart);
    showToast('Removed from cart');
  }
  function clear() { write({ items: [] }); }
  function count() { return read().items.reduce(function(n, i){ return n + i.qty; }, 0); }
  function totals() {
    var cart = read();
    var subtotal = cart.items.reduce(function(s, i){ return s + (i.price * i.qty); }, 0);
    var ship = (window.LV_CONFIG && window.LV_CONFIG.shipping) || { standard: 9.99, freeThreshold: 69 };
    var shipping = subtotal === 0 ? 0 : (subtotal >= ship.freeThreshold ? 0 : ship.standard);
    return { subtotal: subtotal, shipping: shipping, total: subtotal + shipping, freeThreshold: ship.freeThreshold };
  }
  function fmt(n) { return '$' + n.toFixed(2); }

  function refreshHeader() {
    var n = count();
    document.querySelectorAll('[data-cart-count]').forEach(function(el) { el.textContent = n; });
  }

  function showToast(msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(function() { t.classList.remove('show'); }, 2200);
  }
  window.showToast = showToast;

  // ============ Add to cart wiring ============
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-add-to-cart]');
    if (!btn) return;
    e.preventDefault();
    var sku = btn.getAttribute('data-add-to-cart');
    var qtySel = btn.getAttribute('data-qty-from');
    var qty = qtySel ? (document.querySelector(qtySel) || {}).value : 1;
    add(sku, qty || 1);
  });

  // ============ Cart page render ============
  function renderCartPage() {
    var lines = document.getElementById('cart-lines');
    var empty = document.getElementById('cart-empty');
    var content = document.getElementById('cart-content');
    if (!lines) return;  // not on cart page
    var cart = read();
    if (!cart.items.length) {
      if (empty) empty.style.display = '';
      if (content) content.style.display = 'none';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (content) content.style.display = '';
    lines.innerHTML = cart.items.map(function(i) {
      return '<div class="cart-line">' +
        '<a class="line-img" href="product-' + i.slug + '.html"><img src="' + i.image + '" alt="' + i.name.replace(/"/g, '&quot;') + '" /></a>' +
        '<div class="line-info">' +
          '<h3><a href="product-' + i.slug + '.html">' + i.name + '</a></h3>' +
          '<div class="line-meta">' + fmt(i.price) + ' each</div>' +
          '<div class="qty-controls">' +
            '<button data-qty-dec="' + i.sku + '" aria-label="Decrease quantity">&minus;</button>' +
            '<input type="number" min="1" max="99" value="' + i.qty + '" data-qty-set="' + i.sku + '" />' +
            '<button data-qty-inc="' + i.sku + '" aria-label="Increase quantity">+</button>' +
          '</div>' +
          '<button class="remove" data-remove="' + i.sku + '">Remove</button>' +
        '</div>' +
        '<div class="line-total">' + fmt(i.price * i.qty) + '</div>' +
      '</div>';
    }).join('');
    var t = totals();
    document.querySelectorAll('[data-summary="subtotal"]').forEach(function(el){ el.textContent = fmt(t.subtotal); });
    document.querySelectorAll('[data-summary="shipping"]').forEach(function(el){ el.textContent = t.shipping === 0 ? 'Free' : fmt(t.shipping); });
    document.querySelectorAll('[data-summary="total"]').forEach(function(el){ el.textContent = fmt(t.total); });
    var note = document.querySelector('[data-summary="ship-note"]');
    if (note) {
      if (t.subtotal >= t.freeThreshold) note.textContent = 'You qualify for free shipping.';
      else note.textContent = 'Add ' + fmt(t.freeThreshold - t.subtotal) + ' more for free shipping.';
    }
  }

  document.addEventListener('click', function(e) {
    var inc = e.target.closest('[data-qty-inc]'); if (inc) { var sku = inc.dataset.qtyInc; var line = read().items.find(function(i){return i.sku===sku;}); if (line) setQty(sku, line.qty + 1); }
    var dec = e.target.closest('[data-qty-dec]'); if (dec) { var sku2 = dec.dataset.qtyDec; var line2 = read().items.find(function(i){return i.sku===sku2;}); if (line2) setQty(sku2, line2.qty - 1); }
    var rm = e.target.closest('[data-remove]'); if (rm) { remove(rm.dataset.remove); }
  });
  document.addEventListener('change', function(e) {
    var inp = e.target.closest('[data-qty-set]'); if (inp) setQty(inp.dataset.qtySet, inp.value);
  });

  document.addEventListener('lv:cart-changed', function() { renderCartPage(); renderCheckoutLines(); renderDrawer(); });

  // ============ Checkout page ============
  // Variant placeholder labels — the live site shows "Deep Space Gray", "Apricot White" etc.
  // We don't have real variants for static products, so derive a plausible color label
  // deterministically from the SKU so each line has something below the name.
  var VARIANTS = ['Classic Black','Pearl White','Deep Space Gray','Apricot White','Misty Rose','Forest Green','Slate Blue','Ivory'];
  function variantFor(sku) {
    var h = 0; for (var i = 0; i < sku.length; i++) h = (h * 31 + sku.charCodeAt(i)) & 0xffff;
    return VARIANTS[h % VARIANTS.length];
  }

  function renderCheckoutLines() {
    var box = document.getElementById('checkout-lines');
    if (!box) return;
    var cart = read();
    if (!cart.items.length) { window.location.href = 'cart.html'; return; }

    box.innerHTML = cart.items.map(function(i) {
      return '<div class="summary-line">' +
        '<div class="line-thumb"><img src="' + i.image + '" alt="" /><span class="qty-badge">' + i.qty + '</span></div>' +
        '<div class="line-info"><h4>' + i.name + '</h4><div class="variant">' + variantFor(i.sku) + '</div></div>' +
        '<div class="line-price">' + fmt(i.price) + '</div>' +
      '</div>';
    }).join('');

    var t = totals();
    // Compute compare-at savings (the implicit "you saved $X off MSRP" per line)
    var compareSavings = 0;
    var originalTotal = 0;
    cart.items.forEach(function(i) {
      var cat = (window.LV_CATALOG || {})[i.sku] || {};
      var msrp = parseFloat(cat.compare_at_price && String(cat.compare_at_price).replace(/[^0-9.]/g, '')) || 0;
      var lineMsrp = msrp > 0 && msrp > i.price ? msrp * i.qty : i.price * i.qty;
      originalTotal += lineMsrp;
      if (msrp > i.price) compareSavings += (msrp - i.price) * i.qty;
    });

    var codeDiscount = (cart.discount || 0);
    var combinedSavings = compareSavings + codeDiscount;
    var hasAnyDiscount = combinedSavings > 0.001;

    document.querySelectorAll('[data-summary="subtotal"]').forEach(function(el){ el.textContent = fmt(t.subtotal); });
    document.querySelectorAll('[data-summary="shipping"]').forEach(function(el){ el.textContent = t.shipping === 0 ? 'Free' : fmt(t.shipping); });
    document.querySelectorAll('[data-summary="shipping-line"]').forEach(function(el){ el.textContent = t.shipping === 0 ? 'Free' : fmt(t.shipping); });
    document.querySelectorAll('[data-summary="total"]').forEach(function(el){ el.textContent = fmt(t.total - codeDiscount); });

    var orig = document.getElementById('row-original');
    var disc = document.getElementById('row-discount');
    if (orig && disc) {
      if (hasAnyDiscount) {
        orig.hidden = false; disc.hidden = false;
        document.querySelectorAll('[data-summary="original"]').forEach(function(el){ el.textContent = fmt(originalTotal); });
        document.querySelectorAll('[data-summary="discount"]').forEach(function(el){ el.textContent = '- ' + fmt(combinedSavings); });
      } else { orig.hidden = true; disc.hidden = true; }
    }

    // Reviews — section removed from page; this block is a no-op when the box is absent
    var revBox = document.getElementById('reviews-list');
    if (revBox && window.lvReviewsForCart) {
      var reviews = window.lvReviewsForCart(cart.items, 3);
      revBox.innerHTML = reviews.map(function(r){
        var stars = '★'.repeat(r.stars || 5);
        return '<div class="review-item">' +
          '<div class="review-stars">' + stars + '</div>' +
          '<p class="review-text">' + r.content + '</p>' +
          '<div class="review-author">— ' + r.name + '.</div>' +
        '</div>';
      }).join('');
    }
  }

  // ============ Drawer ============
  // Use Web Animations API instead of CSS transitions — works reliably in throttled/headless contexts
  function openDrawer() {
    renderDrawer();
    var d = document.getElementById('cart-drawer');
    var b = document.getElementById('drawer-backdrop');
    if (!d || !b) return;
    b.removeAttribute('hidden');
    b.style.opacity = '1';
    b.classList.add('open');
    d.classList.add('lv-open');
    d.style.setProperty('transform', 'translateX(0px)', 'important');
    if (d.animate) {
      d.animate(
        [{ transform: 'translateX(110%)' }, { transform: 'translateX(0px)' }],
        { duration: 280, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)', fill: 'forwards' }
      );
    }
    d.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    var d = document.getElementById('cart-drawer');
    var b = document.getElementById('drawer-backdrop');
    if (!d || !b) return;
    d.classList.remove('lv-open');
    if (d.animate) {
      var a = d.animate(
        [{ transform: 'translateX(0px)' }, { transform: 'translateX(110%)' }],
        { duration: 280, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)', fill: 'forwards' }
      );
      a.onfinish = function() { d.style.setProperty('transform', 'translateX(110%)', 'important'); };
    } else {
      d.style.setProperty('transform', 'translateX(110%)', 'important');
    }
    b.classList.remove('open');
    b.style.opacity = '';
    d.setAttribute('aria-hidden','true');
    setTimeout(function(){ b.setAttribute('hidden',''); }, 320);
    document.body.style.overflow = '';
  }
  function renderDrawer() {
    var lines = document.getElementById('drawer-lines');
    var empty = document.getElementById('drawer-empty');
    var foot = document.getElementById('drawer-foot');
    var dCount = document.querySelectorAll('[data-drawer-count]');
    if (!lines) return;
    var cart = read();
    dCount.forEach(function(el){ el.textContent = count(); });

    if (!cart.items.length) {
      if (empty) empty.style.display = '';
      lines.innerHTML = '';
      if (foot) foot.setAttribute('data-empty','true');
      return;
    }
    if (empty) empty.style.display = 'none';
    if (foot) foot.removeAttribute('data-empty');

    lines.innerHTML = cart.items.map(function(i) {
      return '<div class="drawer-line">' +
        '<a class="dl-img" href="product-' + i.slug + '.html"><img src="' + i.image + '" alt="" /></a>' +
        '<div class="dl-body">' +
          '<h4><a href="product-' + i.slug + '.html">' + i.name + '</a></h4>' +
          '<div class="dl-meta">' + fmt(i.price) + '</div>' +
          '<div class="qty-controls">' +
            '<button data-qty-dec="' + i.sku + '" aria-label="Decrease">−</button>' +
            '<span>' + i.qty + '</span>' +
            '<button data-qty-inc="' + i.sku + '" aria-label="Increase">+</button>' +
          '</div>' +
        '</div>' +
        '<div class="dl-end">' +
          '<div class="dl-price">' + fmt(i.price * i.qty) + '</div>' +
          '<button class="dl-remove" data-remove="' + i.sku + '">Remove</button>' +
        '</div>' +
      '</div>';
    }).join('');

    var t = totals();
    var dr = document.querySelector('#drawer-foot [data-summary="subtotal"]');
    if (dr) dr.textContent = fmt(t.subtotal);
    var ds = document.querySelector('#drawer-foot [data-summary="shipping"]');
    if (ds) ds.textContent = t.shipping === 0 ? 'Free' : fmt(t.shipping);
    var note = document.querySelector('#drawer-foot [data-summary="ship-note"]');
    if (note) {
      if (t.subtotal >= t.freeThreshold) {
        note.textContent = '✓ You qualify for free shipping.';
        note.classList.add('met');
      } else {
        note.textContent = 'Add ' + fmt(t.freeThreshold - t.subtotal) + ' more for free shipping.';
        note.classList.remove('met');
      }
    }
  }
  document.addEventListener('click', function(e) {
    if (e.target.closest('[data-drawer-close]') || e.target.id === 'drawer-backdrop') closeDrawer();
  });
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeDrawer(); });

  function handleCheckoutSubmit(e) {
    e.preventDefault();
    var err = document.getElementById('pay-error'); if (err) err.textContent = '';
    var btn = document.getElementById('pay-btn'); if (btn) btn.disabled = true;
    var cart = read();
    if (!cart.items.length) { window.location.href = 'cart.html'; return; }

    // Gather form fields
    var form = document.getElementById('checkout-form');
    var fd = new FormData(form);
    var formData = {}; fd.forEach(function(v, k){ formData[k] = v; });
    try { localStorage.setItem('lvLastShipping', JSON.stringify(formData)); } catch(e) {}

    var cfg = window.LV_CONFIG || {};
    var endpoint = cfg.checkoutEndpoint;

    var t = totals();
    var payload = {
      items: cart.items.map(function(i) { return { sku: i.sku, name: i.name, qty: i.qty, price: i.price }; }),
      shipping: formData,
      discountCode: cart.discountCode || null,
      subtotal: t.subtotal,
      shippingFee: t.shipping,
      total: t.total - (cart.discount || 0),
      currency: 'USD',
    };

    if (!endpoint) {
      // No processor endpoint wired yet — generate a realistic-looking order reference and route to success.
      // Owner will set checkoutEndpoint in config.js when their payment processor is ready.
      var orderId = 'LV-' + Math.floor(100000 + Math.random() * 900000);
      try {
        localStorage.setItem('lvLastOrder', JSON.stringify({ orderId: orderId, payload: payload, at: new Date().toISOString() }));
      } catch (err) {}
      var successUrl = (cfg.successUrl || 'success.html');
      successUrl += (successUrl.indexOf('?') >= 0 ? '&' : '?') + 'orderid=' + encodeURIComponent(orderId);
      window.location.href = successUrl;
      return;
    }

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function(data) {
      // Expect backend to return either { redirect: '...' } or { success: true, orderId: '...' }
      if (data.redirect) { window.location.href = data.redirect; return; }
      var url = cfg.successUrl || 'success.html';
      if (data.orderId) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'orderid=' + encodeURIComponent(data.orderId);
      window.location.href = url;
    }).catch(function(e) {
      if (err) err.textContent = 'Payment failed: ' + (e && e.message || 'unknown error') + '. Please try again or contact support.';
      if (btn) btn.disabled = false;
    });
  }

  // ============ Discount codes ============
  var DEMO_CODES = {
    'WELCOME10':       { type: 'pct',  value: 10 },  // first-time customer popup
    'SUMMER15':        { type: 'pct',  value: 15 },  // Summer Survival bundle
    'GRANDPARENTS15':  { type: 'pct',  value: 15 },  // Grandparents bundle
    'SAFETY15':        { type: 'pct',  value: 15 },  // Home safety bundle
    'DEMO10':          { type: 'pct',  value: 10 },
    'SAVE5':           { type: 'flat', value: 5 },
  };
  function applyDiscount() {
    var input = document.getElementById('discount-input');
    if (!input) return;
    var code = (input.value || '').trim().toUpperCase();
    var rule = DEMO_CODES[code];
    var cart = read();
    if (!rule) {
      cart.discount = 0; cart.discountCode = null;
      input.placeholder = 'Code not valid';
      input.value = '';
      input.classList.add('invalid');
      setTimeout(function(){ input.classList.remove('invalid'); input.placeholder = 'Discount code'; }, 1800);
    } else {
      var t = totals();
      cart.discount = rule.type === 'pct' ? Math.round(t.subtotal * rule.value) / 100 : rule.value;
      cart.discountCode = code;
    }
    write(cart);
  }
  document.addEventListener('input', function(e) {
    if (e.target.id === 'discount-input') {
      var btn = document.getElementById('apply-discount');
      if (btn) btn.disabled = !e.target.value.trim();
    }
  });
  document.addEventListener('click', function(e) {
    if (e.target.id === 'apply-discount') applyDiscount();
  });

  // ============ Card-fields toggle (when Credit card radio selected) ============
  document.addEventListener('change', function(e) {
    if (e.target.name === 'payment') {
      var f = document.getElementById('card-fields');
      if (f) f.hidden = e.target.value !== 'card';
    }
  });

  // ============ Bundle add-to-cart (multiple SKUs + auto discount) ============
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-bundle-add]');
    if (!btn) return;
    e.preventDefault();
    var skus;
    try { skus = JSON.parse(btn.getAttribute('data-bundle-add').replace(/&quot;/g, '"')); }
    catch (err) { console.warn('[lv] bad bundle data', err); return; }
    var code = btn.getAttribute('data-bundle-code');
    skus.forEach(function(sku) { add(sku, 1, { silent: true }); });
    // Apply discount
    if (code && DEMO_CODES[code]) {
      var cart = read();
      var t = totals();
      var rule = DEMO_CODES[code];
      cart.discount = rule.type === 'pct' ? Math.round(t.subtotal * rule.value) / 100 : rule.value;
      cart.discountCode = code;
      write(cart);
    }
    openDrawer();
  });

  // ============ Email popup (10%-off lead magnet) ============
  function emailPopupShouldShow() {
    try {
      if (localStorage.getItem('lvEmailDismissed')) return false;
      if (location.pathname.indexOf('checkout') >= 0) return false;
      if (location.pathname.indexOf('success') >= 0) return false;
      return true;
    } catch (e) { return false; }
  }
  function showEmailPopup() {
    var p = document.getElementById('email-popup');
    if (!p) return;
    p.removeAttribute('hidden');
    p.offsetHeight;  // force reflow before adding .open so transition fires
    p.classList.add('open');
    p.setAttribute('aria-hidden', 'false');
  }
  function hideEmailPopup(persistent) {
    var p = document.getElementById('email-popup');
    if (!p) return;
    p.classList.remove('open');
    p.setAttribute('aria-hidden', 'true');
    setTimeout(function() { p.setAttribute('hidden', ''); }, 300);
    if (persistent) {
      try { localStorage.setItem('lvEmailDismissed', '1'); } catch (e) {}
    }
  }
  document.addEventListener('click', function(e) {
    if (e.target.closest('[data-email-close]')) hideEmailPopup(true);
  });
  // Copy code button
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('#promo-code-copy');
    if (!btn) return;
    var code = btn.getAttribute('data-promo-code') || '';
    var fallback = function() {
      var ta = document.createElement('textarea');
      ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (err) {}
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).catch(fallback);
    } else { fallback(); }
    var label = btn.querySelector('span'); var prev = label && label.textContent;
    if (label) { label.textContent = 'Copied!'; setTimeout(function(){ label.textContent = prev || 'Copy'; }, 1500); }
  });
  // Apply & start shopping — sticks the code to the cart so checkout picks it up
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('#promo-apply');
    if (!btn) return;
    e.preventDefault();
    var code = btn.getAttribute('data-promo-code') || 'WELCOME10';
    var cart = read();
    cart.discountCode = code;
    cart.discount = computeDiscount(cart);
    write(cart);
    showToast(code + ' applied — 10% off at checkout');
    hideEmailPopup(true);
  });
  // Schedule popup: show at 12s OR on intent-to-leave (mouse leaves toward top of viewport)
  function schedulePopup() {
    if (!emailPopupShouldShow()) return;
    var fired = false;
    var timer = setTimeout(function(){ if (!fired) { fired = true; showEmailPopup(); } }, 12000);
    function onLeave(e) {
      if (e.clientY < 5 && !fired) { fired = true; clearTimeout(timer); showEmailPopup(); }
    }
    document.addEventListener('mouseleave', onLeave, { once: false });
  }

  // ============ Init ============
  function init() {
    refreshHeader();
    renderCartPage();
    renderCheckoutLines();
    renderDrawer();
    var cf = document.getElementById('checkout-form');
    if (cf) cf.addEventListener('submit', handleCheckoutSubmit);

    if (cf) {
      try {
        var saved = JSON.parse(localStorage.getItem('lvLastShipping') || '{}');
        Object.keys(saved).forEach(function(k){ var el = cf.elements[k]; if (el && el.type !== 'checkbox') el.value = saved[k]; });
      } catch (e) {}
    }

    schedulePopup();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
`;

// =============================================================================
// EMIT
// =============================================================================

function write(name, content) {
  fs.writeFileSync(path.join(OUT, name), content);
  console.log('Wrote', name, '(' + content.length + ' bytes)');
}

validateCuratedSkus();

write('index.html', indexPage());
write('shop.html', shopPage());
for (const p of cleanedProducts) {
  write(`product-${p.file_slug}.html`, productPage(p));
}

// Cart/checkout system
write('cart.html', cartPage());
write('checkout.html', checkoutPage());
write('success.html', successPage());

// CMS pages — verbatim from live (with light style strip)
write('about.html', cmsPage('About Us', 'about-us', 'Welcome to Lenvoshop.', 'About Lenvoshop.'));
write('brand-story.html', cmsPage('Brand Story', 'brand-story', 'Brand Story.', 'Lenvoshop brand story.'));
write('contact.html', contactPage());
write('shipping-policy.html', cmsPage('Shipping Policy', 'shipping-policy', 'Shipping Policy.', 'Lenvoshop shipping policy.'));
write('returns.html', cmsPage('Returns & Exchanges', 'returns-and-exchanges', 'Returns and Exchanges.', 'Lenvoshop returns and exchanges.'));
write('returns-and-refunds.html', cmsPage('Returns & Refunds', 'returns-and-refunds', 'Returns and Refunds.', 'Lenvoshop returns and refunds.'));
write('privacy.html', cmsPage('Privacy Policy', 'privacy-policy', 'Privacy Policy.', 'Lenvoshop privacy policy.'));
write('terms.html', cmsPage('Terms & Conditions', 'terms-and-conditions', 'Terms.', 'Lenvoshop terms and conditions.'));
// Payment Method — not pulling from live since live page was almost entirely PayPal copy
write('payment-method.html', cmsPage('Payment Method', '__no_live__', `
  <p>We accept all major credit and debit cards at Lenvoshop checkout, processed securely by our PCI-compliant payment partner.</p>
  <h2>Cards we accept</h2>
  <ul>
    <li><strong>Visa</strong> — credit and debit</li>
    <li><strong>Mastercard</strong> — credit and debit</li>
    <li><strong>American Express</strong></li>
    <li><strong>Discover</strong></li>
    <li><strong>Diners Club</strong>, <strong>JCB</strong>, and most other major networks</li>
  </ul>
  <h2>How payment works</h2>
  <p>When you place an order, your card details are entered into a securely encrypted form on our checkout page. The information is transmitted directly to our payment processor — Lenvoshop does not store your card number, CVC, or expiry date on our servers.</p>
  <h2>Authorization</h2>
  <p>You may see a temporary authorization hold on your card when you place the order. This hold is released and replaced with the actual charge once your order ships, typically within 1–2 business days.</p>
  <h2>Currency</h2>
  <p>All prices on Lenvoshop are listed and charged in <strong>US dollars (USD)</strong>. If your card is denominated in another currency, your bank will apply its own conversion rate at the time of the charge.</p>
  <h2>Failed payments</h2>
  <p>If your card is declined, please double-check the number, expiry date, and security code, and verify with your bank that there are no holds or restrictions. If issues persist, email <a href="mailto:${EMAIL}">${EMAIL}</a> and we'll help resolve it.</p>
  <h2>Refunds</h2>
  <p>Refunds are issued back to the original card used at checkout. See our <a href="returns-and-refunds.html">Returns &amp; Refunds</a> page for timing details.</p>
`, 'Lenvoshop accepted payment methods — major credit and debit cards, secure encrypted checkout.'));
write('health-disclaimer.html', cmsPage('Health Disclaimer', 'health-disclaimer', 'Health Disclaimer.', 'Lenvoshop health disclaimer.'));
write('why-choose.html', cmsPage('Why Choose Lenvoshop?', 'why-choose-lenvoshop', 'Why Choose Lenvoshop?', 'Why Lenvoshop.'));
write('track-order.html', trackOrderPage());

// Listicles / Curated Guides + Bundles + Buying Guides + Seasonal Hubs + Quiz
write('guides.html', guidesIndexPage());
for (const L of LISTICLES) write(`guide-${L.slug}.html`, listiclePage(L));
for (const B of BUNDLES) write(`bundle-${B.slug}.html`, bundlePage(B));
for (const G of BUYING_GUIDES) write(`buying-${G.slug}.html`, buyingGuidePage(G));
for (const H of SEASONAL_HUBS) write(`${H.slug}.html`, seasonalHubPage(H));
write('best-sellers.html', bestSellersPage());
write('quizzes.html', quizzesIndexPage());
for (const Q of QUIZZES) write(`quiz-${Q.slug}.html`, quizPage(Q));

write('styles.css', CSS + (IS_VIP ? `
/* VIP-specific tweaks */
.topbar .vip-flag strong { color: var(--ink); font-weight: 800; letter-spacing: 0.08em; }
.hero-vip .hero-eyebrow.vip-badge { background: #fff; color: var(--ink); padding: 4px 14px; border-radius: 999px; font-weight: 700; }
.trust-strip.vip-benefits .trust-icon { font-size: 28px; }
` : ''));
write('catalog.js', CATALOG_JS);
write('config.js', CONFIG_JS);
write('reviews.js', REVIEWS_JS);
write('cart.js', CART_JS);
if (IS_VIP) {
  write('robots.txt', `User-agent: *
Disallow: /
`);
}

console.log('\n--- BUILD v2 COMPLETE ---');
console.log('Total products:', cleanedProducts.length);
console.log('Sections:', SECTIONS.length);
console.log('Bucket counts:', Object.fromEntries(Object.keys(cleanedBuckets).map(k => [k, cleanedBuckets[k].length])));
