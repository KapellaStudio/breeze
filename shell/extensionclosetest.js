'use strict';
const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = require('./extensions-runtime');
const selfClose = require('./extension-self-close');

let pass=0,fail=0;
function ok(name,cond,detail=''){console.log(`${cond?'PASS':'FAIL'}  ${name}${detail?`  [${detail}]`:''}`);cond?pass++:fail++;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function write(dir,file,body){const full=path.join(dir,file);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,body);}

(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-extension-close-'));
  const source=path.join(tmp,'source');
  const userData=path.join(tmp,'user-data');
  fs.mkdirSync(source,{recursive:true});
  write(source,'manifest.json',JSON.stringify({manifest_version:3,name:'Breeze Self Close Probe',version:'1.0.0',background:{service_worker:'worker.js'},action:{default_popup:'popup.html'}},null,2));
  write(source,'worker.js',`const removed=[];\nchrome.windows.onRemoved.addListener(id=>removed.push(id));\nchrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{\n  if(msg?.kind==='open'){chrome.windows.create({url:'popup.html',type:'popup'}).then(async win=>{const rows=await chrome.windows.getAll();sendResponse({id:win.id,type:rows.find(row=>row.id===win.id)?.type||''});},err=>sendResponse({error:String(err&&err.message||err)}));return true;}\n  if(msg?.kind==='events'){sendResponse({removed:[...removed]});return false;}\n});`);
  write(source,'probe.html','<!doctype html><html><body>probe</body></html>');
  write(source,'popup.html','<!doctype html><html><body><div id="ready">ready</div><script src="popup.js"></script></body></html>');
  write(source,'popup.js',`setTimeout(()=>window.close(),250);`);

  let ses=null,actionWin=null,probeWin=null,installed=null;
  try{
    await app.whenReady();
    selfClose.install(ipcMain,BrowserWindow);
    runtime.init(userData);
    installed=runtime.importDirectory(source);
    ok('self-close probe imports',installed?.installed===true,JSON.stringify(installed?.extension||installed));
    if(!installed?.installed)throw new Error('probe import failed');
    const localId=installed.extension.localId;
    ses=session.fromPartition('persist:breeze-self-close-'+Date.now());
    const loaded=(await runtime.loadIntoSession(ses,'default')).find(x=>x.localId===localId);
    ok('self-close probe loads into Breeze session',loaded?.ok===true&&!!loaded.runtimeId,JSON.stringify(loaded||{}));
    const ext=ses.extensions.getExtension(loaded.runtimeId);
    probeWin=new BrowserWindow({show:false,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    await probeWin.loadURL(new URL('probe.html',ext.url).toString());
    const opened=await runtime.openAction(localId,{workspaceId:'default',sealed:false});
    actionWin=opened?.windowId?BrowserWindow.fromId(opened.windowId):null;
    ok('Breeze creates browser-owned extension popup',!!actionWin,JSON.stringify(opened||{}));
    const id=opened?.windowId;
    let closed=false;
    for(let i=0;i<80;i++){
      if(!actionWin||actionWin.isDestroyed()||!BrowserWindow.fromId(id)){closed=true;break;}
      await sleep(100);
    }
    ok('extension window.close closes its own browser-created popup',closed,String(id||''));

    const workerPopup=await probeWin.webContents.executeJavaScript(`new Promise(resolve=>chrome.runtime.sendMessage({kind:'open'},resolve))`);
    ok('service worker chrome.windows.create opens a Breeze-owned popup',Number.isInteger(workerPopup?.id),JSON.stringify(workerPopup||{}));
    ok('service worker windows.getAll preserves the popup window type',workerPopup?.type==='popup',JSON.stringify(workerPopup||{}));
    let workerClosed=false,eventState={};
    for(let i=0;i<80;i++){
      workerClosed=!BrowserWindow.fromId(workerPopup?.id);
      eventState=await probeWin.webContents.executeJavaScript(`new Promise(resolve=>chrome.runtime.sendMessage({kind:'events'},resolve))`).catch(()=>({}));
      if(workerClosed&&eventState.removed?.includes(workerPopup?.id))break;
      await sleep(100);
    }
    ok('service-worker popup self-close reaches the real BrowserWindow lifecycle',workerClosed,String(workerPopup?.id||''));
    ok('real BrowserWindow close delivers the same id through windows.onRemoved exactly once',eventState.removed?.filter(x=>x===workerPopup?.id).length===1,JSON.stringify(eventState));
    await runtime.remove(localId,[{ses,workspaceId:'default'}]);
  }catch(err){console.error(err);fail++;}
  finally{
    try{if(actionWin&&!actionWin.isDestroyed())actionWin.destroy();}catch{}
    try{if(probeWin&&!probeWin.isDestroyed())probeWin.destroy();}catch{}
    try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}
  }
  console.log(`\nBreeze extension self-close: ${pass}/${pass+fail}`);
  app.exit(fail?1:0);
})();
