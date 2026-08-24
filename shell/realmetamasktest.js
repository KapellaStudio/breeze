'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const runtime = require('./extensions-runtime');

let pass=0, fail=0;
function ok(name,cond,detail=''){ console.log(`${cond?'PASS':'FAIL'}  ${name}${detail?`  [${detail}]`:''}`); cond?pass++:fail++; }
function serve(){return new Promise(resolve=>{const srv=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end('<!doctype html><html><head><title>Breeze MetaMask dapp</title></head><body><button id="connect">Connect</button></body></html>');});srv.listen(0,'127.0.0.1',()=>resolve(srv));});}

(async()=>{
  const source=path.resolve(String(process.env.METAMASK_EXTENSION_DIR||''));
  if(!source||!fs.existsSync(path.join(source,'manifest.json'))){console.error('METAMASK_EXTENSION_DIR must point to a built MetaMask Chromium extension');process.exit(2);}
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-real-metamask-'));
  const userData=path.join(tmp,'user-data');
  let srv=null, win=null, popup=null, surface=null, ses=null, installed=null;
  try{
    ok('official MetaMask build is Manifest V3',Number(manifest.manifest_version)===3,String(manifest.manifest_version));
    ok('official MetaMask build declares an action popup',!!manifest.action?.default_popup,String(manifest.action?.default_popup||''));
    ok('official MetaMask build declares a service worker',!!manifest.background?.service_worker,String(manifest.background?.service_worker||''));

    await app.whenReady();
    runtime.setInternalInvoker(async(channel,...args)=>{
      if(channel==='tab:create') return 901;
      if(channel==='tab:list') return [{id:901,url:'https://example.com/',title:'MetaMask-created tab',active:true,private:false,sleeping:false,loading:false,workspace:'default'}];
      if(channel==='tab:navigate'||channel==='tab:select'||channel==='tab:close') return true;
      throw new Error('unexpected internal channel '+channel);
    });
    runtime.init(userData);
    installed=runtime.importDirectory(source);
    ok('Breeze imports the official MetaMask build',installed?.installed===true,JSON.stringify(installed?.extension||installed));
    if(!installed?.installed) throw new Error('MetaMask import failed');
    const localId=installed.extension.localId;

    ses=session.fromPartition('persist:breeze-real-metamask-'+Date.now());
    const loadedRows=await runtime.loadIntoSession(ses,'default');
    const loaded=loadedRows.find(x=>x.localId===localId);
    ok('Breeze loads the official MetaMask build',loaded?.ok===true&&!!loaded.runtimeId,JSON.stringify(loaded||{}));
    if(!loaded?.ok) throw new Error(loaded?.error||'MetaMask runtime failed to load');
    const ext=ses.extensions.getExtension(loaded.runtimeId);
    ok('MetaMask is present in Electron session registry',!!ext,ext?.id||'');

    srv=await serve(); const port=srv.address().port;
    win=new BrowserWindow({show:false,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    await win.loadURL(`http://127.0.0.1:${port}/`);
    let provider={};
    for(let i=0;i<120;i++){
      provider=await win.webContents.executeJavaScript(`({present:!!window.ethereum,isMetaMask:!!window.ethereum?.isMetaMask,providers:Array.isArray(window.ethereum?.providers)?window.ethereum.providers.length:0})`).catch(()=>({}));
      if(provider.present) break;
      await new Promise(r=>setTimeout(r,250));
    }
    ok('official MetaMask injects a provider into a real web page',provider.present===true,JSON.stringify(provider));
    ok('injected provider identifies as MetaMask',provider.isMetaMask===true,JSON.stringify(provider));

    let chain='';
    if(provider.present){
      chain=await Promise.race([
        win.webContents.executeJavaScript(`window.ethereum.request({method:'eth_chainId'}).then(String).catch(e=>'ERR:'+String(e&&e.message||e))`),
        new Promise(resolve=>setTimeout(()=>resolve('TIMEOUT'),10000))
      ]).catch(e=>'ERR:'+String(e));
    }
    ok('MetaMask provider can message its background runtime',typeof chain==='string'&&chain!=='TIMEOUT'&&!chain.startsWith('ERR:'),String(chain));

    // Exercise the same production action path Breeze exposes to the browser UI.
    // On a fresh profile MetaMask intentionally uses popup-init.html as a launch
    // trampoline. It may replace itself with popup.html OR close that small popup
    // and create home.html for onboarding. Follow either production lifecycle.
    const action=await runtime.openAction(localId,{workspaceId:'default',sealed:false});
    ok('Breeze opens the official MetaMask action through production runtime',action?.ok===true&&Number.isInteger(action?.windowId),JSON.stringify(action||{}));
    if(action?.ok&&Number.isInteger(action.windowId)) popup=BrowserWindow.fromId(action.windowId);
    if(!popup) throw new Error(action?.error||'MetaMask action window was not created');

    const extOrigin=`chrome-extension://${loaded.runtimeId}/`;
    let surfaceState={};
    for(let i=0;i<160;i++){
      if(popup&&!popup.isDestroyed()) surface=popup;
      const replacement=BrowserWindow.getAllWindows().find(w=>{
        if(!w||w.isDestroyed()||w===win) return false;
        const url=String(w.webContents.getURL()||'');
        return url.startsWith(extOrigin)&&(url.includes('/popup.html')||url.includes('/home.html'));
      });
      if(replacement) surface=replacement;

      if(surface&&!surface.isDestroyed()){
        surfaceState=await surface.webContents.executeJavaScript(`({ready:document.readyState,body:(document.body?.innerText||'').trim().slice(0,800),title:document.title||'',href:location.href})`).catch(()=>({href:surface.webContents.getURL()}));
        const href=String(surfaceState.href||'');
        if(surfaceState.ready==='complete'&&surfaceState.body&&(href.includes('/popup.html')||href.includes('/home.html'))) break;
      }
      await new Promise(r=>setTimeout(r,250));
    }
    const finalHref=String(surfaceState.href||(surface&&!surface.isDestroyed()?surface.webContents.getURL():''));
    const reachedUi=finalHref.includes('/popup.html')||finalHref.includes('/home.html');
    ok('MetaMask popup-init reaches its real UI or first-run onboarding',reachedUi,JSON.stringify(surfaceState));
    ok('official MetaMask UI renders in Breeze',surfaceState.ready==='complete'&&!!surfaceState.body,JSON.stringify(surfaceState));
    ok('fresh-install MetaMask lifecycle is handled',finalHref.includes('/home.html')||finalHref.includes('/popup.html'),finalHref);

    const compat=runtime.list().find(x=>x.localId===localId)?.compatibilityBridge;
    ok('MetaMask uses the managed Breeze compatibility bridge',compat?.prepared===true&&compat?.runtimeCount===1,JSON.stringify(compat||{}));

    await runtime.remove(localId,[{ses,workspaceId:'default'}]);
  }catch(err){console.error(err);fail++;}
  finally{
    try{if(surface&&surface!==popup&&!surface.isDestroyed())surface.destroy();}catch{}
    try{if(popup&&!popup.isDestroyed())popup.destroy();}catch{}
    try{if(win&&!win.isDestroyed())win.destroy();}catch{}
    try{if(srv)srv.close();}catch{}
    try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}
  }
  console.log(`\nOfficial MetaMask in Breeze: ${pass}/${pass+fail}`);
  app.exit(fail?1:0);
})();
