/* Breeze onboarding/native-theme integration guard.
   This is not a substitute for the user's physical Windows mouse test. It
   proves two main-process contracts that previously regressed: first-run UI
   must hide the native WebContentsView hit-test surface, and Breeze's saved
   theme must be handed to Chromium through Electron nativeTheme. */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, nativeTheme } = require('electron');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'breeze-onboarding-theme-'));
app.setPath('userData', profile);

const results = [];
const ok = (name, pass, detail='') => results.push([pass?'PASS':'FAIL', name, detail]);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

require('./bootstrap.js');

app.whenReady().then(async()=>{
  await wait(1800);
  const win = BrowserWindow.getAllWindows()[0];
  if(!win){ok('browser window exists',false);return finish();}
  const exec = code => win.webContents.executeJavaScript(code);
  try{
    const status = await exec(`window.__BREEZE_SHELL__.firstRunStatus()`);
    ok('fresh profile is still first-run', status?.firstRunComplete === false);
    ok('first-run dialog is visible', await exec(`document.querySelector('.bzLaunch')?.dataset.on === '1'`));
    ok('onboarding guard reports native surface hidden', await exec(`document.documentElement.dataset.onboardingSurface === 'hidden'`));
    const hiddenBounds = win.contentView.children.map(v=>v.getBounds());
    ok('native page views cannot intercept onboarding input', hiddenBounds.length>0 && hiddenBounds.every(b=>b.width===0 || b.height===0), JSON.stringify(hiddenBounds));

    await exec(`document.querySelector('[data-launch-later]').click()`);
    await wait(350);
    ok('Not now closes onboarding', await exec(`document.querySelector('.bzLaunch')?.dataset.on !== '1'`));
    ok('onboarding guard restores native surface state', await exec(`document.documentElement.dataset.onboardingSurface === 'restored'`));
    const restoredBounds = win.contentView.children.map(v=>v.getBounds());
    ok('native page view returns after onboarding', restoredBounds.some(b=>b.width>0 && b.height>0), JSON.stringify(restoredBounds));

    const dark = await exec(`window.__BREEZE_SHELL__.setPreference('theme','dark')`);
    await wait(120);
    ok('dark preference persists', dark?.preferences?.theme === 'dark');
    ok('dark preference reaches Chromium nativeTheme', nativeTheme.themeSource === 'dark', nativeTheme.themeSource);

    const light = await exec(`window.__BREEZE_SHELL__.setPreference('theme','light')`);
    await wait(120);
    ok('light preference persists', light?.preferences?.theme === 'light');
    ok('light preference reaches Chromium nativeTheme', nativeTheme.themeSource === 'light', nativeTheme.themeSource);
  }catch(err){
    ok('onboarding/theme test did not throw', false, String(err?.message||err).slice(0,180));
  }
  finish();
});

function finish(){
  const failed=results.filter(r=>r[0]==='FAIL');
  console.log('\n── BREEZE ONBOARDING + THEME HANDOFF ──');
  for(const [state,name,detail] of results) console.log(`  ${state}  ${name}${detail?'  ['+detail+']':''}`);
  console.log(`\n  ${results.length-failed.length}/${results.length} passed\n`);
  try{fs.rmSync(profile,{recursive:true,force:true});}catch{}
  app.exit(failed.length?1:0);
}
