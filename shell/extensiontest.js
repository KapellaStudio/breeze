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
    content_scripts:[{matches:['http://127.0.0.1/*'],js:['content.js'],run_at:'document_idle'}]
  };
  write(extDir,'manifest.json',JSON.stringify(manifest,null,2));
  write(extDir,'worker.js',`chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{\n  if(msg && msg.kind==='breeze-ping'){\n    chrome.storage.local.set({breezeProbe:'ok'},()=>sendResponse({ok:true,from:'mv3-worker'}));\n    return true;\n  }\n});`);
  write(extDir,'content.js',`chrome.runtime.sendMessage({kind:'breeze-ping'}, response => {\n  document.documentElement.dataset.breezeMv3 = response && response.from || 'no-response';\n});`);

  let srv, win;
  try {
    await app.whenReady();
    srv = await serve();
    const port = srv.address().port;
    const ses = session.fromPartition('persist:breeze-extension-probe-' + Date.now());
    let loaded = null, loadError = null;
    try { loaded = await ses.extensions.loadExtension(extDir, {allowFileAccess:false}); }
    catch (err) { loadError = String(err && (err.stack || err.message) || err); }
    ok('Electron accepts an unpacked MV3 service-worker extension', !!loaded, loadError || loaded?.id || '');
    if (loaded) {
      ok('loaded extension keeps its MV3 manifest', loaded.manifest?.manifest_version === 3);
      ok('loaded extension is visible in the session registry', ses.extensions.getAllExtensions().some(x=>x.id===loaded.id));
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
      try { ses.extensions.removeExtension(loaded.id); } catch {}
      ok('extension unload removes it from the session', !ses.extensions.getExtension(loaded.id));
    }
  } catch (err) {
    console.error(err);
    fail++;
  } finally {
    try { if (win && !win.isDestroyed()) win.destroy(); } catch {}
    try { if (srv) srv.close(); } catch {}
    try { fs.rmSync(tmp,{recursive:true,force:true}); } catch {}
  }
  console.log(`\nMV3 extension runtime: ${pass}/${pass+fail}`);
  app.exit(fail ? 1 : 0);
})();
