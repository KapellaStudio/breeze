/* ═══════════════════════════════════════════════════════════════════════════
   BREEZE — CHROME ↔ SHELL INTEGRATION
   Boots the packaged bootstrap, real chrome and real local HTTP pages. This
   catches the dangerous class of bug where a polished prototype handler still
   toasts success instead of driving Chromium.

     xvfb-run -a electron integration.js --no-sandbox --disable-gpu
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const fs   = require('fs');

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

require('./bootstrap.js');

app.whenReady().then(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', () => { PORT = server.address().port; r(); }));
  await wait(1900);
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { ok('window exists', false); return finish(); }
  ok('window exists', true);

  const exec = js => win.webContents.executeJavaScript(js);
  const site = n => `http://127.0.0.1:${PORT}/${n}.html`;
  const titles = () => exec(`[...document.querySelectorAll('.tab .t')].map(e=>e.textContent).join('|')`);

  try {
    ok('adapter engaged (data-shell="1")', await exec(`document.documentElement.dataset.shell === '1'`));
    ok('trusted bridge reachable', await exec(`typeof window.__BREEZE_SHELL__ === 'object'`));
    ok('packaged first-run service reachable', await exec(`window.__BREEZE_SHELL__.firstRunStatus().then(x=>typeof x.firstRunComplete==='boolean')`));
    ok('live weather bridge is present', await exec(`typeof window.__BREEZE_SHELL__.currentWeather === 'function'`));
    ok('true tab sleep bridge is present', await exec(`typeof window.__BREEZE_SHELL__.sleepTab === 'function' && typeof window.__BREEZE_SHELL__.wakeTab === 'function'`));
    ok('browser-grade omnibox bridge is present', await exec(`typeof window.__BREEZE_SHELL__.resolveOmnibox==='function' && typeof window.__BREEZE_SHELL__.omniboxSuggestions==='function'`));
    ok('Google shortcut resolves to a real search URL', await exec(`window.__BREEZE_SHELL__.resolveOmnibox('!g breeze browser').then(x=>x.kind==='engine'&&x.engine==='Google'&&/google\\.com\\/search/.test(x.url))`));
    ok('New Tab keeps a real weather control', await exec(`!!document.querySelector('.homebar .wx') && /Weather/.test(document.querySelector('.homebar .wx').textContent)`));
    ok('weather starts opt-in, not as a fake reading', await exec(`window.__BREEZE_SHELL__.getPreferences().then(p=>p.weatherEnabled===false)`));
    ok('real tab sleeping defaults on', await exec(`window.__BREEZE_SHELL__.getPreferences().then(p=>p.sleep===true)`));
    ok('search suggestions are a real persisted preference', await exec(`window.__BREEZE_SHELL__.getPreferences().then(p=>typeof p.searchSuggestions==='boolean'&&typeof p.searchLibrary==='boolean')`));
    ok('unsupported split control is hidden', await exec(`getComputedStyle(document.querySelector('#splitBtn')).display === 'none'`));

    const id = await exec(`window.__BREEZE_SHELL__.newTab({url:${JSON.stringify(site('alpha'))}})`);
    await wait(1400);
    ok('newTab returns a real id', typeof id === 'number', 'id=' + id);
    const t1 = await titles();
    ok('sidebar shows the REAL page title', /Alpha Site/.test(t1), t1.slice(0, 55));
    const addr = await exec(`document.querySelector('#urlText').textContent`);
    ok('address bar shows the real URL', /alpha\.html/.test(addr), addr.slice(0, 45));

    await exec(`window.__BREEZE_SHELL__.navigate(${id}, ${JSON.stringify(site('beta'))})`);
    await wait(1200);
    ok('navigation updates the sidebar', /Beta Site/.test(await titles()));
    ok('back enabled after navigating', await exec(`!document.querySelector('#navBack').disabled`));
    await exec(`window.__BREEZE_SHELL__.back(${id})`);
    await wait(1000);
    ok('back returns to previous real page', /Alpha Site/.test(await titles()));

    /* The visible omnibox must search the browser itself, not a canned array. */
    await exec(`(()=>{openOmni();const i=document.querySelector('#omniInput');i.value='@tabs Alpha';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait(350);
    ok('@tabs renders the real open Alpha tab', await exec(`([...document.querySelectorAll('#omniList .ovRow .t')].some(x=>/Alpha Site/.test(x.textContent)))`));
    await exec(`closeAll()`);

    /* Private browsing owns the remote-suggestion decision inside preload.
       The chrome cannot pass a false flag to opt a Private tab into sending
       partial queries to an autocomplete provider. */
    const privateId=await exec(`window.__BREEZE_SHELL__.newPrivateTab({url:${JSON.stringify(site('beta'))}})`);
    await wait(650);
    const privateSuggest=await exec(`window.__BREEZE_SHELL__.omniboxSuggestions('private search text')`);
    ok('Private browsing suppresses remote omnibox suggestions', privateSuggest?.reason==='private' && Array.isArray(privateSuggest?.suggestions) && privateSuggest.suggestions.length===0, privateSuggest?.reason||'');
    await exec(`window.__BREEZE_SHELL__.closeTab(${privateId});window.__BREEZE_SHELL__.selectTab(${id})`);
    await wait(300);

    /* Real sleeping destroys the inactive renderer, keeps the tab in chrome,
       then restores its navigation stack into a fresh renderer. */
    const sleeper = await exec(`window.__BREEZE_SHELL__.newTab({url:${JSON.stringify(site('beta'))}})`);
    await wait(900);
    await exec(`window.__BREEZE_SHELL__.selectTab(${id})`);
    await wait(200);
    const slept = await exec(`window.__BREEZE_SHELL__.sleepTab(${sleeper})`);
    ok('inactive web tab actually enters sleep', slept?.ok===true && slept?.releasedRenderer===true);
    ok('sleep state is observable from tab:list', await exec(`window.__BREEZE_SHELL__.listTabs().then(x=>x.some(t=>t.id===${sleeper}&&t.sleeping===true))`));
    await wait(120);
    ok('sidebar marks released renderer as sleeping', await exec(`!!document.querySelector('.tab[data-asleep="1"] .zzz')`));
    ok('sleep status reports released renderers, not fake MB', await exec(`(()=>{const s=document.querySelector('.sleepStat');return !!s && /renderer/.test(s.textContent) && !/MB|GB/.test(s.textContent);})()`));
    await exec(`window.__BREEZE_SHELL__.selectTab(${sleeper})`);
    await wait(1200);
    ok('selecting sleeping tab reconstructs Chromium', await exec(`window.__BREEZE_SHELL__.listTabs().then(x=>x.some(t=>t.id===${sleeper}&&!t.sleeping&&!t.waking))`));
    ok('woken tab restores its real page', /Beta Site/.test(await titles()));
    await exec(`window.__BREEZE_SHELL__.closeTab(${sleeper})`);
    await wait(250);
    await exec(`window.__BREEZE_SHELL__.selectTab(${id})`);

    const hits = await exec(`window.__BREEZE_SHELL__.find(${id},'browser')`);
    ok('findInPage runs against real content', typeof hits === 'number', 'req=' + hits);

    const geo = await exec(`(()=>{const r=document.querySelector('#content').getBoundingClientRect();return Math.round(r.left)+','+Math.round(r.top);})()`);
    ok('chrome reports a real content gap', /^\d+,\d+$/.test(geo) && !geo.startsWith('0,'), geo);

    await exec(`document.querySelector('[data-seg="rail"] [data-v="off"]').click()`);
    await wait(180);
    ok('Sidebar Hidden setting changes real layout', await exec(`document.documentElement.dataset.sidebar==='off' && getComputedStyle(document.querySelector('.side')).display==='none'`));
    ok('Sidebar preference persisted', await exec(`window.__BREEZE_SHELL__.getPreferences().then(p=>p.sidebar==='off')`));
    await exec(`document.querySelector('[data-seg="rail"] [data-v="on"]').click()`);
    await wait(120);

    await exec(`(()=>{
      SR_DATA.length=0;
      SR_DATA.push({title:'Beta Search Hit',dom:'127.0.0.1',path:'/beta.html',url:${JSON.stringify(site('beta'))},kind:'Web',snip:'A local integration search result',k:null,read:null,tr:null,kb:null});
      renderSearch();
    })()`);
    await wait(250);
    ok('prototype Glance/Split search actions removed', await exec(`![...document.querySelectorAll('#srList .srAct')].some(b=>['Glance','Split'].includes(b.textContent.trim()))`));
    await exec(`([...document.querySelectorAll('#srList .srAct')].find(b=>b.textContent.trim()==='Queue'))?.click()`);
    await wait(220);
    ok('search Queue action persists real URL', await exec(`window.__BREEZE_SHELL__.listQueue('default').then(x=>x.some(q=>q.url===${JSON.stringify(site('beta'))}))`));
    await exec(`document.querySelector('#srList .sr').click()`);
    await wait(1200);
    ok('clicking native search result navigates Chromium', /Beta Site/.test(await titles()));

    await exec(`window.__BREEZE_SHELL__.closeTab(${id})`);
    await wait(800);
    ok('closing removes it from sidebar', !/Beta Site/.test(await titles()));
  } catch (err) {
    results.push(['FAIL', 'integration threw', String(err.message || err).slice(0, 120)]);
  }
  finish();
});

function finish(){
  try{server.close();}catch{}
  const failed = results.filter(r => r[0] === 'FAIL');
  console.log('\n── BREEZE PACKAGED INTEGRATION ──');
  results.forEach(([s, n, x]) => console.log(`  ${s}  ${n}${x ? '  [' + x + ']' : ''}`));
  console.log(`\n  ${results.length - failed.length}/${results.length} passed\n`);
  app.exit(failed.length ? 1 : 0);
}
