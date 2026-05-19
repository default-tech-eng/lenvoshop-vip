/* Lenvoshop site configuration.
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
    freeThreshold: 0,
  },
};
