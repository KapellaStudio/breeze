/* BREEZE — VISIBLE BROWSER INTERACTION REGRESSION
   Clicks the packaged controls a user actually touches. */
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

let PORT = 0;
const server = http.createServer((req, res) => {
  const name = (req.url || '/').split('?')[0].replace(/^\//, '') || 'alpha.html';
  const file = path.join(__dirname, 'ui', 'testsites', path.basename(name));
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(buf);
  });
});

const results = [];
const ok = (name, condition, detail = '') => results.push([condition ? 'PASS' : 'FAIL', name, detail]);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
require('./bootstrap.js');

app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(); }));
  await wait(1900);
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { ok('window exists', false); return finish(); }
  const exec = js => win.webContents.executeJavaScript(js);
  const site = name => `http://127.0.0.1:${PORT}/${name}.html`;

  try {
    await exec(`window.__BREEZE_SHELL__.completeFirstRun().catch(()=>null)`);
    await wait(150);

    const editable = await exec(`(()=>{const i=document.querySelector('.bigsearch input');return !!i && !i.readOnly && i.tabIndex>=0 && getComputedStyle(i).pointerEvents!=='none';})()`);
    ok('home Search or enter URL is editable', editable);

    const searchDefault = await exec(`Promise.all([window.__BREEZE_SHELL__.searchConfig(),window.__BREEZE_SHELL__.getPreferences()])`);
    ok('legacy Brave default migrates to Google once', searchDefault[0]?.provider === 'Google' && searchDefault[1]?.searchProviderMigrated === true, searchDefault[0]?.provider || 'missing');

    const beforeNew = await exec(`window.__BREEZE_SHELL__.listTabs().then(x=>x.length)`);
    await exec(`document.querySelector('#tablist .newtab').click()`);
    await wait(300);
    const afterNew = await exec(`window.__BREEZE_SHELL__.listTabs()`);
    ok('visible New tab creates exactly one real tab', afterNew.length === beforeNew + 1, `${beforeNew}->${afterNew.length}`);
    const blankId = afterNew.find(t => t.active)?.id;

    await exec(`(()=>{const i=document.querySelector('.bigsearch input');i.value=${JSON.stringify(site('alpha'))};i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));})()`);
    await wait(1200);
    const searched = await exec(`window.__BREEZE_SHELL__.listTabs().then(x=>x.find(t=>t.id===${Number(blankId) || 0}))`);
    ok('home search navigates that tab instead of doing nothing', /alpha\.html/.test(searched?.url || ''), searched?.url || 'missing');

    const countBeforeX = await exec(`window.__BREEZE_SHELL__.listTabs().then(x=>x.length)`);
    const clickedX = await exec(`(()=>{const row=[...document.querySelectorAll('#tablist .tab')].find(b=>/Alpha Site/.test(b.querySelector('.t')?.textContent||''));if(!row)return false;row.querySelector('.x').click();return true;})()`);
    await wait(350);
    const afterX = await exec(`window.__BREEZE_SHELL__.listTabs()`);
    ok('sidebar tab X is clickable', clickedX);
    ok('sidebar tab X closes the real tab', afterX.length === countBeforeX - 1 && !afterX.some(t => t.id === blankId), `${countBeforeX}->${afterX.length}`);

    const continueId = await exec(`window.__BREEZE_SHELL__.newTab({url:${JSON.stringify(site('alpha'))}})`);
    await wait(1200);
    await exec(`setView('home')`);
    await wait(350);
    const countBeforeContinue = await exec(`window.__BREEZE_SHELL__.listTabs().then(x=>x.length)`);
    const clickedContinue = await exec(`(()=>{const c=[...document.querySelectorAll('.continue .card')].find(x=>x.querySelector('.kind')?.textContent.trim()==='Recent page'&&/Alpha Site/.test(x.querySelector('h3')?.textContent||''));if(!c)return false;c.click();return true;})()`);
    await wait(550);
    const afterContinue = await exec(`window.__BREEZE_SHELL__.listTabs()`);
    ok('Continue exposes the recent page card', clickedContinue);
    ok('Continue reuses the already-open matching tab', afterContinue.length === countBeforeContinue && afterContinue.find(t=>t.active)?.id === continueId, `count=${afterContinue.length} active=${afterContinue.find(t=>t.active)?.id}`);
  } catch (err) {
    results.push(['FAIL', 'interaction regression threw', String(err.message || err).slice(0, 140)]);
  }
  finish();
});

function finish() {
  try { server.close(); } catch {}
  const failed = results.filter(row => row[0] === 'FAIL');
  console.log('\n── BREEZE VISIBLE BROWSER INTERACTIONS ──');
  results.forEach(([status, name, detail]) => console.log(`  ${status}  ${name}${detail ? '  [' + detail + ']' : ''}`));
  console.log(`\n  ${results.length - failed.length}/${results.length} passed\n`);
  app.exit(failed.length ? 1 : 0);
}
