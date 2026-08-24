/* Breeze production extension runtime adapter.
   Wraps the existing registry with the managed MV3 compatibility layer while
   keeping Breeze's tab/workspace/session security boundaries intact. */
'use strict';
const path = require('node:path');
const base = require('./extensions');
const compat = require('./extension-compat');

let BrowserWindow = null;
try {
  const electron = require('electron');
  if (electron && typeof electron === 'object') BrowserWindow = electron.BrowserWindow || null;
} catch {}

let rootDir = null;
let internalInvoke = null;
const extensionWindows = new Set();

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
function chromeTab(state,windowId){
  if(!state) return null;
  return {
    id:Number(state.id), index:0, windowId:Number(windowId||1), active:!!state.active,
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
    webPreferences:{session:ctx.ses,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}
  };
  if(Number.isFinite(Number(details.left))) opts.x=Number(details.left);
  if(Number.isFinite(Number(details.top))) opts.y=Number(details.top);
  const w=new BrowserWindow(opts); extensionWindows.add(w);
  w.webContents.setWindowOpenHandler(({url:target})=>{
    try{ const clean=allowedUrl(ctx,target); createExtensionWindow(ctx,{url:clean,type:'popup'}); }catch{}
    return {action:'deny'};
  });
  w.once('ready-to-show',()=>{ if(!w.isDestroyed()&&details.focused!==false) w.show(); });
  w.on('closed',()=>extensionWindows.delete(w));
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

function hostHandlers(){
  return {
    'tabs.create':async(ctx,params={})=>{
      const url=allowedUrl(ctx,params.url||'https://www.google.com/');
      if(url.startsWith('chrome-extension://')){
        const w=createExtensionWindow(ctx,{url,type:'normal',focused:params.active!==false});
        return {id:w.webContents.id,index:0,windowId:w.id,active:true,highlighted:true,pinned:false,incognito:false,url,title:'',status:'loading'};
      }
      const id=await invoke('tab:create',{url,workspaceId:safeWorkspace(ctx.workspaceId),sealed:!!ctx.sealed});
      const rows=await invoke('tab:list');
      const state=Array.isArray(rows)?rows.find(x=>Number(x?.id)===Number(id)):null;
      const owner=BrowserWindow&&BrowserWindow.getFocusedWindow();
      return chromeTab(state||{id,url,active:true},owner?.id||1);
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
    'cookies.set':async(ctx,params={})=>ctx.ses.cookies.set(cookieDetails(params)),
    'cookies.remove':async(ctx,params={})=>ctx.ses.cookies.remove(String(params.url||''),String(params.name||''))
  };
}

function init(userDataPath){
  rootDir=path.join(userDataPath,'extensions');
  compat.init({rootDir,handlers:hostHandlers()});
  return base.init(userDataPath);
}
function list(){ return base.list().map(row=>({...row,compatibilityBridge:compat.status(row.localId)})); }
async function loadIntoSession(ses,workspaceId='default'){
  for(const row of base.list()) if(row.enabled!==false) await prepare(row);
  const result=await base.loadIntoSession(ses,workspaceId);
  for(const item of result||[]){
    if(item?.ok&&item.runtimeId) compat.registerRuntime(item.localId,item.runtimeId,{ses,workspaceId:safeWorkspace(workspaceId),sealed:sealedSession(ses,workspaceId),private:false});
  }
  return result;
}
async function setEnabled(localId,enabled,sessionEntries=[]){
  const row=base.list().find(x=>x.localId===localId);
  if(enabled&&row) await prepare(row);
  const result=await base.setEnabled(localId,enabled,sessionEntries);
  if(enabled){
    for(const {ses,workspaceId} of sessionEntries){
      const loaded=await base.loadIntoSession(ses,workspaceId);
      for(const item of loaded||[]) if(item?.localId===localId&&item?.ok&&item.runtimeId) compat.registerRuntime(localId,item.runtimeId,{ses,workspaceId:safeWorkspace(workspaceId),sealed:sealedSession(ses,workspaceId),private:false});
    }
  }else{
    for(const {ses,workspaceId} of sessionEntries) compat.unregisterRuntime(localId,{ses,workspaceId});
  }
  return result;
}
async function remove(localId,sessionEntries=[]){
  const result=await base.remove(localId,sessionEntries);
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
  loadIntoSession,setEnabled,remove,openAction:base.openAction,analyzeManifest:base.analyzeManifest,
  setInternalInvoker,isAllowedExtensionUrl
};
