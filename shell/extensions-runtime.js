/* Breeze production extension runtime adapter.
   Wraps the existing registry with the managed MV3 compatibility layer while
   keeping Breeze's tab/workspace/session security boundaries intact. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const base = require('./extensions');
const compat = require('./extension-compat');

let BrowserWindow = null, Notification = null, ipcMain = null;
try {
  const electron = require('electron');
  if (electron && typeof electron === 'object') {
    BrowserWindow = electron.BrowserWindow || null;
    Notification = electron.Notification || null;
    ipcMain = electron.ipcMain || null;
  }
} catch {}

let rootDir = null;
let internalInvoke = null;
let handlers = null;
let pageIpcReady = false;
const extensionWindows = new Set();
const oauthWindows = new Set();
const notifications = new Map();
const runtimeContexts = new Map();
const serviceWorkerSessions = new WeakMap();
const pagePreload = path.join(__dirname,'extension-page-preload.js');
const serviceWorkerPreload = path.join(__dirname,'extension-sw-preload.js');

function safeWorkspace(value){ return String(value||'default').replace(/[^a-z0-9_-]/gi,'-').slice(0,80)||'default'; }
function sealedSession(ses,workspaceId='default'){
  const storage=String(ses?.storagePath||'').replace(/\\/g,'/').toLowerCase();
  return storage.includes('/partitions/ws-'+safeWorkspace(workspaceId).toLowerCase());
}
function setInternalInvoker(fn){ internalInvoke=typeof fn==='function'?fn:null; }
async function invoke(channel,...args){
  if(!internalInvoke){ const err=new Error('Breeze browser host is not ready'); err.status=503; throw err; }
  return internalInvoke(channel,...args);
}
function managedDir(localId){ return path.join(rootDir,String(localId||'')); }
async function prepare(row){
  if(!row||row.enabled===false||!rootDir) return {prepared:false};
  return compat.prepareManagedCopy({localId:row.localId,managedDir:managedDir(row.localId)});
}
function chromeTab(state,windowId,index=0){
  if(!state) return null;
  return {
    id:Number(state.id), index:Number(index||0), windowId:Number(windowId||1), active:!!state.active,
    highlighted:!!state.active, selected:!!state.active, pinned:false, audible:false,
    discarded:!!state.sleeping, incognito:!!state.private,
    url:String(state.url||''), pendingUrl:String(state.url||''), title:String(state.title||''),
    status:state.loading?'loading':'complete'
  };
}
function allowedUrl(ctx,raw){
  const value=String(raw||'').trim();
  if(!value) return '';
  try{
    const u=new URL(value);
    if(['http:','https:'].includes(u.protocol)) return u.toString();
    if(u.protocol==='chrome-extension:'&&u.hostname===String(ctx.runtimeId||'')) return u.toString();
  }catch{}
  const err=new Error('extension requested an unsupported URL'); err.status=400; throw err;
}
function extWindowById(id){
  if(!BrowserWindow) return null;
  return [...extensionWindows].find(w=>!w.isDestroyed()&&w.id===Number(id))||null;
}
function windowRow(w,type='normal'){
  if(!w||w.isDestroyed()) return null;
  const b=w.getBounds();
  return {id:w.id,focused:w.isFocused(),top:b.y,left:b.x,width:b.width,height:b.height,incognito:false,type,state:w.isMaximized()?'maximized':w.isMinimized()?'minimized':w.isFullScreen()?'fullscreen':'normal',alwaysOnTop:w.isAlwaysOnTop()};
}
function createExtensionWindow(ctx,details={}){
  if(!BrowserWindow){ const err=new Error('extension windows require Breeze desktop'); err.status=501; throw err; }
  const url=allowedUrl(ctx,details.url||`chrome-extension://${ctx.runtimeId}/`);
  const parent=BrowserWindow.getFocusedWindow()||undefined;
  const width=Math.max(320,Math.min(1400,Number(details.width)||390));
  const height=Math.max(360,Math.min(1200,Number(details.height)||600));
  const opts={
    width,height,show:false,resizable:true,minimizable:true,maximizable:true,autoHideMenuBar:true,
    parent:details.type==='popup'?parent:undefined,
    webPreferences:{session:ctx.ses,preload:pagePreload,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}
  };
  if(Number.isFinite(Number(details.left))) opts.x=Number(details.left);
  if(Number.isFinite(Number(details.top))) opts.y=Number(details.top);
  const w=new BrowserWindow(opts); extensionWindows.add(w);
  w.webContents.setWindowOpenHandler(({url:target})=>{
    try{
      const clean=allowedUrl(ctx,target);
      if(clean.startsWith('chrome-extension://')) createExtensionWindow(ctx,{url:clean,type:'popup'});
      else handlers?.['tabs.create']?.(ctx,{url:clean,active:true}).catch(()=>{});
    }catch{}
    return {action:'deny'};
  });
  w.once('ready-to-show',()=>{ if(!w.isDestroyed()&&details.focused!==false) w.show(); });
  w.on('closed',()=>{
    extensionWindows.delete(w);
    compat.emitEvent(ctx.localId,ctx.runtimeId,ctx.ses,'windows.onRemoved',[w.id]);
    emitWorkerEvent(ctx,'windows.onRemoved',[w.id]);
  });
  w.loadURL(url).catch(()=>{});
  return w;
}
function cookieFilter(params={}){
  const out={};
  for(const key of ['url','name','domain','path','secure','session']) if(params[key]!==undefined) out[key]=params[key];
  return out;
}
function cookieDetails(params={}){
  const out={};
  for(const key of ['url','name','value','domain','path','secure','httpOnly','expirationDate','sameSite']) if(params[key]!==undefined) out[key]=params[key];
  return out;
}
async function breezeTabStates(ctx){
  const rows=await invoke('tab:list');
  const ws=safeWorkspace(ctx.workspaceId);
  return Array.isArray(rows)?rows.filter(x=>!x?.private&&safeWorkspace(x?.workspace||ws)===ws):[];
}
function filterTabQuery(rows,query={}){
  let out=rows.slice();
  if(query.active!==undefined) out=out.filter(x=>!!x.active===!!query.active);
  if(query.highlighted!==undefined) out=out.filter(x=>!!x.active===!!query.highlighted);
  if(typeof query.title==='string') out=out.filter(x=>String(x.title||'').includes(query.title));
  if(typeof query.url==='string') out=out.filter(x=>String(x.url||'').includes(query.url.replace(/\*/g,'')));
  return out;
}
function notificationKey(ctx,id){ return String(ctx.localId||ctx.runtimeId||'extension')+':'+String(id||''); }
function rememberRuntime(localId,runtimeId,ses,workspaceId){
  if(!ses||!runtimeId)return;
  let map=runtimeContexts.get(ses); if(!map){map=new Map();runtimeContexts.set(ses,map);}
  map.set(String(runtimeId),{localId:String(localId),runtimeId:String(runtimeId),ses,workspaceId:safeWorkspace(workspaceId),sealed:sealedSession(ses,workspaceId),private:false});
}
function forgetRuntime(localId,ses){
  const map=runtimeContexts.get(ses); if(!map)return;
  for(const [rid,ctx] of map) if(ctx.localId===String(localId))map.delete(rid);
  if(!map.size)runtimeContexts.delete(ses);
}
function contextForSender(sender){
  try{
    const u=new URL(sender.getURL());
    if(u.protocol!=='chrome-extension:')return null;
    return runtimeContexts.get(sender.session)?.get(u.hostname)||null;
  }catch{return null;}
}
function contextsForLocalId(localId,workspaceId='default',sealed=false){
  const out=[];
  for(const map of runtimeContexts.values())for(const ctx of map.values())if(ctx.localId===String(localId)&&ctx.workspaceId===safeWorkspace(workspaceId)&&ctx.sealed===!!sealed)out.push(ctx);
  return out;
}
function pageMethodAllowed(ctx,method){
  const row=base.list().find(x=>x.localId===ctx.localId);
  if(!row||row.enabled===false)return false;
  const perms=new Set(row.permissions||[]);
  if(method.startsWith('tabs.')||method.startsWith('windows.'))return true;
  if(method.startsWith('cookies.'))return perms.has('cookies');
  if(method.startsWith('notifications.'))return perms.has('notifications');
  if(method.startsWith('identity.'))return perms.has('identity');
  return false;
}
async function dispatchPageApi(sender,method,params={}){
  const ctx=contextForSender(sender);
  if(!ctx){const err=new Error('unregistered extension page');err.status=403;throw err;}
  const name=String(method||'');
  if(!pageMethodAllowed(ctx,name)){const err=new Error('extension page API is not permitted');err.status=403;throw err;}
  const fn=handlers?.[name];
  if(typeof fn!=='function'){const err=new Error('extension page API is not implemented');err.status=501;throw err;}
  return fn(ctx,params&&typeof params==='object'?params:{});
}

function serviceWorkerRuntimeId(ses,versionId,worker){
  let scope='';
  try{
    const running=ses?.serviceWorkers?.getAllRunning?.()||{};
    const info=running[String(versionId)]||running[Number(versionId)]||null;
    scope=String(info?.scope||worker?.scope||worker?.scriptURL||'');
  }catch{}
  try{
    const u=new URL(scope);
    return u.protocol==='chrome-extension:'?u.hostname:'';
  }catch{return '';}
}
function emitWorkerEvent(ctx,name,args=[]){
  const state=serviceWorkerSessions.get(ctx?.ses);
  if(!state)return;
  const eventName=String(name||'');
  const eventArgs=Array.isArray(args)?args:[];
  for(const worker of state.workers){
    try{
      if(!worker||worker.isDestroyed?.())continue;
      const runtimeId=serviceWorkerRuntimeId(ctx.ses,worker.versionId,worker);
      if(runtimeId!==String(ctx.runtimeId||''))continue;
      worker.send('breeze:extension-event',eventName,eventArgs);
    }catch{}
  }
}
async function waitForWorkerContext(ses,runtimeId){
  const id=String(runtimeId||'');
  for(let i=0;i<100;i++){
    const ctx=runtimeContexts.get(ses)?.get(id)||null;
    if(ctx)return ctx;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  return null;
}
async function dispatchWorkerApi(ses,versionId,worker,method,params={}){
  const runtimeId=serviceWorkerRuntimeId(ses,versionId,worker);
  if(!runtimeId){const err=new Error('unregistered extension service worker');err.status=403;throw err;}
  const ctx=await waitForWorkerContext(ses,runtimeId);
  if(!ctx){const err=new Error('extension service-worker context is not ready');err.status=503;throw err;}
  const name=String(method||'');
  if(!pageMethodAllowed(ctx,name)){const err=new Error('extension service-worker API is not permitted');err.status=403;throw err;}
  const fn=handlers?.[name];
  if(typeof fn!=='function'){const err=new Error('extension service-worker API is not implemented');err.status=501;throw err;}
  return fn(ctx,params&&typeof params==='object'?params:{});
}
function attachServiceWorkerBridge(ses,versionId){
  const state=serviceWorkerSessions.get(ses);
  if(!state||!ses?.serviceWorkers)return;
  let worker=null;
  try{worker=ses.serviceWorkers.getWorkerFromVersionID(Number(versionId));}catch{}
  if(!worker||state.workers.has(worker))return;
  state.workers.add(worker);
  try{worker.ipc.removeHandler('breeze:extension-compat');}catch{}
  try{
    worker.ipc.handle('breeze:extension-compat',(_event,method,params)=>dispatchWorkerApi(ses,versionId,worker,method,params));
  }catch{}
}
function ensureServiceWorkerBridge(ses){
  if(!ses||serviceWorkerSessions.has(ses))return serviceWorkerSessions.get(ses)||null;
  if(typeof ses.registerPreloadScript!=='function'||!ses.serviceWorkers)return null;
  let preloadId='';
  try{preloadId=ses.registerPreloadScript({type:'service-worker',filePath:serviceWorkerPreload});}
  catch{return null;}
  const state={preloadId,workers:new Set()};
  serviceWorkerSessions.set(ses,state);
  const onStatus=({versionId,runningStatus})=>{
    if(runningStatus==='starting'||runningStatus==='running')attachServiceWorkerBridge(ses,versionId);
    if(runningStatus==='stopped'||runningStatus==='redundant'){
      for(const worker of state.workers) if(Number(worker?.versionId)===Number(versionId)) state.workers.delete(worker);
    }
  };
  try{ses.serviceWorkers.on('running-status-changed',onStatus);}catch{}
  try{
    for(const versionId of Object.keys(ses.serviceWorkers.getAllRunning?.()||{}))attachServiceWorkerBridge(ses,versionId);
  }catch{}
  return state;
}

function actionPopupPath(localId){
  try{
    const manifest=JSON.parse(fs.readFileSync(path.join(managedDir(localId),'manifest.json'),'utf8'));
    const action=(manifest.action&&typeof manifest.action==='object'&&manifest.action)||(manifest.browser_action&&typeof manifest.browser_action==='object'&&manifest.browser_action)||(manifest.page_action&&typeof manifest.page_action==='object'&&manifest.page_action)||null;
    const popup=String(action?.default_popup||'').trim();
    if(!popup||popup.includes('..')||/^[a-z][a-z0-9+.-]*:/i.test(popup))return '';
    return popup.replace(/^\/+/, '');
  }catch{return '';}
}
async function openAction(localId,context={}){
  const row=base.list().find(x=>x.localId===String(localId));
  if(!row)return{error:'extension not found'};
  if(row.enabled===false)return{error:'extension is disabled'};
  const popup=actionPopupPath(localId);
  if(!popup)return{error:'this extension has no action popup'};
  const candidates=contextsForLocalId(localId,context.workspaceId||'default',!!context.sealed);
  if(candidates.length!==1)return{error:candidates.length?'extension is active in multiple matching sessions':'extension session is not ready'};
  const ctx=candidates[0];
  const ext=ctx.ses.extensions.getExtension(ctx.runtimeId);
  if(!ext)return{error:'extension could not be loaded in this workspace'};
  let popupUrl;try{popupUrl=new URL(popup,ext.url).toString();}catch{return{error:'extension popup path is invalid'};}
  if(!popupUrl.startsWith(ext.url))return{error:'extension popup escaped its own origin'};
  const w=createExtensionWindow(ctx,{url:popupUrl,type:'popup',focused:true,width:390,height:600});
  return{ok:true,localId:String(localId),runtimeId:ctx.runtimeId,popup:true,windowId:w.id};
}
function installPageIpc(){
  if(pageIpcReady||!ipcMain||typeof ipcMain.handle!=='function')return;
  pageIpcReady=true;
  try{ipcMain.removeHandler('extension:openAction');}catch{}
  ipcMain.handle('extension:openAction',(_event,localId,context)=>openAction(String(localId||''),context||{}));
  try{ipcMain.removeHandler('extension:pageApi');}catch{}
  ipcMain.handle('extension:pageApi',(event,method,params)=>dispatchPageApi(event.sender,method,params));
}
async function launchWebAuthFlow(ctx,details={}){
  if(!BrowserWindow){ const err=new Error('web authentication requires Breeze desktop'); err.status=501; throw err; }
  const start=allowedUrl(ctx,details.url);
  if(!/^https?:/i.test(start)){ const err=new Error('web authentication requires an HTTP(S) URL'); err.status=400; throw err; }
  const redirectPrefix=`https://${ctx.runtimeId}.chromiumapp.org/`;
  const interactive=details.interactive!==false;
  return new Promise((resolve,reject)=>{
    let settled=false;
    const parent=BrowserWindow.getFocusedWindow()||undefined;
    const auth=new BrowserWindow({
      width:520,height:720,minWidth:420,minHeight:540,show:false,autoHideMenuBar:true,parent:interactive?parent:undefined,
      webPreferences:{session:ctx.ses,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}
    });
    oauthWindows.add(auth);
    const finish=(err,value)=>{
      if(settled)return; settled=true;
      clearTimeout(timer); oauthWindows.delete(auth);
      try{if(!auth.isDestroyed())auth.close();}catch{}
      if(err)reject(err); else resolve(value);
    };
    const inspect=(event,target)=>{
      if(typeof target==='string'&&target.startsWith(redirectPrefix)){
        if(event&&typeof event.preventDefault==='function')event.preventDefault();
        finish(null,target); return;
      }
      try{const u=new URL(target);if(!['http:','https:'].includes(u.protocol)){if(event?.preventDefault)event.preventDefault();}}catch{if(event?.preventDefault)event.preventDefault();}
    };
    auth.webContents.on('will-redirect',inspect);
    auth.webContents.on('will-navigate',inspect);
    auth.webContents.setWindowOpenHandler(({url})=>{ try{inspect(null,url);}catch{} return {action:'deny'}; });
    auth.on('closed',()=>{ if(!settled){const err=new Error('authentication window was closed');err.status=499;finish(err);} });
    auth.once('ready-to-show',()=>{if(interactive&&!auth.isDestroyed())auth.show();});
    const timer=setTimeout(()=>{const err=new Error('authentication timed out');err.status=408;finish(err);},120000);
    auth.loadURL(start).catch(err=>finish(err));
  });
}

function hostHandlers(){
  return {
    'tabs.create':async(ctx,params={})=>{
      const url=params.url?allowedUrl(ctx,params.url):'';
      if(url.startsWith('chrome-extension://')){
        const w=createExtensionWindow(ctx,{url,type:'normal',focused:params.active!==false});
        return {id:w.webContents.id,index:0,windowId:w.id,active:true,highlighted:true,pinned:false,incognito:false,url,title:'',status:'loading'};
      }
      const opts={workspaceId:safeWorkspace(ctx.workspaceId),sealed:!!ctx.sealed};
      if(url) opts.url=url;
      const id=await invoke('tab:create',opts);
      const rows=await breezeTabStates(ctx);
      const state=rows.find(x=>Number(x?.id)===Number(id));
      const owner=BrowserWindow&&BrowserWindow.getFocusedWindow();
      return chromeTab(state||{id,url,active:true},owner?.id||1,Math.max(0,rows.findIndex(x=>Number(x?.id)===Number(id))));
    },
    'tabs.query':async(ctx,params={})=>{
      const rows=filterTabQuery(await breezeTabStates(ctx),params||{});
      const owner=BrowserWindow&&BrowserWindow.getFocusedWindow();
      return rows.map((row,index)=>chromeTab(row,owner?.id||1,index));
    },
    'tabs.get':async(ctx,params={})=>{
      const rows=await breezeTabStates(ctx); const row=rows.find(x=>Number(x?.id)===Number(params.tabId));
      if(!row){const err=new Error('tab not found');err.status=404;throw err;}
      return chromeTab(row,BrowserWindow?.getFocusedWindow()?.id||1,Math.max(0,rows.indexOf(row)));
    },
    'tabs.getCurrent':async(ctx)=>{
      const rows=await breezeTabStates(ctx); const row=rows.find(x=>x.active)||null;
      return row?chromeTab(row,BrowserWindow?.getFocusedWindow()?.id||1,Math.max(0,rows.indexOf(row))):null;
    },
    'tabs.update':async(ctx,params={})=>{
      const props=params.props&&typeof params.props==='object'?params.props:{};
      const rows=await breezeTabStates(ctx);
      let id=Number(params.tabId);
      if(!Number.isInteger(id)||id<=0) id=Number(rows.find(x=>x.active)?.id||0);
      if(!id){const err=new Error('tab not found');err.status=404;throw err;}
      if(props.url) await invoke('tab:navigate',id,allowedUrl(ctx,props.url));
      if(props.active===true||props.highlighted===true||props.selected===true) await invoke('tab:select',id);
      const next=await breezeTabStates(ctx); const row=next.find(x=>Number(x?.id)===id);
      return row?chromeTab(row,BrowserWindow?.getFocusedWindow()?.id||1,Math.max(0,next.indexOf(row))):null;
    },
    'tabs.remove':async(ctx,params={})=>{
      const ids=Array.isArray(params.tabIds)?params.tabIds:[params.tabIds];
      const permitted=new Set((await breezeTabStates(ctx)).map(x=>Number(x.id)));
      for(const raw of ids){const id=Number(raw);if(permitted.has(id))await invoke('tab:close',id);}
      return null;
    },
    'windows.create':async(ctx,params={})=>{
      const w=createExtensionWindow(ctx,params);
      const row=windowRow(w,params.type==='popup'?'popup':'normal');
      if(params.url) row.tabs=[{id:w.webContents.id,index:0,windowId:w.id,active:true,highlighted:true,pinned:false,incognito:false,url:allowedUrl(ctx,params.url),title:'',status:'loading'}];
      return row;
    },
    'windows.getAll':async()=> BrowserWindow ? BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>windowRow(w)).filter(Boolean) : [],
    'windows.getCurrent':async()=>{
      const w=BrowserWindow?.getFocusedWindow()||BrowserWindow?.getAllWindows()?.[0];
      return windowRow(w);
    },
    'windows.getLastFocused':async()=>{
      const w=BrowserWindow?.getFocusedWindow()||BrowserWindow?.getAllWindows()?.[0];
      return windowRow(w);
    },
    'windows.update':async(_ctx,params={})=>{
      const w=extWindowById(params.id);
      if(!w){ const err=new Error('extension may update only a window it created'); err.status=403; throw err; }
      const next={};
      if(Number.isFinite(Number(params.left))) next.x=Number(params.left);
      if(Number.isFinite(Number(params.top))) next.y=Number(params.top);
      if(Number.isFinite(Number(params.width))) next.width=Math.max(320,Number(params.width));
      if(Number.isFinite(Number(params.height))) next.height=Math.max(360,Number(params.height));
      if(Object.keys(next).length) w.setBounds({...w.getBounds(),...next});
      if(params.focused===true) w.focus();
      if(params.state==='maximized') w.maximize(); else if(params.state==='minimized') w.minimize(); else if(params.state==='normal'){ if(w.isMaximized())w.unmaximize(); if(w.isMinimized())w.restore(); }
      return windowRow(w);
    },
    'windows.remove':async(_ctx,params={})=>{
      const w=extWindowById(params.id);
      if(!w){ const err=new Error('extension may close only a window it created'); err.status=403; throw err; }
      w.close(); return null;
    },
    'cookies.get':async(ctx,params={})=>{ const rows=await ctx.ses.cookies.get(cookieFilter(params)); return rows[0]||null; },
    'cookies.getAll':async(ctx,params={})=>ctx.ses.cookies.get(cookieFilter(params)),
    'cookies.set':async(ctx,params={})=>{await ctx.ses.cookies.set(cookieDetails(params));const rows=await ctx.ses.cookies.get(cookieFilter({url:params.url,name:params.name}));return rows[0]||null;},
    'cookies.remove':async(ctx,params={})=>{await ctx.ses.cookies.remove(String(params.url||''),String(params.name||''));return{url:String(params.url||''),name:String(params.name||'')};},
    'notifications.create':async(ctx,params={})=>{
      const id=String(params.id||`breeze-${Date.now()}`).slice(0,128);
      const options=params.options&&typeof params.options==='object'?params.options:{};
      if(!Notification||typeof Notification.isSupported!=='function'||!Notification.isSupported()) return id;
      const note=new Notification({title:String(options.title||base.list().find(x=>x.localId===ctx.localId)?.name||'Breeze extension').slice(0,160),body:String(options.message||'').slice(0,500)});
      const key=notificationKey(ctx,id); notifications.set(key,note);
      note.on('close',()=>notifications.delete(key)); note.show(); return id;
    },
    'notifications.clear':async(ctx,params={})=>{
      const key=notificationKey(ctx,params.id); const note=notifications.get(key); if(!note)return false;
      try{note.close();}catch{} notifications.delete(key); return true;
    },
    'identity.launchWebAuthFlow':async(ctx,params={})=>launchWebAuthFlow(ctx,params)
  };
}

function init(userDataPath){
  rootDir=path.join(userDataPath,'extensions');
  handlers=hostHandlers();
  compat.init({rootDir,handlers});
  const result=base.init(userDataPath);
  installPageIpc();
  return result;
}
function list(){ return base.list().map(row=>({...row,compatibilityBridge:compat.status(row.localId)})); }
async function loadIntoSession(ses,workspaceId='default'){
  ensureServiceWorkerBridge(ses);
  for(const row of base.list()) if(row.enabled!==false) await prepare(row);
  const result=await base.loadIntoSession(ses,workspaceId);
  for(const item of result||[]){
    if(item?.ok&&item.runtimeId){
      compat.registerRuntime(item.localId,item.runtimeId,{ses,workspaceId:safeWorkspace(workspaceId),sealed:sealedSession(ses,workspaceId),private:false});
      rememberRuntime(item.localId,item.runtimeId,ses,workspaceId);
    }
  }
  // Workers can already be running by the time loadExtension resolves. Attach
  // any handler that was not visible during the earlier `starting` event.
  try{for(const versionId of Object.keys(ses?.serviceWorkers?.getAllRunning?.()||{}))attachServiceWorkerBridge(ses,versionId);}catch{}
  return result;
}
async function setEnabled(localId,enabled,sessionEntries=[]){
  const row=base.list().find(x=>x.localId===localId);
  if(enabled&&row) await prepare(row);
  if(enabled) for(const {ses} of sessionEntries)ensureServiceWorkerBridge(ses);
  const result=await base.setEnabled(localId,enabled,sessionEntries);
  if(enabled){
    for(const {ses,workspaceId} of sessionEntries){
      const loaded=await base.loadIntoSession(ses,workspaceId);
      for(const item of loaded||[]) if(item?.localId===localId&&item?.ok&&item.runtimeId){
        compat.registerRuntime(localId,item.runtimeId,{ses,workspaceId:safeWorkspace(workspaceId),sealed:sealedSession(ses,workspaceId),private:false});
        rememberRuntime(localId,item.runtimeId,ses,workspaceId);
      }
      try{for(const versionId of Object.keys(ses?.serviceWorkers?.getAllRunning?.()||{}))attachServiceWorkerBridge(ses,versionId);}catch{}
    }
  }else{
    for(const {ses,workspaceId} of sessionEntries){compat.unregisterRuntime(localId,{ses,workspaceId});forgetRuntime(localId,ses);}
  }
  return result;
}
async function remove(localId,sessionEntries=[]){
  const result=await base.remove(localId,sessionEntries);
  for(const {ses} of sessionEntries)forgetRuntime(localId,ses);
  compat.remove(localId);
  return result;
}
function isAllowedExtensionUrl(ses,raw){
  try{
    const u=new URL(String(raw||''));
    return u.protocol==='chrome-extension:'&&!!ses?.extensions?.getExtension?.(u.hostname);
  }catch{return false;}
}

module.exports={
  init,list,inspectDirectory:base.inspectDirectory,importDirectory:base.importDirectory,
  loadIntoSession,setEnabled,remove,openAction,analyzeManifest:base.analyzeManifest,
  setInternalInvoker,isAllowedExtensionUrl,dispatchPageApi
};
