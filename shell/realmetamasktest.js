'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const runtime = require('./extensions-runtime');

const TEST_SRP = 'spread raise short crane omit tent fringe mandate neglect detail suspect cradle';
const TEST_PASSWORD = 'Breeze-Test-Only-123!';
const TEST_MESSAGE_HEX = '0x427265657a65204d6574614d61736b20636f6d7061746962696c6974792074657374';

let pass=0, fail=0;
function ok(name,cond,detail=''){ console.log(`${cond?'PASS':'FAIL'}  ${name}${detail?`  [${detail}]`:''}`); cond?pass++:fail++; }
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,{timeout=30000,interval=200,label='condition'}={}){
  const until=Date.now()+timeout; let last;
  while(Date.now()<until){
    try{last=await fn(); if(last)return last;}catch(e){last=e;}
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${label}${last instanceof Error?`: ${last.message}`:''}`);
}
async function selectorState(win,selector){
  if(!win||win.isDestroyed())return null;
  return win.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e?{found:true,disabled:!!e.disabled,text:(e.innerText||e.textContent||'').trim(),href:location.href}:null})()`).catch(()=>null);
}
async function waitSelector(win,selector,timeout=30000){
  return waitFor(()=>selectorState(win,selector),{timeout,label:selector});
}
async function clickSelector(win,selector){
  await waitSelector(win,selector);
  return win.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('missing selector');e.click();return true})()`);
}
async function fillSelector(win,selector,value){
  await waitSelector(win,selector);
  return win.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('missing selector');const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const s=Object.getOwnPropertyDescriptor(p,'value')?.set;if(s)s.call(e,${JSON.stringify(value)});else e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return e.value})()`);
}
async function pasteSelector(win,selector,value){
  await waitSelector(win,selector);
  return win.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('missing selector');e.focus();const ev=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(ev,'clipboardData',{value:{getData:(type)=>type==='text'||type==='text/plain'?${JSON.stringify(value)}:''}});return e.dispatchEvent(ev)})()`);
}
async function findExtensionWindow(extOrigin,selector,exclude=new Set(),timeout=30000){
  return waitFor(async()=>{
    for(const w of BrowserWindow.getAllWindows()){
      if(!w||w.isDestroyed()||exclude.has(w.id))continue;
      const url=String(w.webContents.getURL()||'');
      if(!url.startsWith(extOrigin))continue;
      const state=await selectorState(w,selector);
      if(state?.found)return w;
    }
    return null;
  },{timeout,label:`extension window ${selector}`});
}
function serve(){return new Promise(resolve=>{const srv=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end('<!doctype html><html><head><title>Breeze MetaMask dapp</title></head><body><h1>Breeze MetaMask dapp</h1><button id="connect">Connect</button></body></html>');});srv.listen(0,'127.0.0.1',()=>resolve(srv));});}

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
      await sleep(250);
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
      await sleep(250);
    }
    const finalHref=String(surfaceState.href||(surface&&!surface.isDestroyed()?surface.webContents.getURL():''));
    const reachedUi=finalHref.includes('/popup.html')||finalHref.includes('/home.html');
    ok('MetaMask popup-init reaches its real UI or first-run onboarding',reachedUi,JSON.stringify(surfaceState));
    ok('official MetaMask UI renders in Breeze',surfaceState.ready==='complete'&&!!surfaceState.body,JSON.stringify(surfaceState));
    ok('fresh-install MetaMask lifecycle is handled',finalHref.includes('/home.html')||finalHref.includes('/popup.html'),finalHref);

    // Use MetaMask's published E2E-only SRP and dispatch the same paste event
    // its React control handles in normal use. This avoids CI/X11 clipboard
    // flakiness without bypassing MetaMask validation or wallet creation logic.
    await clickSelector(surface,'[data-testid="onboarding-import-wallet"]');
    await clickSelector(surface,'[data-testid="onboarding-import-with-srp-button"]');
    await pasteSelector(surface,'[data-testid="srp-input-import__srp-note"]',TEST_SRP);
    await waitFor(async()=>{
      const s=await selectorState(surface,'[data-testid="import-srp-confirm"]');
      return s?.found&&!s.disabled?s:null;
    },{timeout:20000,label:'valid MetaMask SRP'});
    await clickSelector(surface,'[data-testid="import-srp-confirm"]');
    await waitSelector(surface,'[data-testid="create-password-new-input"]',30000);
    await fillSelector(surface,'[data-testid="create-password-new-input"]',TEST_PASSWORD);
    await fillSelector(surface,'[data-testid="create-password-confirm-input"]',TEST_PASSWORD);
    await clickSelector(surface,'[data-testid="create-password-terms"]');
    await waitFor(async()=>{
      const s=await selectorState(surface,'[data-testid="create-password-submit"]');
      return s?.found&&!s.disabled?s:null;
    },{timeout:10000,label:'MetaMask password submit enabled'});
    await clickSelector(surface,'[data-testid="create-password-submit"]');

    const passkey=await waitSelector(surface,'[data-testid="passkey-maybe-later-button"]',30000);
    ok('MetaMask import reaches passkey choice in Breeze',!!passkey,JSON.stringify(passkey));
    await clickSelector(surface,'[data-testid="passkey-maybe-later-button"]');
    await waitSelector(surface,'[data-testid="metametrics-i-agree"]',30000);
    await clickSelector(surface,'[data-testid="metametrics-i-agree"]');
    await waitSelector(surface,'[data-testid="onboarding-complete-done"]',30000);
    ok('MetaMask test wallet import reaches completion in Breeze',true,String(surface.webContents.getURL()));
    await clickSelector(surface,'[data-testid="onboarding-complete-done"]');
    await sleep(1000);

    await win.webContents.executeJavaScript(`(()=>{window.__breezeAccountsResult=null;window.ethereum.request({method:'eth_requestAccounts'}).then(v=>window.__breezeAccountsResult={ok:true,value:v},e=>window.__breezeAccountsResult={ok:false,error:String(e&&e.message||e)});return 'started'})()`);
    const connectWindow=await findExtensionWindow(extOrigin,'[data-testid="confirm-btn"]',new Set([surface?.id]),30000);
    const connectState=await connectWindow.webContents.executeJavaScript(`({href:location.href,body:(document.body?.innerText||'').slice(0,500)})`);
    ok('MetaMask opens a real dapp connection approval in Breeze',!!connectWindow,JSON.stringify(connectState));
    await clickSelector(connectWindow,'[data-testid="confirm-btn"]');
    const accountResult=await waitFor(()=>win.webContents.executeJavaScript('window.__breezeAccountsResult'),{timeout:30000,label:'eth_requestAccounts result'});
    const accounts=accountResult?.ok&&Array.isArray(accountResult.value)?accountResult.value:[];
    ok('MetaMask approves eth_requestAccounts through Breeze',accounts.length>0&&/^0x[0-9a-fA-F]{40}$/.test(String(accounts[0]||'')),JSON.stringify(accountResult));

    if(accounts[0]){
      await win.webContents.executeJavaScript(`(()=>{window.__breezeSignResult=null;window.ethereum.request({method:'personal_sign',params:[${JSON.stringify(TEST_MESSAGE_HEX)},${JSON.stringify(accounts[0])}]}).then(v=>window.__breezeSignResult={ok:true,value:v},e=>window.__breezeSignResult={ok:false,error:String(e&&e.message||e)});return 'started'})()`);
      const signWindow=await findExtensionWindow(extOrigin,'[data-testid="confirm-footer-button"]',new Set([surface?.id]),30000);
      const signState=await signWindow.webContents.executeJavaScript(`({href:location.href,body:(document.body?.innerText||'').slice(0,500)})`);
      ok('MetaMask opens a real personal-sign confirmation in Breeze',!!signWindow,JSON.stringify(signState));
      await clickSelector(signWindow,'[data-testid="confirm-footer-button"]');
      const signResult=await waitFor(()=>win.webContents.executeJavaScript('window.__breezeSignResult'),{timeout:30000,label:'personal_sign result'});
      ok('MetaMask returns a valid signature to the Breeze dapp',signResult?.ok===true&&/^0x[0-9a-fA-F]{130}$/.test(String(signResult.value||'')),JSON.stringify(signResult));
    }

    const persisted=await win.webContents.executeJavaScript(`window.ethereum.request({method:'eth_accounts'})`).catch(()=>[]);
    ok('MetaMask keeps the approved dapp account available after confirmation windows close',Array.isArray(persisted)&&persisted.length>0,JSON.stringify(persisted));

    const compatState=runtime.list().find(x=>x.localId===localId)?.compatibilityBridge;
    ok('MetaMask uses the managed Breeze compatibility bridge',compatState?.prepared===true&&compatState?.runtimeCount===1,JSON.stringify(compatState||{}));

    await runtime.remove(localId,[{ses,workspaceId:'default'}]);
  }catch(err){console.error(err);fail++;}
  finally{
    try{for(const w of BrowserWindow.getAllWindows()){if(w!==win&&!w.isDestroyed())w.destroy();}}catch{}
    try{if(win&&!win.isDestroyed())win.destroy();}catch{}
    try{if(srv)srv.close();}catch{}
    try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}
  }
  console.log(`\nOfficial MetaMask in Breeze: ${pass}/${pass+fail}`);
  app.exit(fail?1:0);
})();
