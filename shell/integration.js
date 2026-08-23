/* ═══════════════════════════════════════════════════════════════════════════
   BREEZE — CHROME ↔ SHELL INTEGRATION
   Does the UI actually drive real Chromium tabs? Boots the real window, loads
   real local pages through the same bridge the UI uses, and asserts the
   sidebar, address bar and nav buttons reflect real state.

     xvfb-run -a electron integration.js --no-sandbox --disable-gpu
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const fs   = require('fs');

/* Real pages over real HTTP. file:// is deliberately refused by the shell
   (it is a local-file read from the omnibox), so testing with file:// would
   be testing a path users can never take. */
let PORT = 0;
const server = http.createServer((req, res) => {
  const name = (req.url || '/').split('?')[0].replace(/^\//, '') || 'alpha.html';
  const f = path.join(__dirname, 'ui', 'testsites', path.basename(name));
  fs.readFile(f, (err, buf) => {
    if (err){ res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(buf);
  });
});

const results = [];
const ok = (n, c, x = '') => results.push([c ? 'PASS' : 'FAIL', n, x]);
const wait = ms => new Promise(r => setTimeout(r, ms));

require('./main.js');            // boots the real shell

app.whenReady().then(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', () => { PORT = server.address().port; r(); }));
  await wait(1800);
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { ok('window exists', false); return finish(); }
  ok('window exists', true);

  const exec = js => win.webContents.executeJavaScript(js);
  const site = n => `http://127.0.0.1:${PORT}/${n}.html`;
  const titles = () => exec(`[...document.querySelectorAll('.tab .t')].map(e=>e.textContent).join('|')`);

  try {
    ok('adapter engaged (data-shell="1")',
       await exec(`document.documentElement.dataset.shell === '1'`));

    ok('bridge reachable from the chrome',
       await exec(`typeof window.__BREEZE_SHELL__ === 'object'`));

    const id = await exec(`window.__BREEZE_SHELL__.newTab({url:${JSON.stringify(site('alpha'))}})`);
    await wait(1400);
    ok('newTab returns a real id', typeof id === 'number', 'id=' + id);

    const t1 = await titles();
    ok('sidebar shows the REAL page title', /Alpha Site/.test(t1), t1.slice(0, 55));

    const addr = await exec(`document.querySelector('#urlText').textContent`);
    ok('address bar shows the real URL', /alpha\.html/.test(addr), addr.slice(0, 45));

    await exec(`window.__BREEZE_SHELL__.navigate(${id}, ${JSON.stringify(site('beta'))})`);
    await wait(1400);
    ok('navigation updates the sidebar', /Beta Site/.test(await titles()));

    ok('back enabled after navigating',
       await exec(`!document.querySelector('#navBack').disabled`));

    await exec(`window.__BREEZE_SHELL__.back(${id})`);
    await wait(1100);
    ok('back returns to the previous real page', /Alpha Site/.test(await titles()));

    const hits = await exec(`window.__BREEZE_SHELL__.find(${id},'browser')`);
    ok('findInPage runs against real content', typeof hits === 'number', 'req=' + hits);

    const geo = await exec(`(()=>{const r=document.querySelector('#content').getBoundingClientRect();
      return Math.round(r.left)+','+Math.round(r.top);})()`);
    ok('chrome reports a real content gap', /^\d+,\d+$/.test(geo) && !geo.startsWith('0,'), geo);

    await exec(`window.__BREEZE_SHELL__.closeTab(${id})`);
    await wait(900);
    ok('closing removes it from the sidebar', !/Alpha/.test(await titles()));
  } catch (err) {
    results.push(['FAIL', 'integration threw', String(err.message || err).slice(0, 90)]);
  }
  finish();
});

function finish(){
  const failed = results.filter(r => r[0] === 'FAIL');
  console.log('\n── BREEZE CHROME↔SHELL INTEGRATION ──');
  results.forEach(([s, n, x]) => console.log(`  ${s}  ${n}${x ? '  [' + x + ']' : ''}`));
  console.log(`\n  ${results.length - failed.length}/${results.length} passed\n`);
  app.exit(failed.length ? 1 : 0);
}
