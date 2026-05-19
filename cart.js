(function() {
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
