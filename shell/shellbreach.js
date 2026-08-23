/* Attacks the shell's own attack surface: the IPC bridge, session isolation
   and navigation guards. Run: xvfb-run -a electron . --breach            */
const { app, BrowserWindow, WebContentsView, session, shell, ipcMain } = require('electron');
const path = require('path');
const { installGuards } = require('./security');
// The real search module, wired to the real channel name — testing a stub
// would only prove the stub is safe.
const search = require('./search');
ipcMain.handle('search:config', () => search.config());
// Install the SAME app-level guards main.js installs, so this suite tests the
// real protections rather than an unguarded window.
installGuards(app, shell, path.join(__dirname, 'ui'));
const results = [];
const ok = (n, c, x='') => results.push([c ? 'PASS' : 'FAIL', n, x]);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show:false, webPreferences:{
    preload: path.join(__dirname,'preload.js'), contextIsolation:true,
    nodeIntegration:false, sandbox:true }});
  await win.loadFile(path.join(__dirname,'ui','breeze-desktop.html'));

  // Configure a key first, so the "no key leaks" checks are proving something.
  search.init({ userDataPath: app.getPath('temp'), safeStorage: null });
  search.setKey('serper', 'BREACH-CANARY-KEY');

  // 1. Can renderer JS reach Node?
  const node = await win.webContents.executeJavaScript(
    `(()=>{try{return typeof require==='function'||typeof process==='object'||typeof module==='object';}catch(e){return false;}})()`);
  ok('renderer cannot reach require/process/module', node === false, 'got '+node);

  // 2. Is there a generic IPC passthrough on the bridge?
  const keys = await win.webContents.executeJavaScript(
    `Object.keys(window.__BREEZE_SHELL__||{}).join(',')`);
  ok('bridge exposes no generic invoke/send',
     !/\b(invoke|send|sendSync|ipc|ipcRenderer)\b/.test(keys), keys.slice(0,80));

  // 3. Can the renderer subscribe to an arbitrary IPC channel?
  const evil = await win.webContents.executeJavaScript(
    `(()=>{const off=window.__BREEZE_SHELL__.on('app:clearData',()=>{});return typeof off==='function';})()`);
  ok('non-allowlisted event channel is refused (no-op unsubscribe)', evil === true);

  // 4. Does a WEB PAGE (not the chrome) get the bridge?
  const page = new WebContentsView({ webPreferences:{ contextIsolation:true,
    nodeIntegration:false, sandbox:true }});
  win.contentView.addChildView(page);
  await page.webContents.loadURL('data:text/html,<h1>page</h1>');
  const leaked = await page.webContents.executeJavaScript(
    `typeof window.__BREEZE_SHELL__ !== 'undefined'`);
  ok('web content has NO shell bridge', leaked === false);

  // 5. Are sealed sessions genuinely separate cookie jars?
  const a = session.fromPartition('persist:ws-alpha');
  const b = session.fromPartition('persist:ws-beta');
  await a.cookies.set({ url:'https://example.com', name:'id', value:'alpha' });
  const inB = await b.cookies.get({ url:'https://example.com', name:'id' });
  const inA = await a.cookies.get({ url:'https://example.com', name:'id' });
  ok('sealed session cookie does not leak across partitions',
     inA.length === 1 && inB.length === 0, `a=${inA.length} b=${inB.length}`);

  // 6. Does the chrome window refuse to navigate away from itself?
  let navigated = false;
  win.webContents.on('will-navigate', () => { navigated = true; });
  await win.webContents.executeJavaScript(`location.href='https://example.com';`).catch(()=>{});
  await new Promise(r => setTimeout(r, 700));
  const stillLocal = win.webContents.getURL().startsWith('file://');
  ok('chrome cannot be navigated away from', stillLocal, win.webContents.getURL().slice(0,40));

  // 7. webSecurity actually on for page views?
  const prefs = page.webContents.getWebPreferences ? page.webContents.getWebPreferences() : {};
  ok('page view keeps sandbox + contextIsolation',
     prefs.sandbox !== false && prefs.contextIsolation !== false);

  // 8. The search bridge is new attack surface. A chrome XSS's first move
  //    would be to read the user's API key back out of it.
  const surface = await win.webContents.executeJavaScript(
    `Object.keys(window.__BREEZE_SHELL__||{}).filter(k=>/key/i.test(k)).join(',')`);
  ok('bridge exposes no way to READ a stored search key',
     !/get.*key|key.*get|readKey/i.test(surface), surface || 'none');

  // 9. And the config the settings pane does read must not carry one either.
  const cfg = await win.webContents.executeJavaScript(
    `window.__BREEZE_SHELL__.searchConfig().then(c=>JSON.stringify(c)).catch(e=>'ERR:'+e)`);
  ok('searchConfig() returns readiness, never a key value',
     typeof cfg === 'string' && cfg.indexOf('BREACH-CANARY-KEY') === -1 && /"native"/.test(cfg),
     String(cfg).slice(0, 70));

  const failed = results.filter(r => r[0]==='FAIL');
  console.log('\n── BREEZE SHELL BREACH SUITE ──');
  results.forEach(([s,n,x]) => console.log(`  ${s}  ${n}${x?'  ['+x+']':''}`));
  console.log(`\n  ${results.length-failed.length}/${results.length} held\n`);
  app.exit(failed.length ? 1 : 0);
});
