/* Deploy script — single canonical private repo, updates in place.
 *
 * Behavior:
 *  - One canonical repo per brand (default: `lenvoshop`)
 *  - Private by default
 *  - On first run: creates the repo, seeds files, enables Pages
 *  - On subsequent runs: GET /git/trees to enumerate existing files,
 *    PUT each local file (with sha if changed/exists) — only changed files
 *    actually mutate, and any repo file no longer in working/ is deleted.
 *
 * Run: /usr/local/bin/node deploy.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const CONFIG_PATH = process.env.DEPLOY_CONFIG_PATH || '/Users/zak/sites/.deploy-config.json';
const WORKING = path.join(__dirname, 'working');
const REPO_NAME = process.env.LV_REPO || 'lenvoshop';
const PRIVATE = (process.env.LV_PRIVATE || 'true') !== 'false';

function api(method, pathname, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com', path: pathname, method,
      headers: {
        'User-Agent': 'lenvoshop-deploy',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch (e) {}
        resolve({ status: res.statusCode, body: parsed, raw: buf });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function walk(dir, base = '') {
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (fs.statSync(full).isDirectory()) entries.push(...walk(full, rel));
    else entries.push({ full, rel });
  }
  return entries;
}

// Git's blob SHA: sha1("blob " + size + "\0" + content)
function gitBlobSha(buf) {
  const header = Buffer.from(`blob ${buf.length}\0`);
  return crypto.createHash('sha1').update(Buffer.concat([header, buf])).digest('hex');
}

(async () => {
  let cfg = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) {}
  }
  const token = cfg.token || cfg.GITHUB_TOKEN || cfg.github_token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    console.error('Missing token. Set $GITHUB_TOKEN (CI) or put it in', CONFIG_PATH);
    process.exit(1);
  }
  let owner = cfg.owner || cfg.username || cfg.user;
  if (!owner) {
    const me = await api('GET', '/user', token);
    owner = me.body && me.body.login;
    if (!owner) { console.error('Could not resolve owner'); process.exit(1); }
  }
  console.log(`Owner: ${owner}  →  ${REPO_NAME}  (private: ${PRIVATE})`);

  // 1. Ensure repo exists with correct privacy setting
  const probe = await api('GET', `/repos/${owner}/${REPO_NAME}`, token);
  if (probe.status === 404) {
    console.log('Repo missing — creating…');
    const create = await api('POST', '/user/repos', token, {
      name: REPO_NAME,
      description: 'Lenvoshop static store rebuild',
      private: PRIVATE,
      auto_init: true,
    });
    if (create.status !== 201) { console.error('Create failed:', create.status, create.raw); process.exit(1); }
    console.log('Created:', create.body.html_url);
    await new Promise(r => setTimeout(r, 1500)); // wait for auto_init
  } else if (probe.status === 200) {
    if (probe.body.private !== PRIVATE) {
      console.log(`Updating privacy: ${probe.body.private} → ${PRIVATE}`);
      await api('PATCH', `/repos/${owner}/${REPO_NAME}`, token, { private: PRIVATE });
    } else {
      console.log('Repo exists, privacy correct.');
    }
  } else {
    console.error('Repo probe failed:', probe.status, probe.raw); process.exit(1);
  }

  // 2. Enumerate existing files in the repo
  const tree = await api('GET', `/repos/${owner}/${REPO_NAME}/git/trees/main?recursive=1`, token);
  const remote = {};
  if (tree.status === 200 && tree.body && tree.body.tree) {
    for (const t of tree.body.tree) {
      if (t.type === 'blob') remote[t.path] = t.sha;
    }
  }
  console.log(`Remote: ${Object.keys(remote).length} existing files`);

  // 3. Walk local + diff
  const localFiles = walk(WORKING);
  console.log(`Local: ${localFiles.length} files`);
  let updated = 0, created = 0, unchanged = 0, failed = 0;

  for (const f of localFiles) {
    const buf = fs.readFileSync(f.full);
    const localSha = gitBlobSha(buf);
    const remoteSha = remote[f.rel];

    if (remoteSha === localSha) { unchanged++; delete remote[f.rel]; continue; }

    const content = buf.toString('base64');
    const action = remoteSha ? 'update' : 'create';
    const body = {
      message: `${action}: ${f.rel}`,
      content,
      ...(remoteSha ? { sha: remoteSha } : {}),
    };
    const r = await api('PUT', `/repos/${owner}/${REPO_NAME}/contents/${encodeURI(f.rel)}`, token, body);
    if (r.status === 201) created++;
    else if (r.status === 200) updated++;
    else { console.error(`  fail [${r.status}] ${f.rel}: ${r.raw.slice(0, 200)}`); failed++; }
    if (remoteSha) delete remote[f.rel];
    process.stdout.write('.');
  }
  console.log('');

  // 4. Delete stale remote files (in repo, not in working/) — but PRESERVE source paths
  // Source files live alongside output in the canonical repo for clone-and-go handoff.
  // Don't delete them just because they're not in working/.
  const PRESERVE = [
    /^build\.js$/,
    /^deploy\.js$/,
    /^HANDOFF\.md$/,
    /^README\.md$/,
    /^data\//,
    /^scripts\//,
    /^ci-templates\//,
    /^\.github\//,
    /^\.gitignore$/,
    /^package(-lock)?\.json$/,
  ];
  let deleted = 0;
  const staleFiles = Object.keys(remote).filter(p => !PRESERVE.some(re => re.test(p)));
  if (staleFiles.length) console.log(`Deleting ${staleFiles.length} stale files (skipping ${Object.keys(remote).length - staleFiles.length} source paths)…`);
  for (const stalePath of staleFiles) {
    const r = await api('DELETE', `/repos/${owner}/${REPO_NAME}/contents/${encodeURI(stalePath)}`, token, {
      message: `delete: ${stalePath}`,
      sha: remote[stalePath],
    });
    if (r.status === 200) deleted++;
    else console.error(`  delete fail [${r.status}] ${stalePath}`);
  }

  console.log(`\nSummary: ${created} created, ${updated} updated, ${unchanged} unchanged, ${deleted} deleted, ${failed} failed`);

  // 5. Ensure Pages enabled (only valid if repo is public OR owner has Pro)
  const pagesProbe = await api('GET', `/repos/${owner}/${REPO_NAME}/pages`, token);
  if (pagesProbe.status === 404) {
    const pagesEnable = await api('POST', `/repos/${owner}/${REPO_NAME}/pages`, token, {
      source: { branch: 'main', path: '/' },
    });
    if (pagesEnable.status === 201) console.log('Pages enabled.');
    else console.log(`Pages enable: ${pagesEnable.status} ${pagesEnable.raw.slice(0, 200)}`);
  } else if (pagesProbe.status === 200) {
    console.log('Pages already enabled:', pagesProbe.body.html_url);
  }

  const pagesUrl = `https://${owner}.github.io/${REPO_NAME}/`;
  console.log(`\n✅ ${pagesUrl}`);
  if (PRIVATE) console.log('Note: Pages on private repos requires GitHub Pro/Team/Enterprise — site may not be reachable on free plans.');
})().catch(e => { console.error(e); process.exit(1); });
