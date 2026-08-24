'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

let pass=0, fail=0;
function ok(name,cond,detail=''){ console.log(`${cond?'PASS':'FAIL'}  ${name}${detail?`  [${detail}]`:''}`); cond?pass++:fail++; }
function write(dir,file,body){ const full=path.join(dir,file); fs.mkdirSync(path.dirname(full),{recursive:true}); fs.writeFileSync(full,body); }
function serve(){ return new Promise(resolve=>{ const srv=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><body>sw preload target</body></html>');});srv.listen(0,'127.0.0.1',()=>resolve(srv));}); }

(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-sw-preload-'));
  const extDir=path.join(tmp,'extension'); fs.mkdirSync(extDir,{recursive:true});
  const manifest={manifest_version:3,name:'Breeze SW Preload Probe',version:'1.0.0',permissions:['storage'],host_permissions:['http://127.0.0.1/*'],background:{service_worker:'worker.js'},content_scripts:[{matches:['http://127.0.0.1/*'],js:['content.js'],run_at:'document_idle'}]};
  write(extDir,'manifest.json',JSON.stringify(manifest,null,2));
  write(extDir,'worker.js',`chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{if(msg?.kind!=='exercise')return;const diag={marker:globalThis.__breezePreloadMarker||'',bridgeExposed:globalThis.__breezePreloadBridgeExposed,bridgeVisible:globalThis.__breezePreloadBridgeVisible,sawChrome:globalThis.__breezePreloadSawChrome,patched:globalThis.__breezePreloadPatched,tabsCreate:typeof chrome.tabs?.create,windowsCreate:typeof chrome.windows?.create,cookiesGetAll:typeof chrome.cookies?.getAll};if(typeof chrome.tabs?.create!=='function'||typeof chrome.windows?.create!=='function'||typeof chrome.cookies?.getAll!=='function'){sendResponse({ok:false,error:'compatibility APIs missing',diag});return false;}Promise.all([chrome.tabs.create({url:'https://example.com/from-worker'}),chrome.windows.create({url:'chrome-extension://'+chrome.runtime.id+'/home.html'}),chrome.cookies.getAll({domain:'example.com'})]).then(([tab,win,cookies])=>sendResponse({ok:true,tab,win,cookies,shim:true,diag})).catch(err=>sendResponse({ok:false,error:String(err&&err.message||err),diag}));return true;});`);
  write(extDir,'content.js',`setTimeout(()=>chrome.runtime.sendMessage({kind:'exercise'},response=>{document.documentElement.dataset.breezeSwPreload=JSON.stringify(response||{});}),350);`);
  write(extDir,'home.html','<!doctype html><html><body>extension home</body></html>');

  let srv,win,loaded;
  try{
    await app.whenReady();
    srv=await serve(); const port=srv.address().port;
    const ses=session.fromPartition('persist:breeze-sw-preload-'+Date.now());
    ses.serviceWorkers.on('console-message',(_event,details)=>console.log('SW_CONSOLE',details.message));
    const preloadPath=path.join(__dirname,'extension-sw-preload.js');
    let preloadId='', preloadError='';
    try{ preloadId=ses.registerPreloadScript({type:'service-worker',filePath:preloadPath}); }
    catch(err){ preloadError=String(err&&err.message||err); }
    ok('Electron registers a service-worker preload script',!!preloadId,preloadError||preloadId||'');

    loaded=await ses.extensions.loadExtension(extDir,{allowFileAccess:false});
    ok('MV3 probe loads with SW preload registered',!!loaded,loaded?.id||'');

    let worker=null;
    for(let i=0;i<60&&!worker;i++){
      const running=ses.serviceWorkers.getAllRunning();
      for(const [versionId,info] of Object.entries(running)){
        if(String(info.scope||'').startsWith(loaded.url)){
          worker=ses.serviceWorkers.getWorkerFromVersionID(Number(versionId)); break;
        }
      }
      if(!worker) await new Promise(r=>setTimeout(r,100));
    }
    ok('Breeze can resolve the running extension ServiceWorkerMain',!!worker,loaded.url);
    if(!worker) throw new Error('extension service worker did not become visible');

    const calls=[];
    worker.ipc.handle('breeze:extension-compat',(_event,method,params)=>{
      calls.push({method,params});
      if(method==='tabs.create') return {id:101,url:params?.url||'',active:true};
      if(method==='windows.create') return {id:201,focused:true,tabs:[{id:102,url:params?.url||''}]};
      if(method==='cookies.getAll') return [{name:'probe',value:'ok',domain:'example.com',path:'/'}];
      throw new Error('unexpected method '+method);
    });

    win=new BrowserWindow({show:false,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    await win.loadURL(`http://127.0.0.1:${port}/`);
    let raw='';
    for(let i=0;i<80;i++){ raw=await win.webContents.executeJavaScript('document.documentElement.dataset.breezeSwPreload||""'); if(raw)break; await new Promise(r=>setTimeout(r,100)); }
    let result={}; try{result=JSON.parse(raw||'{}');}catch{}
    console.log('SW_PRELOAD_DIAG '+JSON.stringify(result.diag||{}));
    ok('service-worker preload reaches the extension worker main world',result.diag?.marker==='loaded',JSON.stringify(result.diag||{}));
    ok('service-worker preload injects missing Chrome APIs into extension worker',result.ok===true&&result.shim===true,JSON.stringify(result));
    ok('injected chrome.tabs.create reaches ServiceWorkerMain IPC',result.tab?.id===101&&calls.some(c=>c.method==='tabs.create'),JSON.stringify(calls));
    ok('injected chrome.windows.create reaches ServiceWorkerMain IPC',result.win?.id===201&&calls.some(c=>c.method==='windows.create'),JSON.stringify(calls));
    ok('injected chrome.cookies.getAll reaches ServiceWorkerMain IPC',result.cookies?.[0]?.name==='probe'&&calls.some(c=>c.method==='cookies.getAll'),JSON.stringify(calls));
    ok('only the named compatibility methods crossed IPC',calls.length===3,JSON.stringify(calls));

    try{worker.ipc.removeHandler('breeze:extension-compat');}catch{}
    try{ses.unregisterPreloadScript(preloadId);}catch{}
    try{ses.extensions.removeExtension(loaded.id);}catch{}
  }catch(err){ console.error(err); fail++; }
  finally{
    try{if(win&&!win.isDestroyed())win.destroy();}catch{}
    try{if(srv)srv.close();}catch{}
    try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}
  }
  console.log(`\nBreeze service-worker preload bridge: ${pass}/${pass+fail}`);
  app.exit(fail?1:0);
})();
