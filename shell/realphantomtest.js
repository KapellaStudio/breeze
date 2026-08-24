'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const runtime = require('./extensions-runtime');

let pass=0, fail=0;
function ok(name,cond,detail=''){console.log(`${cond?'PASS':'FAIL'}  ${name}${detail?`  [${detail}]`:''}`);cond?pass++:fail++;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function serve(){return new Promise(resolve=>{const srv=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end('<!doctype html><html><head><title>Breeze Phantom dapp</title></head><body><h1>Breeze Phantom dapp</h1></body></html>');});srv.listen(0,'127.0.0.1',()=>resolve(srv));});}

(async()=>{
  const source=path.resolve(String(process.env.PHANTOM_EXTENSION_DIR||''));
  if(!source||!fs.existsSync(path.join(source,'manifest.json'))){console.error('PHANTOM_EXTENSION_DIR must point to an unpacked official Phantom Chromium extension');process.exit(2);}
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-real-phantom-'));
  const userData=path.join(tmp,'user-data');
  let srv=null, win=null, popup=null, ses=null;
  try{
    ok('official Phantom package has a supported manifest version',[2,3].includes(Number(manifest.manifest_version)),String(manifest.manifest_version));
    ok('official Phantom package has an extension name',typeof manifest.name==='string'&&!!manifest.name,String(manifest.name||''));

    await app.whenReady();
    runtime.setInternalInvoker(async(channel)=>{
      if(channel==='tab:create') return 902;
      if(channel==='tab:list') return [{id:902,url:'https://example.com/',title:'Phantom-created tab',active:true,private:false,sleeping:false,loading:false,workspace:'default'}];
      if(channel==='tab:navigate'||channel==='tab:select'||channel==='tab:close') return true;
      throw new Error('unexpected internal channel '+channel);
    });
    runtime.init(userData);
    const installed=runtime.importDirectory(source);
    ok('Breeze imports the official Phantom package',installed?.installed===true,JSON.stringify(installed?.extension||installed));
    if(!installed?.installed)throw new Error('Phantom import failed');
    const localId=installed.extension.localId;

    ses=session.fromPartition('persist:breeze-real-phantom-'+Date.now());
    const loadedRows=await runtime.loadIntoSession(ses,'default');
    const loaded=loadedRows.find(x=>x.localId===localId);
    ok('Breeze loads official Phantom into Chromium',loaded?.ok===true&&!!loaded.runtimeId,JSON.stringify(loaded||{}));
    if(!loaded?.ok)throw new Error(loaded?.error||'Phantom runtime failed to load');
    const ext=ses.extensions.getExtension(loaded.runtimeId);
    ok('Phantom is present in Electron session registry',!!ext,ext?.id||'');

    srv=await serve();const port=srv.address().port;
    win=new BrowserWindow({show:false,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    await win.loadURL(`http://127.0.0.1:${port}/`);
    let provider={};
    for(let i=0;i<160;i++){
      provider=await win.webContents.executeJavaScript(`({root:!!window.phantom,solana:!!window.phantom?.solana||!!window.solana,isPhantom:!!window.phantom?.solana?.isPhantom||!!window.solana?.isPhantom,ethereum:!!window.phantom?.ethereum||!!window.ethereum?.isPhantom,ethereumIsPhantom:!!window.phantom?.ethereum?.isPhantom||!!window.ethereum?.isPhantom})`).catch(()=>({}));
      if(provider.root||provider.solana||provider.isPhantom||provider.ethereum)break;
      await sleep(250);
    }
    ok('official Phantom injects a provider into a real Breeze web page',provider.root||provider.solana||provider.ethereum,JSON.stringify(provider));
    ok('injected Solana provider identifies as Phantom',provider.isPhantom===true,JSON.stringify(provider));

    if(installed.extension.hasActionPopup){
      const action=await runtime.openAction(localId,{workspaceId:'default',sealed:false});
      ok('Breeze opens the official Phantom action through production runtime',action?.ok===true&&Number.isInteger(action?.windowId),JSON.stringify(action||{}));
      if(action?.ok&&Number.isInteger(action.windowId))popup=BrowserWindow.fromId(action.windowId);
      if(popup){
        let ui={};
        for(let i=0;i<160;i++){
          if(popup.isDestroyed())break;
          ui=await popup.webContents.executeJavaScript(`({ready:document.readyState,body:(document.body?.innerText||'').trim().slice(0,800),title:document.title||'',href:location.href})`).catch(()=>({}));
          if(ui.ready==='complete'&&ui.body)break;
          await sleep(250);
        }
        ok('official Phantom extension UI renders in Breeze',ui.ready==='complete'&&!!ui.body,JSON.stringify(ui));
      }
    }

    const compat=runtime.list().find(x=>x.localId===localId)?.compatibilityBridge;
    ok('Phantom is evaluated through the managed Breeze compatibility layer',compat?.prepared===true,JSON.stringify(compat||{}));
    await runtime.remove(localId,[{ses,workspaceId:'default'}]);
  }catch(err){console.error(err);fail++;}
  finally{
    try{if(popup&&!popup.isDestroyed())popup.destroy();}catch{}
    try{if(win&&!win.isDestroyed())win.destroy();}catch{}
    try{if(srv)srv.close();}catch{}
    try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}
  }
  console.log(`\nOfficial Phantom in Breeze: ${pass}/${pass+fail}`);
  app.exit(fail?1:0);
})();
