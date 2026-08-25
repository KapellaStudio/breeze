/* ═══════════════════════════════════════════════════════════════════════════
   BREEZE — SEARCH SUITE
   Run: npx electron searchtest.js --no-sandbox   (or `npm run searchtest`)

   Every provider is exercised against a LOCAL stub server, so this suite
   needs no network, no API key and spends nobody's quota. That is the point:
   a test that only passes when someone's Serper credits are topped up is not
   a test, and the parsing and error paths are where the bugs actually live.

   The stub also serves pages for the signal measurement checks, which is the
   only way to assert a tracker count against a known answer.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const { app } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const search = require('./search');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  (cond ? pass++ : fail++);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};

const SERPER = {
  organic: [
    { link: 'https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API',
      title: 'Service Worker API', snippet: 'Acts as a proxy between app and network.' },
    { link: 'https://arxiv.org/abs/2603.04417',
      title: 'Offline-first patterns', snippet: 'We survey conflict resolution.' }
  ]
};
const TAVILY = {
  results: [
    { url: 'https://github.com/example/repo', title: 'example/repo', content: 'A repository.' }
  ]
};
const SEARX = {
  results: [
    { url: 'https://example.org/a', title: 'Example A', content: 'First.' },
    { url: 'https://example.org/b', title: 'Example B', content: 'Second.' }
  ]
};

const PAGE = `<!doctype html><html><head>
<script src="https://www.google-analytics.com/analytics.js"></script>
<script src="https://connect.facebook.net/en_US/fbevents.js"></script>
<script src="https://cdn.example.org/app.js"></script>
<script src="/local.js"></script>
</head><body><article>${'word '.repeat(440)}</article></body></html>`;

let hits = { serper: 0, tavily: 0, searx: 0, htmlmode: 0 };

function stub(){
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      const send = (code, body, type = 'application/json') => {
        res.writeHead(code, { 'Content-Type': type }); res.end(body);
      };
      if (u.pathname === '/serper'){
        hits.serper++;
        if (req.headers['x-api-key'] !== 'test-key') return send(401, '{}');
        return send(200, JSON.stringify(SERPER));
      }
      if (u.pathname === '/tavily'){
        hits.tavily++;
        if (req.headers.authorization !== 'Bearer test-key') return send(401, '{}');
        return send(200, JSON.stringify(TAVILY));
      }
      if (u.pathname === '/search'){
        hits.searx++;
        if (u.searchParams.get('format') !== 'json') return send(403, 'forbidden', 'text/plain');
        return send(200, JSON.stringify(SEARX));
      }
      if (u.pathname === '/htmlmode/search'){
        hits.htmlmode++;
        return send(200, '<html><body>results</body></html>', 'text/html');
      }
      if (u.pathname === '/ratelimited') return send(429, '{}');
      if (u.pathname === '/page')  return send(200, PAGE, 'text/html');
      if (u.pathname === '/short') return send(200, '<html><body>hi</body></html>', 'text/html');
      send(404, '{}');
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

async function main(){
  const { srv, port } = await stub();
  const base = `http://127.0.0.1:${port}`;
  console.log('\n── BREEZE SEARCH SUITE ──');

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'breeze-searchtest-'));
  search.init({ userDataPath: dataDir, safeStorage: null });

  search.setProvider('Brave Search');
  let r = await search.search('offline first');
  ok('legacy Brave provider remains readable for migration', r.mode === 'redirect' &&
     r.url.includes('search.brave.com') && r.url.includes('offline%20first'), r.mode);

  search.setProvider('DuckDuckGo');
  r = await search.search('x');
  ok('engine choice changes the redirect target', r.url.includes('duckduckgo.com'));

  r = await search.search('   ');
  ok('empty query refused', !!r.error);

  search.setProvider('serper');
  r = await search.search('anything');
  ok('native provider with no key asks for setup', r.mode === 'needsSetup' && r.needs === 'key', r.mode);

  const setRes = search.setKey('serper', 'test-key');
  ok('key without OS keychain is session-only, and says so',
     setRes.ok && setRes.stored === 'session-only' && !!setRes.warning);
  ok('config never leaks the key',
     JSON.stringify(search.config()).indexOf('test-key') === -1);
  ok('config reports the provider as ready',
     search.config().native.find(p => p.id === 'serper').ready === true);

  r = await search.search('offline first', { endpointOverride: base + '/serper' });
  ok('serper results parse', r.mode === 'results' && r.rows.length === 2, r.mode + ' ' + (r.rows || []).length);
  ok('result carries a usable url + domain',
     r.rows[0].url.startsWith('https://developer.mozilla.org') && r.rows[0].dom === 'developer.mozilla.org');
  ok('kind is inferred', r.rows[0].kind === 'Docs' && r.rows[1].kind === 'Paper',
     r.rows[0].kind + '/' + r.rows[1].kind);
  ok('signals are null until measured',
     r.rows.every(x => x.read === null && x.tr === null && x.kb === null));

  const before = hits.serper;
  r = await search.search('offline first', { endpointOverride: base + '/serper' });
  ok('repeat query served from cache, no quota spent',
     r.cached === true && hits.serper === before, 'requests=' + hits.serper);

  search.setKey('serper', 'wrong');
  r = await search.search('fresh query', { endpointOverride: base + '/serper' });
  ok('rejected key produces a readable error, not a crash',
     r.mode === 'error' && /rejected the key/i.test(r.message), r.message);
  ok('error still hands back a working Google fallback url',
     r.mode === 'error' && r.fallback.includes('www.google.com/search'));

  r = await search.search('rl', { endpointOverride: base + '/ratelimited' });
  ok('rate limit is named as a quota problem', /rate limiting/i.test(r.message || ''), r.message);

  search.setProvider('tavily');
  search.setKey('tavily', 'test-key');
  r = await search.search('repo', { endpointOverride: base + '/tavily' });
  ok('tavily results parse', r.mode === 'results' && r.rows[0].dom === 'github.com', r.mode);

  search.setProvider('searxng');
  r = await search.search('x');
  ok('searxng with no instance url asks for one', r.mode === 'needsSetup' && r.needs === 'url');
  ok('instance url must be http(s)', !!search.setSearxngUrl('ftp://nope').error);
  search.setSearxngUrl(base);
  r = await search.search('example');
  ok('searxng results parse', r.mode === 'results' && r.rows.length === 2, r.mode);

  search.setSearxngUrl(base + '/htmlmode');
  r = await search.search('other query');
  ok('an instance answering HTML is diagnosed, not JSON.parse-crashed',
     r.mode === 'error' && /web page, not JSON/i.test(r.message), r.message);
  ok('an instance hosted under a path is queried at that path, not the root',
     hits.htmlmode === 1, 'hits=' + hits.htmlmode);

  search.setSignals(false);
  let m = await search.measure(base + '/page');
  ok('measurement refused while signals are off', m.error === 'signals off');
  search.setSignals(true);
  m = await search.measure(base + '/page');
  ok('tracker count is real, and counts only blocklisted third parties', m.tr === 2, 'tr=' + m.tr);
  ok('page weight reported', /KB|MB/.test(m.kb || ''), m.kb);
  ok('read time from word count', m.read === '2 min', m.read);
  m = await search.measure(base + '/short');
  ok('a page with no prose reports no read time, rather than "1 min"', m.read === null);
  m = await search.measure('javascript:alert(1)');
  ok('non-http url refused by the measurer', !!m.error, m.error);

  delete require.cache[require.resolve('./search')];
  const fresh = require('./search');
  fresh.init({ userDataPath: dataDir, safeStorage: null });
  const fc = fresh.config();
  ok('provider and instance url persist across a restart',
     fc.provider === 'searxng' && fc.searxngUrl === base + '/htmlmode', fc.provider);
  ok('a session-only key does NOT persist across a restart',
     fc.native.find(p => p.id === 'serper').ready === false);
  ok('nothing on disk contains the key',
     fs.readFileSync(path.join(dataDir, 'search.json'), 'utf8').indexOf('test-key') === -1);

  console.log(`\n  ${pass}/${pass + fail} passed\n`);
  srv.close();
  app.exit(fail ? 1 : 0);
}

app.whenReady().then(main).catch(err => {
  console.error(err);
  app.exit(1);
});
