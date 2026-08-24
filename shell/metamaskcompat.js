'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

let pass = 0, fail = 0;
function ok(name, cond, detail='') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  cond ? pass++ : fail++;
}
function write(dir, file, body){
  const full = path.join(dir,file);
  fs.mkdirSync(path.dirname(full),{recursive:true});
  fs.writeFileSync(full,body);
}
function serve(){
  return new Promise(resolve => {
    const srv = http.createServer((_req,res) => {
      res.writeHead(200, {'content-type':'text/html'});
      res.end('<!doctype html><html><head><title>Breeze wallet probe</title></head><body><h1>Wallet target</h1></body></html>');
    });
    srv.listen(0,'127.0.0.1',()=>resolve(srv));
  });
}

(async()=>{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'breeze-metamask-'));
  const extDir = path.join(tmp,'extension');
  fs.mkdirSync(extDir,{recursive:true});

  // Mirrors the important Chrome surface declared by MetaMask's current MV3
  // manifest. The fixture is synthetic: it probes browser capability without
  // bundling or redistributing MetaMask itself.
  const manifest = {
    manifest_version:3,
    name:'Breeze MetaMask Surface Probe',
    version:'1.0.0',
    permissions:[
      'activeTab','alarms','clipboardWrite','notifications','scripting','storage',
      'unlimitedStorage','webRequest','offscreen','identity','sidePanel','cookies'
    ],
    optional_permissions:['clipboardRead'],
    host_permissions:['http://127.0.0.1/*','https://*/*','ws://*/*','wss://*/*'],
    background:{service_worker:'worker.js'},
    action:{default_title:'Wallet Probe',default_popup:'popup.html'},
    commands:{'_execute_action':{suggested_key:{default:'Alt+Shift+M'}}},
    content_scripts:[
      {matches:['http://127.0.0.1/*'],js:['isolated.js'],run_at:'document_start',all_frames:true},
      {matches:['http://127.0.0.1/*'],js:['inpage.js'],run_at:'document_start',world:'MAIN',all_frames:true}
    ],
    sandbox:{pages:['sandbox.html']}
  };
  write(extDir,'manifest.json',JSON.stringify(manifest,null,2));
  write(extDir,'worker.js',`const native={\n  runtime:!!chrome.runtime,runtimeConnect:typeof chrome.runtime?.connect==='function',\n  storage:!!chrome.storage,storageSession:!!chrome.storage?.session,\n  tabs:!!chrome.tabs,tabsCreate:typeof chrome.tabs?.create==='function',tabsQuery:typeof chrome.tabs?.query==='function',\n  windows:!!chrome.windows,windowsCreate:typeof chrome.windows?.create==='function',windowsGetAll:typeof chrome.windows?.getAll==='function',\n  alarms:!!chrome.alarms,alarmsCreate:typeof chrome.alarms?.create==='function',\n  notifications:!!chrome.notifications,scripting:!!chrome.scripting,scriptingExecute:typeof chrome.scripting?.executeScript==='function',\n  webRequest:!!chrome.webRequest,offscreen:!!chrome.offscreen,offscreenCreate:typeof chrome.offscreen?.createDocument==='function',\n  identity:!!chrome.identity,identityWebAuth:typeof chrome.identity?.launchWebAuthFlow==='function',\n  sidePanel:!!chrome.sidePanel,cookies:!!chrome.cookies,commands:!!chrome.commands,\n  browserGlobal:!!globalThis.browser,browserRuntime:!!globalThis.browser?.runtime,browserWindows:!!globalThis.browser?.windows,browserTabs:!!globalThis.browser?.tabs\n};\nfunction ensureRoot(name){try{if(!chrome[name])chrome[name]={};return !!chrome[name];}catch{return false;}}\nfunction ensureFn(root,name){try{if(!root)return false;if(typeof root[name]!=='function')root[name]=()=>Promise.resolve(null);return typeof root[name]==='function';}catch{return false;}}\nconst shim={rootExtensible:Object.isExtensible(chrome)};\nshim.tabsCreate=ensureFn(chrome.tabs,'create');\nshim.windowsRoot=ensureRoot('windows');shim.windowsCreate=ensureFn(chrome.windows,'create');shim.windowsGetAll=ensureFn(chrome.windows,'getAll');\nshim.notificationsRoot=ensureRoot('notifications');shim.notificationsCreate=ensureFn(chrome.notifications,'create');\nshim.identityRoot=ensureRoot('identity');shim.identityWebAuth=ensureFn(chrome.identity,'launchWebAuthFlow');shim.identityRedirect=ensureFn(chrome.identity,'getRedirectURL');\nshim.sidePanelRoot=ensureRoot('sidePanel');shim.sidePanelOpen=ensureFn(chrome.sidePanel,'open');\nshim.cookiesRoot=ensureRoot('cookies');shim.cookiesGetAll=ensureFn(chrome.cookies,'getAll');\nshim.commandsRoot=ensureRoot('commands');shim.commandsGetAll=ensureFn(chrome.commands,'getAll');\nchrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{if(msg&&msg.kind==='surface'){sendResponse({native,shim});return false;}});`);
  write(extDir,'isolated.js',`chrome.runtime.sendMessage({kind:'surface'},response=>{\n  document.documentElement.dataset.breezeWalletWorker='ok';\n  document.documentElement.dataset.breezeWalletApis=JSON.stringify(response||{});\n});`);
  write(extDir,'inpage.js',`window.ethereum={isBreezeMetaMaskProbe:true,request:async()=>({ok:true})};\ndocument.documentElement.dataset.breezeWalletMainWorld='ok';`);
  write(extDir,'popup.html','<!doctype html><html><body><div id="status">loading</div><pre id="apis"></pre><script src="popup.js"></script></body></html>');
  write(extDir,'popup.js',`chrome.runtime.sendMessage({kind:'surface'},response=>{\n  document.getElementById('apis').textContent=JSON.stringify(response||{});\n  document.getElementById('status').textContent='ready';\n});`);
  write(extDir,'sandbox.html','<!doctype html><html><body>sandbox</body></html>');

  let srv, win, popupWin;
  try {
    await app.whenReady();
    srv = await serve();
    const port = srv.address().port;
    const ses = session.fromPartition('persist:breeze-metamask-probe-' + Date.now());
    let loaded = null, loadError = null;
    try { loaded = await ses.extensions.loadExtension(extDir,{allowFileAccess:false}); }
    catch (err) { loadError = String(err && (err.stack || err.message) || err); }
    ok('MetaMask-class MV3 manifest loads in Electron', !!loaded, loadError || loaded?.id || '');
    if (!loaded) throw new Error(loadError || 'extension did not load');

    win = new BrowserWindow({show:false,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    await win.loadURL(`http://127.0.0.1:${port}/`);
    let page = null;
    for(let i=0;i<60;i++){
      page = await win.webContents.executeJavaScript(`({worker:document.documentElement.dataset.breezeWalletWorker||'',mainWorld:document.documentElement.dataset.breezeWalletMainWorld||'',provider:!!(window.ethereum&&window.ethereum.isBreezeMetaMaskProbe),apis:document.documentElement.dataset.breezeWalletApis||''})`);
      if(page.worker && page.mainWorld) break;
      await new Promise(r=>setTimeout(r,100));
    }
    ok('MetaMask-style isolated content script reaches the service worker', page?.worker==='ok', JSON.stringify(page));
    ok('MV3 content_scripts world MAIN executes in the page world', page?.mainWorld==='ok' && page?.provider===true, JSON.stringify(page));

    let report = {native:{},shim:{}};
    try { report = JSON.parse(page?.apis || '{}'); } catch {}
    console.log('NATIVE_API_MATRIX ' + JSON.stringify(report.native||{}));
    console.log('SHIM_API_MATRIX ' + JSON.stringify(report.shim||{}));
    const n=report.native||{}, s=report.shim||{};
    ok('native wallet runtime/storage floor exists', !!n.runtime && !!n.runtimeConnect && !!n.storage && !!n.storageSession);
    ok('service worker records native browser namespace shape', typeof n.browserGlobal==='boolean' && typeof n.browserRuntime==='boolean' && typeof n.browserWindows==='boolean' && typeof n.browserTabs==='boolean', JSON.stringify({browserGlobal:n.browserGlobal,browserRuntime:n.browserRuntime,browserWindows:n.browserWindows,browserTabs:n.browserTabs}));
    ok('native scripting/webRequest/offscreen floor exists', !!n.scriptingExecute && !!n.webRequest && !!n.offscreenCreate, JSON.stringify(n));
    ok('missing tab/window methods are writable bridge slots', !!s.tabsCreate && !!s.windowsRoot && !!s.windowsCreate && !!s.windowsGetAll, JSON.stringify(s));
    ok('missing notification/cookie APIs are writable bridge slots', !!s.notificationsCreate && !!s.cookiesGetAll, JSON.stringify(s));
    ok('missing identity/commands/sidePanel APIs are writable bridge slots', !!s.identityWebAuth && !!s.identityRedirect && !!s.commandsGetAll && !!s.sidePanelOpen, JSON.stringify(s));

    popupWin = new BrowserWindow({show:false,width:390,height:600,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    await popupWin.loadURL(loaded.url + 'popup.html');
    let popupState = null;
    for(let i=0;i<50;i++){
      popupState = await popupWin.webContents.executeJavaScript(`({ready:document.getElementById('status')?.textContent||'',apis:document.getElementById('apis')?.textContent||''})`);
      if(popupState?.ready==='ready') break;
      await new Promise(r=>setTimeout(r,100));
    }
    ok('MetaMask-style action popup runs in the extension origin', popupState?.ready==='ready', JSON.stringify(popupState));

    try { ses.extensions.removeExtension(loaded.id); } catch {}
    ok('MetaMask-class probe unloads cleanly', !ses.extensions.getExtension(loaded.id));
  } catch (err) {
    console.error(err);
    if (!fail) fail++;
  } finally {
    try { if(popupWin && !popupWin.isDestroyed()) popupWin.destroy(); } catch {}
    try { if(win && !win.isDestroyed()) win.destroy(); } catch {}
    try { if(srv) srv.close(); } catch {}
    try { fs.rmSync(tmp,{recursive:true,force:true}); } catch {}
  }
  console.log(`\nMetaMask-class compatibility probe: ${pass}/${pass+fail}`);
  app.exit(fail ? 1 : 0);
})();
