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
  const hit=await waitFor(async()=>{
    if(!win||win.isDestroyed())return null;
    return win.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth?{x:r.left+r.width/2,y:r.top+r.height/2,disabled:!!e.disabled}:null})()`).catch(()=>null);
  },{timeout:30000,label:`clickable ${selector}`});
  if(hit.disabled)throw new Error(`selector is disabled: ${selector}`);
  const x=Math.round(hit.x), y=Math.round(hit.y);
  try{if(!win.isVisible())win.show();win.focus();}catch{}
  win.webContents.sendInputEvent({type:'mouseMove',x,y});
  win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});
  win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});
  return true;
}
async function routeClickSelector(win,selector){
  const hit=await waitFor(async()=>{
    if(!win||win.isDestroyed())return null;
    return win.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`).catch(()=>null);
  },{timeout:30000,label:`enabled route control ${selector}`});
  const x=Math.round(hit.x), y=Math.round(hit.y);
  try{if(!win.isVisible())win.show();win.focus();}catch{}
  // The MetaMask onboarding form grows after SRP paste, so route controls can
  // move below the initial viewport. Measure only after scrolling the exact
  // control into view, then use a real Electron pointer event like a user.
  win.webContents.sendInputEvent({type:'mouseMove',x,y});
  win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});
  win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});
  await sleep(250);
  return true;
}
async function fillSelector(win,selector,value){
  await waitSelector(win,selector);
  const focused=await win.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center',inline:'nearest'});e.focus();if(typeof e.select==='function')e.select();else if(typeof e.setSelectionRange==='function')e.setSelectionRange(0,String(e.value||'').length);return {tag:e.tagName,disabled:!!e.disabled,value:String(e.value||'')};})()`).catch(()=>null);
  if(!focused)throw new Error(`unable to focus ${selector}`);
  if(focused.disabled)throw new Error(`selector is disabled: ${selector}`);
  // Type through Chromium's native editing path instead of mutating React's
  // controlled input value from executeJavaScript. This matches MetaMask's
  // own WebDriver fill behavior and fires the real input/change machinery.
  try{if(!win.isVisible())win.show();win.focus();}catch{}
  win.webContents.insertText(String(value));
  await sleep(150);
  return win.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e?String(e.value||''):''})()`).catch(()=>null);
}
async function pasteSelector(win,selector,value){
  await waitSelector(win,selector);
  return win.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('missing selector');e.focus();const ev=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(ev,'clipboardData',{value:{getData:(type)=>type==='text'||type==='text/plain'?${JSON.stringify(value)}:''}});return e.dispatchEvent(ev)})()`);
}
async function waitHash(win,fragment,timeout=30000){
  return waitFor(()=>win&&!win.isDestroyed()?win.webContents.executeJavaScript(`location.hash===${JSON.stringify(fragment)}?location.href:''`).catch(()=>null):null,{timeout,label:`route ${fragment}`});
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
async function extensionWindowSnapshot(extOrigin){
  const rows=[];
  for(const w of BrowserWindow.getAllWindows()){
    if(!w||w.isDestroyed())continue;
    const href=String(w.webContents.getURL()||'');
    if(!href.startsWith(extOrigin))continue;
    const state=await w.webContents.executeJavaScript(`({href:location.href,ready:document.readyState,body:(document.body?.innerText||'').trim().slice(0,300),hasSignConfirm:!!document.querySelector('[data-testid="confirm-footer-button"]')})`).catch(()=>({href}));
    rows.push({id:w.id,...state});
  }
  return rows;
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

    console.log('MetaMask onboarding: choose existing wallet');
    await routeClickSelector(surface,'[data-testid="onboarding-import-wallet"]');
    await waitSelector(surface,'[data-testid="onboarding-import-with-srp-button"]',30000);
    console.log('MetaMask onboarding: choose SRP import');
    await routeClickSelector(surface,'[data-testid="onboarding-import-with-srp-button"]');
    await waitSelector(surface,'[data-testid="srp-input-import__srp-note"]',30000);
    console.log('MetaMask onboarding: enter test SRP');
    await pasteSelector(surface,'[data-testid="srp-input-import__srp-note"]',TEST_SRP);
    await waitFor(async()=>{
      const s=await selectorState(surface,'[data-testid="import-srp-confirm"]');
      return s?.found&&!s.disabled?s:null;
    },{timeout:20000,label:'valid MetaMask SRP'});
    await routeClickSelector(surface,'[data-testid="import-srp-confirm"]');
    await waitHash(surface,'#/onboarding/create-password',30000);
    await waitSelector(surface,'[data-testid="create-password-new-input"]',30000);
    console.log('MetaMask onboarding: create test password');
    await fillSelector(surface,'[data-testid="create-password-new-input"]',TEST_PASSWORD);
    await fillSelector(surface,'[data-testid="create-password-confirm-input"]',TEST_PASSWORD);
    await clickSelector(surface,'[data-testid="create-password-terms"]');
    await waitFor(async()=>{
      const s=await selectorState(surface,'[data-testid="create-password-submit"]');
      return s?.found&&!s.disabled?s:null;
    },{timeout:10000,label:'MetaMask password submit enabled'});
    await routeClickSelector(surface,'[data-testid="create-password-submit"]');

    const passkey=await waitSelector(surface,'[data-testid="passkey-maybe-later-button"]',30000);
    ok('MetaMask import reaches passkey choice in Breeze',!!passkey,JSON.stringify(passkey));
    await routeClickSelector(surface,'[data-testid="passkey-maybe-later-button"]');
    await waitSelector(surface,'[data-testid="metametrics-i-agree"]',30000);
    await routeClickSelector(surface,'[data-testid="metametrics-i-agree"]');
    await waitSelector(surface,'[data-testid="onboarding-complete-done"]',30000);
    ok('MetaMask test wallet import reaches completion in Breeze',true,String(surface.webContents.getURL()));
    await routeClickSelector(surface,'[data-testid="onboarding-complete-done"]');
    await sleep(1000);

    await win.webContents.executeJavaScript(`(()=>{window.__breezeAccountsResult=null;window.ethereum.request({method:'eth_requestAccounts'}).then(v=>window.__breezeAccountsResult={ok:true,value:v},e=>window.__breezeAccountsResult={ok:false,error:String(e&&e.message||e)});return 'started'})()`);
    const connectWindow=await findExtensionWindow(extOrigin,'[data-testid="confirm-btn"]',new Set([surface?.id]),30000);
    const connectState=await connectWindow.webContents.executeJavaScript(`({href:location.href,body:(document.body?.innerText||'').slice(0,500)})`);
    ok('MetaMask opens a real dapp connection approval in Breeze',!!connectWindow,JSON.stringify(connectState));
    await routeClickSelector(connectWindow,'[data-testid="confirm-btn"]');
    const accountResult=await waitFor(()=>win.webContents.executeJavaScript('window.__breezeAccountsResult'),{timeout:30000,label:'eth_requestAccounts result'});
    const accounts=accountResult?.ok&&Array.isArray(accountResult.value)?accountResult.value:[];
    ok('MetaMask approves eth_requestAccounts through Breeze',accounts.length>0&&/^0x[0-9a-fA-F]{40}$/.test(String(accounts[0]||'')),JSON.stringify(accountResult));

    if(accounts[0]){
      await win.webContents.executeJavaScript(`(()=>{window.__breezeSignResult=null;window.ethereum.request({method:'personal_sign',params:[${JSON.stringify(TEST_MESSAGE_HEX)},${JSON.stringify(accounts[0])}]}).then(v=>window.__breezeSignResult={ok:true,value:v},e=>window.__breezeSignResult={ok:false,error:String(e&&e.message||e)});return 'started'})()`);
      let signWindow;
      try{
        // A real confirmation may be routed into an already-open MetaMask
        // surface. Certification cares about the official approval UI and a
        // valid signature, not whether MetaMask chooses a fresh window ID.
        signWindow=await findExtensionWindow(extOrigin,'[data-testid="confirm-footer-button"]',new Set(),30000);
      }catch(err){
        console.log('MetaMask personal-sign window snapshot:',JSON.stringify(await extensionWindowSnapshot(extOrigin)));
        console.log('MetaMask personal-sign provider result:',JSON.stringify(await win.webContents.executeJavaScript('window.__breezeSignResult').catch(()=>null)));
        throw err;
      }
      const signState=await signWindow.webContents.executeJavaScript(`({href:location.href,body:(document.body?.innerText||'').slice(0,500)})`);
      ok('MetaMask opens a real personal-sign confirmation in Breeze',!!signWindow,JSON.stringify(signState));
      await routeClickSelector(signWindow,'[data-testid="confirm-footer-button"]');
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
