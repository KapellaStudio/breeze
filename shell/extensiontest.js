'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const extensions = require('./extensions');

let pass = 0, fail = 0;
function ok(name, cond, detail='') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  cond ? pass++ : fail++;
}
function write(dir, file, body){ fs.writeFileSync(path.join(dir,file), body); }
function serve(){
  return new Promise(resolve => {
    const srv = http.createServer((_req,res) => {
      res.writeHead(200, {'content-type':'text/html'});
      res.end('<!doctype html><html><body><h1 id="ready">Breeze extension target</h1></body></html>');
    });
    srv.listen(0,'127.0.0.1',()=>resolve(srv));
  });
}

(async()=>{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'breeze-ext-mv3-'));
  const extDir = path.join(tmp,'mv3'); fs.mkdirSync(extDir,{recursive:true});
  const manifest = {
    manifest_version:3,
    name:'Breeze MV3 Compatibility Probe',
    version:'1.0.0',
    permissions:['storage'],
    host_permissions:['http://127.0.0.1/*'],
    background:{service_worker:'worker.js'},
    action:{default_title:'Breeze Probe',default_popup:'popup.html'},
    content_scripts:[{matches:['http://127.0.0.1/*'],js:['content.js'],run_at:'document_idle'}]
  };
  write(extDir,'manifest.json',JSON.stringify(manifest,null,2));
  write(extDir,'worker.js',`chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{\n  if(msg && msg.kind==='breeze-ping'){\n    chrome.storage.local.set({breezeProbe:'ok'},()=>sendResponse({ok:true,from:'mv3-worker'}));\n    return true;\n  }\n});`);
  write(extDir,'content.js',`chrome.runtime.sendMessage({kind:'breeze-ping'}, response => {\n  document.documentElement.dataset.breezeMv3 = response && response.from || 'no-response';\n});`);
  write(extDir,'popup.html','<!doctype html><html><body><div id="status">loading</div><script src="popup.js"></script></body></html>');
  write(extDir,'popup.js',`chrome.runtime.sendMessage({kind:'breeze-ping'}, response => {\n  chrome.storage.local.get('breezeProbe', stored => {\n    document.documentElement.dataset.runtime = chrome.runtime.id ? 'yes' : 'no';\n    document.documentElement.dataset.worker = response && response.from || 'no-response';\n    document.documentElement.dataset.storage = stored && stored.breezeProbe || 'missing';\n    document.getElementById('status').textContent = 'ready';\n  });\n});`);

  let srv, win, popupWin;
  try {
    await app.whenReady();
    srv = await serve();
    const port = srv.address().port;
    const ses = session.fromPartition('persist:breeze-extension-probe-' + Date.now());

    extensions.init(path.join(tmp,'breeze-user'));
    const imported = extensions.importDirectory(extDir);
    ok('Breeze admits an MV3 service-worker extension', imported.installed === true, imported.error || imported.compatibility || '');
    ok('Breeze labels MV3 runtime as partial rather than falsely complete', imported.extension?.compatibility === 'partial');
    ok('Breeze records the MV3 background runtime kind', imported.extension?.backgroundKind === 'mv3-service-worker');

    const loads = await extensions.loadIntoSession(ses,'default');
    const runtime = loads.find(x=>x.localId===imported.extension?.localId);
    ok('Breeze loads the managed MV3 extension into a persistent session', runtime?.ok === true, runtime?.error || runtime?.runtimeId || '');
    const loaded = runtime?.runtimeId ? ses.extensions.getExtension(runtime.runtimeId) : null;
    ok('managed extension is visible in Electron session registry', !!loaded && loaded.manifest?.manifest_version === 3);

    if (loaded) {
      win = new BrowserWindow({show:false,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true}});
      await win.loadURL(`http://127.0.0.1:${port}/`);
      let marker = '';
      for (let i=0;i<30;i++) {
        marker = await win.webContents.executeJavaScript('document.documentElement.dataset.breezeMv3 || ""');
        if (marker) break;
        await new Promise(r=>setTimeout(r,100));
      }
      ok('MV3 content script runs on a real web page', !!marker, marker || 'no marker');
      ok('MV3 service worker answers runtime messaging', marker === 'mv3-worker', marker || 'no response');

      const popupPath = loaded.url + manifest.action.default_popup;
      popupWin = new BrowserWindow({show:false,width:360,height:520,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true}});
      await popupWin.loadURL(popupPath);
      let popupState = null;
      for (let i=0;i<30;i++) {
        popupState = await popupWin.webContents.executeJavaScript('({ready:document.getElementById("status")?.textContent,runtime:document.documentElement.dataset.runtime||"",worker:document.documentElement.dataset.worker||"",storage:document.documentElement.dataset.storage||""})');
        if (popupState?.ready === 'ready') break;
        await new Promise(r=>setTimeout(r,100));
      }
      ok('extension action popup page renders from chrome-extension://', popupState?.ready === 'ready', JSON.stringify(popupState));
      ok('popup has chrome.runtime access', popupState?.runtime === 'yes', JSON.stringify(popupState));
      ok('popup can message the MV3 service worker', popupState?.worker === 'mv3-worker', JSON.stringify(popupState));
      ok('popup shares extension storage state', popupState?.storage === 'ok', JSON.stringify(popupState));

      const removed = await extensions.remove(imported.extension.localId,[{ses,workspaceId:'default'}]);
      ok('Breeze unload/remove path succeeds for MV3', removed?.ok === true);
      ok('extension unload removes it from the session', !ses.extensions.getExtension(loaded.id));
    }
  } catch (err) {
    console.error(err);
    fail++;
  } finally {
    try { if (popupWin && !popupWin.isDestroyed()) popupWin.destroy(); } catch {}
    try { if (win && !win.isDestroyed()) win.destroy(); } catch {}
    try { if (srv) srv.close(); } catch {}
    try { fs.rmSync(tmp,{recursive:true,force:true}); } catch {}
  }
  console.log(`\nBreeze MV3 extension path: ${pass}/${pass+fail}`);
  app.exit(fail ? 1 : 0);
})();
