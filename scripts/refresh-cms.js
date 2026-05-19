/* Re-fetch all CMS pages from api.lenvoshop.com and update local cms_*.html files.
 * Reports which pages changed since last fetch.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

const SLUGS = [
  'shipping-policy',
  'returns-and-exchanges',
  'returns-and-refunds',
  'privacy-policy',
  'terms-and-conditions',
  'health-disclaimer',
  'payment-method',
  'about-us',
  'brand-story',
  'contact-us',
  'why-choose-lenvoshop',
  'track-your-order',
];

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'lenvoshop-refresh-cms/1.0',
        'Accept': 'application/json',
        'Origin': 'https://lenvoshop.com',
        'Referer': 'https://lenvoshop.com/',
      },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({status: res.statusCode, body}));
    }).on('error', reject);
  });
}

function sha(s) { return crypto.createHash('sha1').update(s).digest('hex').slice(0, 8); }

(async () => {
  const results = [];
  for (const slug of SLUGS) {
    const url = `https://api.lenvoshop.com/api/v1/categories/cms-detail/${slug}?locale=en`;
    const r = await get(url);
    let html = '';
    try {
      const j = JSON.parse(r.body);
      const item = Array.isArray(j.data) ? j.data[0] : j.data;
      html = item && item.html_content || '';
    } catch (e) { console.warn(slug, 'parse error'); continue; }
    const localPath = path.join(ROOT, `cms_${slug}.html`);
    const old = fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf8') : '';
    if (old === html) {
      results.push({ slug, status: 'unchanged', bytes: html.length });
    } else {
      fs.writeFileSync(localPath, html);
      results.push({ slug, status: old ? 'updated' : 'created', bytes: html.length, oldSha: sha(old), newSha: sha(html) });
    }
  }
  console.log('CMS refresh:');
  for (const r of results) {
    if (r.status === 'unchanged') console.log(`  =  ${r.slug} (${r.bytes}b)`);
    else console.log(`  ${r.status === 'created' ? '+' : '~'}  ${r.slug} (${r.bytes}b) ${r.oldSha} → ${r.newSha}`);
  }
})();
