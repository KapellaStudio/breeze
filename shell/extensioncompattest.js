'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const compat = require('./extension-compat');

let pass=0, fail=0;
function ok(name,cond,detail=''){ console.log(`${cond?'PASS':'FAIL'}  ${name}${detail?`  [${detail}]`:''}`); cond?pass++:fail++; }
function write(dir,file,body){ const full=path.join(dir,file); fs.mkdirSync(path.dirname(full),{recursive:true}); fs.writeFileSync(full,body); }
function serve(){ return new Promise(resolve=>{ const srv=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><body>compat target</body></html>');});srv.listen(0,'127.0.0.1',()=>resolve(srv));}); }

(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-extension-compat-'));
  const source=path.join(tmp,'source');
  const root=path.join(tmp,'managed');
  const localId='wallet-probe';
  const managed=path.join(root,localId);
  fs.mkdirSync(source,{recursive:true});
  const manifest={
    manifest_version:3,name:'Breeze Managed Compat Probe',version:'1.0.0',
    permissions:['storage','tabs','cookies','identity'],host_permissions:['http://127.0.0.1/*'],
    background:{service_worker:'worker.js',type:'module'},
    content_scripts:[{matches:['http://127.0.0.1/*'],js:['content.js'],run_at:'document_idle'}]
  };
  const identityChunk=`const chromeRedirect=chrome.identity.getRedirectURL('module-early');\nconst browserPresent=!!globalThis.browser;\nconst browserRedirect=browserPresent?globalThis.browser?.identity?.getRedirectURL?.('browser-early')||'':'';\nif(!chromeRedirect)throw new Error('early chrome identity redirect missing');\nif(browserPresent&&!browserRedirect)throw new Error('early browser identity redirect missing');\nchrome.windows.onRemoved.addListener(id=>chrome.storage.local.set({earlyChromeRemoved:id}));\nconst earlyBrowserWindows=globalThis.browser?.windows;\nif(earlyBrowserWindows?.onRemoved)earlyBrowserWindows.onRemoved.addListener(id=>chrome.storage.local.set({earlyBrowserRemoved:id}));\nglobalThis.__breezeEarlyIdentity={chromeRedirect,browserPresent,browserRedirect};`;
  const originalWorker=`import './identity-chunk.js';\nconst removed={chrome:[],browser:[]};\nchrome.windows.onRemoved.addListener(id=>removed.chrome.push(id));\nconst browserWindows=globalThis.browser?.windows;\nif(browserWindows?.onRemoved)browserWindows.onRemoved.addListener(id=>removed.browser.push(id));\nchrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{\n  if(msg?.kind==='events'){sendResponse({removed,browserPresent:!!browserWindows,diag:{marker:globalThis.__breezePreloadMarker||'',dispatch:typeof globalThis.__breezeDispatchExtensionEvent,registry:globalThis.__breezeExtensionEventRegistry?.size||0,chromeShared:chrome.windows.onRemoved===globalThis.__breezeExtensionEventRegistry?.get('windows.onRemoved')?.api,browserShared:browserWindows?.onRemoved===chrome.windows.onRemoved}});return false;}\n  if(msg?.kind!=='exercise')return;\n  Promise.all([\n    chrome.tabs.create({url:'https://example.com/from-compat'}),\n    chrome.windows.create({url:'https://example.org/wallet'}),\n    chrome.cookies.getAll({domain:'example.com'})\n  ]).then(([tab,win,cookies])=>sendResponse({ok:true,tab,win,cookies,earlyIdentity:globalThis.__breezeEarlyIdentity||{}})).catch(err=>sendResponse({ok:false,error:String(err&&err.message||err)}));\n  return true;\n});`;
  write(source,'manifest.json',JSON.stringify(manifest,null,2));
  write(source,'identity-chunk.js',identityChunk);
  write(source,'worker.js',originalWorker);
  write(source,'content.js',`setTimeout(()=>chrome.runtime.sendMessage({kind:'exercise'},response=>{document.documentElement.dataset.breezeCompat=JSON.stringify(response||{});}),200);\ndocument.addEventListener('breeze:read-window-events',()=>chrome.runtime.sendMessage({kind:'events'},response=>{document.documentElement.dataset.breezeWindowEvents=JSON.stringify(response||{});}));`);
  fs.appendFileSync(path.join(source,'content.js'),`\ndocument.addEventListener('breeze:read-early-window-events',()=>chrome.storage.local.get(['earlyChromeRemoved','earlyBrowserRemoved'],value=>{document.documentElement.dataset.breezeEarlyWindowEvents=JSON.stringify(value||{});}));`);
  fs.cpSync(source,managed,{recursive:true});

  const calls=[];
  compat.init({rootDir:root,handlers:{
    'tabs.create':async(ctx,params)=>{calls.push({method:'tabs.create',ctx,params});return{id:301,url:params.url,active:true};},
    'windows.create':async(ctx,params)=>{calls.push({method:'windows.create',ctx,params});return{id:401,focused:true,tabs:[{id:302,url:params.url}]};},
    'cookies.getAll':async(ctx,params)=>{calls.push({method:'cookies.getAll',ctx,params});return[{name:'probe',value:'ok',domain:params.domain,path:'/'}];}
  }});

  let srv,win,loaded,ses=null;
  try{
    const sourceWorkerBefore=fs.readFileSync(path.join(source,'worker.js'),'utf8');
    const sourceManifestBefore=fs.readFileSync(path.join(source,'manifest.json'),'utf8');
    const sourceIdentityBefore=fs.readFileSync(path.join(source,'identity-chunk.js'),'utf8');
    const prepared=await compat.prepareManagedCopy({localId,managedDir:managed});
    ok('managed MV3 copy is prepared for compatibility',prepared.prepared===true,JSON.stringify(prepared));
    ok('compatibility surface contains tabs, windows, cookies and identity',prepared.methods.includes('tabs.create')&&prepared.methods.includes('windows.create')&&prepared.methods.includes('cookies.getAll')&&prepared.methods.includes('identity.launchWebAuthFlow'),JSON.stringify(prepared.methods));
    ok('module graph receives one targeted early identity patch',prepared.earlyIdentityModules===1,JSON.stringify(prepared));
    ok('module graph receives one targeted pre-import window-event patch',prepared.earlyWindowEventModules===1,JSON.stringify(prepared));
    ok('user source worker remains untouched',fs.readFileSync(path.join(source,'worker.js'),'utf8')===sourceWorkerBefore);
    ok('user source manifest remains untouched',fs.readFileSync(path.join(source,'manifest.json'),'utf8')===sourceManifestBefore);
    ok('user source imported module remains untouched',fs.readFileSync(path.join(source,'identity-chunk.js'),'utf8')===sourceIdentityBefore);

    const managedWorker=fs.readFileSync(path.join(managed,'worker.js'),'utf8');
    const managedIdentity=fs.readFileSync(path.join(managed,'identity-chunk.js'),'utf8');
    const managedManifest=JSON.parse(fs.readFileSync(path.join(managed,'manifest.json'),'utf8'));
    ok('managed worker receives one Breeze bootstrap',managedWorker.split(compat.PATCH_MARKER).length===2);
    ok('identity-using imported module receives early deterministic shim',managedIdentity.split(compat.EARLY_IDENTITY_MARKER).length===2);
    ok('window-listening imported module receives the pre-import event shim',managedIdentity.split(compat.EARLY_WINDOW_EVENT_MARKER).length===2);
    ok('managed manifest carries loopback host permission',managedManifest.host_permissions.includes(compat.LOOPBACK_PERMISSION));
    const backupWorker=path.join(root,'.compat-originals',localId,'worker.js');
    ok('pristine worker backup lives outside loadable extension tree',fs.existsSync(backupWorker)&&fs.readFileSync(backupWorker,'utf8')===originalWorker&&!backupWorker.startsWith(managed+path.sep));

    const again=await compat.prepareManagedCopy({localId,managedDir:managed});
    ok('re-preparing in one process does not stack bootstraps or early patches',again.prepared===true&&fs.readFileSync(path.join(managed,'worker.js'),'utf8').split(compat.PATCH_MARKER).length===2&&fs.readFileSync(path.join(managed,'identity-chunk.js'),'utf8').split(compat.EARLY_IDENTITY_MARKER).length===2&&fs.readFileSync(path.join(managed,'identity-chunk.js'),'utf8').split(compat.EARLY_WINDOW_EVENT_MARKER).length===2);
    const privateRegistration=compat.registerRuntime(localId,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',{private:true,workspaceId:'private'});
    ok('Private Browsing runtime registration fails closed',privateRegistration.registered===false&&/Private Browsing/.test(privateRegistration.reason));

    await app.whenReady();
    srv=await serve(); const port=srv.address().port;
    ses=session.fromPartition('persist:breeze-managed-compat-'+Date.now());
    loaded=await ses.extensions.loadExtension(managed,{allowFileAccess:false});
    ok('patched managed MV3 module extension loads in Electron',!!loaded,loaded?.id||'');
    const registered=compat.registerRuntime(localId,loaded.id,{ses,workspaceId:'default',sealed:false,private:false});
    ok('loaded runtime is registered without exposing bridge secret',registered.registered===true&&!('token' in registered),JSON.stringify(registered));

    win=new BrowserWindow({show:false,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    await win.loadURL(`http://127.0.0.1:${port}/`);
    let raw='';
    for(let i=0;i<80;i++){raw=await win.webContents.executeJavaScript('document.documentElement.dataset.breezeCompat||""');if(raw)break;await new Promise(r=>setTimeout(r,100));}
    let result={};try{result=JSON.parse(raw||'{}');}catch{}
    ok('patched MV3 module worker reaches Breeze compatibility bridge',result.ok===true,JSON.stringify(result));
    ok('identity exists before static imported module evaluation',String(result.earlyIdentity?.chromeRedirect||'').includes('.chromiumapp.org/module-early'),JSON.stringify(result.earlyIdentity||{}));
    ok('native browser namespace receives early identity when present',result.earlyIdentity?.browserPresent!==true||String(result.earlyIdentity?.browserRedirect||'').includes('.chromiumapp.org/browser-early'),JSON.stringify(result.earlyIdentity||{}));
    ok('tabs.create resolves through narrow host handler',result.tab?.id===301&&calls.some(x=>x.method==='tabs.create'),JSON.stringify(result.tab));
    ok('windows.create resolves through narrow host handler',result.win?.id===401&&calls.some(x=>x.method==='windows.create'),JSON.stringify(result.win));
    ok('cookies.getAll resolves against registered session context',result.cookies?.[0]?.name==='probe'&&calls.some(x=>x.method==='cookies.getAll'&&x.ctx.ses===ses),JSON.stringify(result.cookies));
    const expectedCalls=new Set(['tabs.create','windows.create','cookies.getAll']);
    ok('only expected compatibility calls crossed bridge',calls.every(x=>expectedCalls.has(x.method)),JSON.stringify(calls.map(x=>x.method)));

    const delivered=compat.emitEvent(localId,loaded.id,ses,'windows.onRemoved',[401]);
    ok('host queues window removal for the registered extension runtime',delivered===1,String(delivered));
    let eventResult={};
    for(let i=0;i<30;i++){
      await win.webContents.executeJavaScript(`delete document.documentElement.dataset.breezeWindowEvents;document.dispatchEvent(new Event('breeze:read-window-events'))`);
      await new Promise(r=>setTimeout(r,100));
      const eventRaw=await win.webContents.executeJavaScript('document.documentElement.dataset.breezeWindowEvents||""');
      try{eventResult=JSON.parse(eventRaw||'{}');}catch{}
      if(eventResult.removed?.chrome?.includes(401)&&(eventResult.browserPresent!==true||eventResult.removed?.browser?.includes(401)))break;
    }
    ok('host windows.onRemoved reaches chrome and browser listeners registered by the managed worker',eventResult.removed?.chrome?.includes(401)&&(eventResult.browserPresent!==true||eventResult.removed?.browser?.includes(401)),JSON.stringify(eventResult));
    let earlyEventResult={};
    for(let i=0;i<20;i++){
      await win.webContents.executeJavaScript(`delete document.documentElement.dataset.breezeEarlyWindowEvents;document.dispatchEvent(new Event('breeze:read-early-window-events'))`);
      await new Promise(r=>setTimeout(r,100));
      const earlyRaw=await win.webContents.executeJavaScript('document.documentElement.dataset.breezeEarlyWindowEvents||""');
      try{earlyEventResult=JSON.parse(earlyRaw||'{}');}catch{}
      if(earlyEventResult.earlyChromeRemoved===401&&(eventResult.browserPresent!==true||earlyEventResult.earlyBrowserRemoved===401))break;
    }
    ok('host windows.onRemoved reaches listeners registered by a static imported module before worker body evaluation',earlyEventResult.earlyChromeRemoved===401&&(eventResult.browserPresent!==true||earlyEventResult.earlyBrowserRemoved===401),JSON.stringify(earlyEventResult));
    const publicStatus=compat.status(localId);
    ok('public event diagnostics confirm one authenticated host delivery',publicStatus.eventBridge?.requests>=1&&publicStatus.eventBridge?.hostEvents===1&&publicStatus.eventBridge?.delivered===1&&publicStatus.eventBridge?.lastEvent==='windows.onRemoved',JSON.stringify(publicStatus.eventBridge||{}));
    ok('public compatibility status contains no bearer token or endpoint',publicStatus.prepared===true&&!('token' in publicStatus)&&!('endpoint' in publicStatus),JSON.stringify(publicStatus));

    try{ses.extensions.removeExtension(loaded.id);}catch{}
  }catch(err){console.error(err);fail++;}
  finally{
    try{if(win&&!win.isDestroyed())win.destroy();}catch{}
    try{if(srv)srv.close();}catch{}
    try{await compat.close();}catch{}
    try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}
  }
  console.log(`\nManaged extension compatibility: ${pass}/${pass+fail}`);
  app.exit(fail?1:0);
})();
