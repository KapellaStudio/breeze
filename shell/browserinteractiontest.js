/* BREEZE — VISIBLE BROWSER INTERACTION REGRESSION
   Clicks the packaged controls a normal person actually touches.
   Network-dependent web/weather data is tested elsewhere against local stubs. */
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
    await wait(450);

    ok('daily-use interaction module loaded', await exec(`document.documentElement.dataset.usabilityPass==='1'`));
    ok('home Search or enter URL is editable', await exec(`(()=>{const i=document.querySelector('.bigsearch input');return !!i&&!i.readOnly&&i.tabIndex>=0&&getComputedStyle(i).pointerEvents!=='none';})()`));

    const searchDefault = await exec(`Promise.all([window.__BREEZE_SHELL__.searchConfig(),window.__BREEZE_SHELL__.getPreferences()])`);
    ok('Brave is not the active Breeze search provider', searchDefault[0]?.provider === 'Google', searchDefault[0]?.provider || 'missing');
    ok('Brave is not offered in visible search settings', await exec(`![...document.querySelectorAll('#engRow .engBtn')].some(b=>/brave/i.test(b.textContent||''))`));

    const beforeNew = await exec(`window.__BREEZE_SHELL__.listTabs().then(x=>x.length)`);
    await exec(`document.querySelector('#tablist .newtab').click()`); await wait(300);
    const afterNew = await exec(`window.__BREEZE_SHELL__.listTabs()`);
    ok('visible New tab creates exactly one real tab', afterNew.length === beforeNew + 1, `${beforeNew}->${afterNew.length}`);
    const blankId = afterNew.find(t => t.active)?.id;

    await exec(`(()=>{const i=document.querySelector('.bigsearch input');i.value=${JSON.stringify(site('alpha'))};i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));})()`); await wait(1200);
    const searched = await exec(`window.__BREEZE_SHELL__.listTabs().then(x=>x.find(t=>t.id===${Number(blankId)||0}))`);
    ok('home search navigates that tab instead of doing nothing', /alpha\.html/.test(searched?.url||''), searched?.url||'missing');

    const countBeforeX = await exec(`window.__BREEZE_SHELL__.listTabs().then(x=>x.length)`);
    const clickedX = await exec(`(()=>{const row=[...document.querySelectorAll('#tablist .tab')].find(b=>/Alpha Site/.test(b.querySelector('.t')?.textContent||''));if(!row)return false;row.querySelector('.x').click();return true;})()`); await wait(350);
    const afterX = await exec(`window.__BREEZE_SHELL__.listTabs()`);
    ok('sidebar tab X is clickable', clickedX);
    ok('sidebar tab X closes the real tab', afterX.length===countBeforeX-1&&!afterX.some(t=>t.id===blankId), `${countBeforeX}->${afterX.length}`);

    const continueId = await exec(`window.__BREEZE_SHELL__.newTab({url:${JSON.stringify(site('alpha'))}})`); await wait(1200);
    await exec(`setView('home')`); await wait(350);
    const countBeforeContinue = await exec(`window.__BREEZE_SHELL__.listTabs().then(x=>x.length)`);
    const clickedContinue = await exec(`(()=>{const c=[...document.querySelectorAll('.continue .card')].find(x=>x.querySelector('.kind')?.textContent.trim()==='Recent page'&&/Alpha Site/.test(x.querySelector('h3')?.textContent||''));if(!c)return false;c.click();return true;})()`); await wait(550);
    const afterContinue = await exec(`window.__BREEZE_SHELL__.listTabs()`);
    ok('Continue exposes the recent page card', clickedContinue);
    ok('Continue reuses the already-open matching tab', afterContinue.length===countBeforeContinue&&afterContinue.find(t=>t.active)?.id===continueId, `count=${afterContinue.length} active=${afterContinue.find(t=>t.active)?.id}`);

    ok('browser starts without a forced side panel', await exec(`![...document.querySelectorAll('aside.panel')].some(p=>p.dataset.on==='1')`));
    ok('weather is present in the working toolbar', await exec(`!!document.querySelector('#toolbarWeather')&&!!document.querySelector('#toolbarWeather').textContent.trim()`));
    const weatherPrefs = await exec(`window.__BREEZE_SHELL__.getPreferences()`);
    ok('weather was restored for the beta toolbar', weatherPrefs?.weatherEnabled===true);

    await exec(`setView('browse')`);
    await exec(`window.__BREEZE_SHELL__.listTabs().then(async tabs=>{const t=tabs.find(x=>x.active);if(t&&await window.__BREEZE_SHELL__.isBookmarked(t.id))await window.__BREEZE_SHELL__.toggleBookmark(t.id);})`); await wait(150);
    ok('bookmark toolbar is a one-click action, not a panel', await exec(`(()=>{const b=document.querySelector('#toolbarBookmarkBtn');return !!b&&!b.hasAttribute('data-panel')&&b.title==='Bookmark this page';})()`));
    await exec(`document.querySelector('#toolbarBookmarkBtn').click()`); await wait(250);
    const bookmarkSaved = await exec(`window.__BREEZE_SHELL__.listTabs().then(t=>{const a=t.find(x=>x.active);return Promise.all([window.__BREEZE_SHELL__.isBookmarked(a.id),document.querySelector('#toolbarBookmarkBtn').getAttribute('aria-pressed')])})`);
    ok('one click bookmarks the current page', bookmarkSaved[0]===true&&bookmarkSaved[1]==='true');
    await exec(`document.querySelector('#toolbarBookmarkBtn').click()`); await wait(200);
    ok('second bookmark click removes it', await exec(`window.__BREEZE_SHELL__.listTabs().then(t=>{const a=t.find(x=>x.active);return window.__BREEZE_SHELL__.isBookmarked(a.id)})`)===false);

    const notesControl = await exec(`(()=>{const b=document.querySelector('[data-panel="notes"]');if(!b)return false;b.click();return true;})()`); await wait(220);
    ok('Notes control remains live after Tools consolidation', notesControl);
    const composer = await exec(`!!document.querySelector('aside[data-p="notes"][data-on="1"] #breezeQuickNote')`);
    ok('Notes opens an inline composer instead of a prompt', composer);
    const noteBody = 'Daily workflow regression note';
    if (composer) {
      await exec(`(()=>{const t=document.querySelector('#breezeQuickNote');t.value=${JSON.stringify(noteBody)};t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#breezeSaveNote').click();})()`); await wait(350);
      const noteRow = await exec(`window.__BREEZE_SHELL__.listTabs().then(t=>{const a=t.find(x=>x.active);const w=a&&!a.private?String(a.workspace||'default'):'default';return window.__BREEZE_SHELL__.listNotes(w).then(rows=>rows.find(n=>n.body===${JSON.stringify(noteBody)})||null)})`);
      ok('Save note persists the typed note', !!noteRow?.id);
      if(noteRow?.id) await exec(`window.__BREEZE_SHELL__.removeNote(${JSON.stringify(noteRow.id)})`);
    }

    for (const panel of ['queue','downloads','snapshots']) {
      const clicked = await exec(`(()=>{const b=document.querySelector('[data-panel="${panel}"]');if(!b)return false;b.click();return true;})()`); await wait(100);
      ok(`${panel} control remains live`, clicked);
      ok(`${panel} control opens its real panel`, await exec(`document.querySelector('aside[data-p="${panel}"]').dataset.on==='1'`));
    }
    await exec(`closePanels()`);

    await exec(`document.querySelector('#flowBtn').click()`); await wait(100);
    ok('Breeze Flow control opens Flow', await exec(`document.documentElement.dataset.view==='flow'`));
    const flowLoader = await exec(`(async()=>{await flowLoadMediaInfo({id:'test-media',kind:'audio',name:'sample.wav',ext:'wav',size:1024});return{id:flowMediaJob?.id,options:document.querySelectorAll('#flowMediaFormat option').length,status:document.querySelector('#flowMediaResult')?.textContent||''};})()`);
    ok('Flow media loader does not recurse/crash', flowLoader?.id==='test-media'&&flowLoader?.options>0&&/Ready/.test(flowLoader?.status||''), flowLoader?.status||'missing');
    await exec(`setView('browse')`);

    const compactBefore = await exec(`document.documentElement.dataset.compact||'0'`);
    await exec(`document.querySelector('#compactBtn').click()`); await wait(80);
    const compactAfter = await exec(`document.documentElement.dataset.compact||'0'`);
    ok('Compact control changes real layout state', compactAfter!==compactBefore, `${compactBefore}->${compactAfter}`);
    await exec(`document.querySelector('#compactBtn').click()`);

    await exec(`document.querySelector('#extBtn').click()`); await wait(80);
    ok('Extensions control opens the extension popover', await exec(`document.querySelector('#extPop').dataset.on==='1'`));
    await exec(`closeAll()`);

    const themeBefore = await exec(`document.documentElement.dataset.theme`);
    await exec(`document.querySelector('[data-theme-toggle]').click()`);
    const themeAfter = await exec(`document.documentElement.dataset.theme`);
    ok('Theme control changes Breeze chrome theme', themeAfter!==themeBefore, `${themeBefore}->${themeAfter}`);
    await exec(`document.querySelector('[data-theme-toggle]').click()`);

    await exec(`document.querySelector('.tools [data-open="set"]').click()`); await wait(80);
    ok('three-dot button opens the application menu', await exec(`document.querySelector('#appMenu').dataset.on==='1'`));
    await exec(`closeAll()`);

    const betaId = await exec(`window.__BREEZE_SHELL__.newTab({url:${JSON.stringify(site('beta'))}})`); await wait(850);
    await exec(`window.__BREEZE_SHELL__.selectTab(${Number(continueId)})`); await wait(220);
    await exec(`document.querySelector('#splitBtn').click()`); await wait(400);
    const splitOpen = await exec(`window.__BREEZE_SHELL__.splitState()`);
    ok('Split View control opens two real web panes', splitOpen?.active===true&&splitOpen?.leftTabId!=null&&splitOpen?.rightTabId!=null);
    await exec(`document.querySelector('#splitBtn').click()`); await wait(250);
    const splitClosed = await exec(`window.__BREEZE_SHELL__.splitState()`);
    ok('Split View control closes the split cleanly', splitClosed?.active===false);
    if(betaId) await exec(`window.__BREEZE_SHELL__.closeTab(${Number(betaId)})`);

    ok('window controls are connected to named shell actions', await exec(`(()=>{const s=window.__BREEZE_SHELL__;return ['minimize','toggleMaximize','close'].every(k=>typeof s[k]==='function')&&['winMin','winMax','winClose'].every(id=>!!document.getElementById(id));})()`));
  } catch (err) {
    results.push(['FAIL','interaction regression threw',String(err.message||err).slice(0,180)]);
  }
  finish();
});

function finish(){
  try{server.close();}catch{}
  const failed=results.filter(row=>row[0]==='FAIL');
  console.log('\n── BREEZE DAILY-USE INTERACTIONS ──');
  results.forEach(([status,name,detail])=>console.log(`  ${status}  ${name}${detail?'  ['+detail+']':''}`));
  console.log(`\n  ${results.length-failed.length}/${results.length} passed\n`);
  app.exit(failed.length?1:0);
}
