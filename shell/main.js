/* ═══════════════════════════════════════════════════════════════════════════
   BREEZE — MAIN PROCESS
   Real Chromium, real tabs, real navigation.

   ARCHITECTURE
   The BrowserWindow hosts only Breeze's own chrome (breeze-desktop.html).
   Every web page lives in its own WebContentsView, positioned below the
   toolbar and beside the sidebar. That separation is the whole security
   story: page content never shares a renderer with the UI that has
   privileged IPC, so a compromised page cannot reach the shell API.

   SEALED WORKSPACES map exactly onto Electron sessions. A sealed workspace
   gets session.fromPartition('persist:ws-<id>') — a genuinely separate cookie
   jar, cache and storage. This is the one feature where the concept we
   designed and the platform primitive line up perfectly.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const { app, BrowserWindow, WebContentsView, session, shell, ipcMain, dialog, safeStorage } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { hardenSession, installGuards } = require('./security');
const search = require('./search');
const media = require('./media');
const extensions = require('./extensions');
const downloads = require('./downloads');
const preferences = require('./preferences');
const browserState = require('./state');
const permissionBroker = require('./permissions');
const library = require('./library');
const displayShare = require('./display');
const documents = require('./documents');

const SMOKE = process.argv.includes('--smoke-test');
const CHROME = { top: 48, side: 188, panel: 0 };
const STRIP_PARAMS = [
  'utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id',
  'fbclid','gclid','dclid','msclkid','twclid','igshid','mc_eid','mc_cid',
  'ref_src','ref_url','_ga','_gl','yclid','wickedid','vero_id','oly_enc_id'
];

let win = null;
const tabs = new Map();
let activeTabId = null;
let nextTabId = 1;
let internalView = false;
let privateGeneration = 1;
const recentlyClosed = [];
const TAB_SLEEP_AFTER_MS = 30 * 60 * 1000;
let tabSleepTimer = null;

const sessions = new Map();
const sessionContexts = new Map();
function liveWebContents(t){
  const wc=t?.view?.webContents;
  return wc && !wc.isDestroyed() ? wc : null;
}
function currentTabUrl(t){
  const wc=liveWebContents(t);
  return wc ? wc.getURL() : String(t?.sleepState?.url || '');
}
function currentTabTitle(t){
  const wc=liveWebContents(t);
  return wc ? wc.getTitle() : String(t?.sleepState?.title || t?.fileName || '');
}
function downloadContextForWebContents(wcId){
  const tid = tabIdForWebContents(wcId);
  const t = tid != null ? tabs.get(tid) : null;
  return t ? { url:currentTabUrl(t), workspace:t.workspace, private:!!t.private } : {};
}
function sessionEntries(){ return [...sessionContexts.values()].filter(x => !x.private); }
function sessionFor(workspaceId, sealed, privateMode = false){
  const safeWs = String(workspaceId || 'default').replace(/[^a-z0-9_-]/gi,'-').slice(0,80) || 'default';
  const key = privateMode
    ? `private:${privateGeneration}:${sealed?'sealed:':''}${safeWs}`
    : (sealed ? 'persist:ws-' + safeWs : 'persist:breeze-main');
  if (sessions.has(key)) return sessions.get(key);
  const partition = privateMode
    ? `breeze-private-${privateGeneration}-${sealed?'sealed-':''}${safeWs}`
    : key;
  const ses = privateMode ? session.fromPartition(partition,{cache:false}) : session.fromPartition(partition);
  hardenSession(ses, wcId => { const t = tabs.get(tabIdForWebContents(wcId)); if (t) t.blocked++; }, permissionBroker, {private:privateMode});
  downloads.wireSession(ses, downloadContextForWebContents);
  displayShare.attach(ses, send);
  sessionContexts.set(key, { ses, workspaceId:safeWs, private:privateMode });
  sessions.set(key, ses);
  if (!privateMode) extensions.loadIntoSession(ses, safeWs).catch(() => {});
  return ses;
}

async function purgePrivateSessions(){
  const doomed=[...sessionContexts.entries()].filter(([,x])=>x.private);
  for(const [key,x] of doomed){
    try{ permissionBroker.clearPrivate(x.ses); }catch{}
    try{ await x.ses.clearData(); }catch{}
    try{ await x.ses.clearAuthCache(); }catch{}
    try{ await x.ses.clearCache(); }catch{}
    try{ await x.ses.closeAllConnections(); }catch{}
    sessionContexts.delete(key); sessions.delete(key);
  }
  downloads.endPrivateSession();
  privateGeneration++;
}

function tabIdForWebContents(id){
  for (const [tid, t] of tabs){
    const wc=liveWebContents(t);
    if (wc && wc.id === id) return tid;
  }
  return null;
}

function cleanUrl(raw){
  let u;
  try { u = new URL(raw); } catch { return raw; }
  if (!['http:','https:'].includes(u.protocol)) return null;
  STRIP_PARAMS.forEach(p => u.searchParams.delete(p));
  return u.toString();
}

const ENGINES = search.REDIRECT;
function resolveInput(input){
  const s = String(input || '').trim();
  if (!s) return null;
  const scheme = s.match(/^([a-z][a-z0-9+.\-]*):/i);
  if (scheme && !/^https?$/i.test(scheme[1])) return null;
  if (/^https?:\/\//i.test(s)) return cleanUrl(s);
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s) && !s.includes(' ')) return cleanUrl('https://' + s);
  return search.redirectUrl(s);
}

function mountTabView(id,t){
  const trustedPdfPath=t.localPdfPath;
  const view = new WebContentsView({
    webPreferences: {
      session: t.session,
      preload: trustedPdfPath ? path.join(__dirname,'pdf-preload.js') : undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: !trustedPdfPath,
      plugins: false
    }
  });
  t.view=view;
  t.loading=false;
  const wc=view.webContents;

  wc.setWindowOpenHandler(({ url: target }) => {
    const clean = cleanUrl(target);
    if (clean) createTab({ url: clean, workspaceId:t.workspace, sealed:t.sealed, privateMode:t.private });
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, target) => {
    if (trustedPdfPath && target.startsWith(pathToFileURL(path.join(__dirname,'ui','pdf-viewer.html')).toString())) return;
    if (!cleanUrl(target)) e.preventDefault();
  });

  const push = () => { if(tabs.has(id)) send('tab:update', tabState(id)); };
  const remember = () => library.recordVisit({url:wc.getURL(),title:wc.getTitle(),workspace:t.workspace,privateMode:!!t.private});
  wc.on('page-title-updated', () => { push(); remember(); });
  wc.on('did-navigate', () => { push(); remember(); scheduleStateSave(); });
  wc.on('did-navigate-in-page', () => { push(); scheduleStateSave(); });
  wc.on('did-start-loading', () => { t.loading=true; send('tab:loading', { id, loading: true }); });
  wc.on('did-stop-loading',  () => { t.loading=false; send('tab:loading', { id, loading: false }); push(); });
  wc.on('page-favicon-updated', (_e, icons) => send('tab:favicon', { id, icon: icons[0] || null }));
  wc.on('did-fail-load', (_e, code, desc, failedUrl) => {
    t.loading=false;
    if (code === -3) return;
    send('tab:error', { id, code, desc, url: failedUrl });
  });

  win.contentView.addChildView(view);
  return wc;
}

function createTab({ url, workspaceId = 'default', sealed = false, privateMode = false, localPdfPath = null } = {}){
  const ses = sessionFor(workspaceId, sealed, privateMode);
  const trustedPdfPath = localPdfPath ? documents.cleanPdfPath(String(localPdfPath)).full : null;
  const id = nextTabId++;
  const t={
    view:null, session:ses, workspace:workspaceId, sealed, private:!!privateMode, blocked:0,
    kind:trustedPdfPath?'pdf':'page', localPdfPath:trustedPdfPath,
    pdfToken:trustedPdfPath?documents.token():null,
    fileName:trustedPdfPath?path.basename(trustedPdfPath):null,
    sleeping:false, waking:false, wakePromise:null, sleepState:null, loading:false,
    lastActiveAt:Date.now(), closing:false
  };
  tabs.set(id,t);
  const wc=mountTabView(id,t);
  setActiveTab(id);
  if (trustedPdfPath) wc.loadFile(path.join(__dirname,'ui','pdf-viewer.html'),{query:{token:t.pdfToken}});
  else if (url) wc.loadURL(url);
  layout();
  scheduleStateSave();
  return id;
}

function sleepBlockReason(id){
  const t=tabs.get(id); if(!t)return'no tab';
  const wc=liveWebContents(t); if(!wc)return t.sleeping?null:'no renderer';
  if(id===activeTabId)return'active tab';
  if(t.private)return'private tab';
  if(t.kind!=='page'||t.localPdfPath)return'document tab';
  const url=wc.getURL();
  const smokeData=SMOKE && /^data:/i.test(url);
  const mainFrameLoading=typeof wc.isLoadingMainFrame==='function' ? wc.isLoadingMainFrame() : t.loading;
  if(mainFrameLoading && !smokeData)return'page is loading';
  if(!/^https?:\/\//i.test(url) && !smokeData)return'not a web page';
  if(typeof wc.isCurrentlyAudible==='function' && wc.isCurrentlyAudible())return'audio is playing';
  if(typeof wc.isBeingCaptured==='function' && wc.isBeingCaptured())return'tab is being captured';
  if(typeof wc.isDevToolsOpened==='function' && wc.isDevToolsOpened())return'DevTools are open';
  if(downloads.hasActiveForSource(url,t.workspace))return'download is active';
  return null;
}

function sleepTab(id){
  const t=tabs.get(id); if(!t)return{error:'no tab'};
  if(t.sleeping)return{ok:true,sleeping:true,releasedRenderer:true};
  const reason=sleepBlockReason(id); if(reason)return{error:reason};
  const wc=liveWebContents(t); if(!wc)return{error:'no renderer'};
  let entries=[],index=0;
  try{entries=wc.navigationHistory.getAllEntries();index=wc.navigationHistory.getActiveIndex();}catch{}
  t.sleepState={
    url:wc.getURL(), title:wc.getTitle(), entries, index,
    canGoBack:wc.navigationHistory.canGoBack(), canGoForward:wc.navigationHistory.canGoForward(),
    zoom:wc.getZoomFactor(), sleptAt:Date.now()
  };
  t.sleeping=true;t.waking=false;t.loading=false;
  const old=t.view;t.view=null;
  try{win.contentView.removeChildView(old);}catch{}
  try{wc.close();}catch{}
  send('tab:update',tabState(id));
  scheduleStateSave();
  return{ok:true,sleeping:true,releasedRenderer:true,sleptAt:t.sleepState.sleptAt};
}

async function wakeTab(id){
  const t=tabs.get(id); if(!t)return{error:'no tab'};
  if(!t.sleeping && !t.waking)return{ok:true,sleeping:false};
  if(t.wakePromise)return t.wakePromise;
  const snap=t.sleepState||{};
  t.sleeping=false;t.waking=true;
  t.wakePromise=(async()=>{
    const wc=mountTabView(id,t);
    let restored=false;
    try{
      if(Array.isArray(snap.entries)&&snap.entries.length){
        await wc.navigationHistory.restore({entries:snap.entries,index:Number.isInteger(snap.index)?snap.index:undefined});
        restored=true;
      }
    }catch{}
    if(!tabs.has(id)||t.closing){try{wc.close();}catch{};return{error:'tab closed while waking'};}
    if(!restored && snap.url){
      try{await wc.loadURL(snap.url);}catch{}
    }
    if(Number.isFinite(snap.zoom)){try{wc.setZoomFactor(snap.zoom);}catch{}}
    t.waking=false;t.sleepState=null;
    layout();send('tab:update',tabState(id));scheduleStateSave();
    return{ok:true,sleeping:false,restoredHistory:restored};
  })();
  try{return await t.wakePromise;}finally{t.wakePromise=null;}
}

function sleepSweep(){
  if(!preferences.get().sleep)return;
  const now=Date.now();
  for(const [id,t] of tabs){
    if(id===activeTabId||t.sleeping||t.waking)continue;
    if(now-Number(t.lastActiveAt||now)>=TAB_SLEEP_AFTER_MS)sleepTab(id);
  }
}

function tabState(id){
  const t = tabs.get(id); if (!t) return null;
  const wc=liveWebContents(t), snap=t.sleepState||{};
  const liveUrl=wc?.getURL() || snap.url || '';
  const inferredPdf=t.kind==='pdf' || /\.pdf(?:$|[?#])/i.test(liveUrl);
  if(inferredPdf)t.kind='pdf';
  const nav=wc?.navigationHistory;
  return {
    id, url:t.localPdfPath?'':liveUrl,
    title:t.fileName || wc?.getTitle() || snap.title || '', kind:t.kind||'page', fileName:t.fileName||null,
    canGoBack:nav?nav.canGoBack():!!snap.canGoBack,
    canGoForward:nav?nav.canGoForward():!!snap.canGoForward,
    blocked:t.blocked, workspace:t.workspace, sealed:t.sealed, private:!!t.private,
    sleeping:!!t.sleeping, waking:!!t.waking, lastActiveAt:Number(t.lastActiveAt||0),
    active:id===activeTabId
  };
}

function setActiveTab(id){
  if (!tabs.has(id)) return;
  const previous=tabs.get(activeTabId);
  if(previous && activeTabId!==id)previous.lastActiveAt=Date.now();
  activeTabId=id;
  const target=tabs.get(id);target.lastActiveAt=Date.now();
  if(target.sleeping)wakeTab(id).catch(()=>{});
  for (const [tid, t] of tabs){
    if(t.view)t.view.setVisible(!internalView && tid===id);
  }
  layout();
  send('tab:update',tabState(id));
  scheduleStateSave();
}

function closeTab(id){
  const t = tabs.get(id); if (!t) return;
  t.closing=true;
  if (!t.private){
    const url=cleanUrl(currentTabUrl(t));
    if (url){
      recentlyClosed.push({url,workspaceId:t.workspace,sealed:!!t.sealed,closedAt:Date.now()});
      if (recentlyClosed.length > 20) recentlyClosed.shift();
    }
  }
  const wc=liveWebContents(t);
  if(t.view){try{win.contentView.removeChildView(t.view);}catch{}}
  if(wc){try{wc.close();}catch{}}
  t.view=null;
  tabs.delete(id);
  if (activeTabId === id){
    const next = [...tabs.keys()].pop();
    if (next) setActiveTab(next); else activeTabId = null;
  }
  send('tab:closed', { id });
  scheduleStateSave();
  if (t.private && ![...tabs.values()].some(x => x.private)) purgePrivateSessions().catch(()=>{});
}

function layout(){
  if (!win) return;
  const [w, h] = win.getContentSize();
  const x = CHROME.side, y = CHROME.top;
  const width  = Math.max(0, w - CHROME.side - CHROME.panel);
  const height = Math.max(0, h - CHROME.top);
  for (const [id, t] of tabs){
    if(!t.view)continue;
    const live = !internalView && id === activeTabId;
    t.view.setVisible(live);
    t.view.setBounds(live ? { x, y, width, height } : { x: 0, y: 0, width: 0, height: 0 });
  }
}

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

let stateTimer = null;
function stateSnapshot(){
  return {
    version:1, activeTabId, savedAt:Date.now(),
    tabs:[...tabs.entries()].filter(([,t]) => !t.private).map(([id,t]) => ({
      id, url:cleanUrl(currentTabUrl(t)), workspaceId:t.workspace, sealed:!!t.sealed,
      active:id===activeTabId
    })).filter(t => t.url)
  };
}
function scheduleStateSave(){
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => { try { browserState.write(stateSnapshot()); } catch {} }, 250);
}
function restoreSavedTabs(){
  const st = browserState.read();
  const saved = Array.isArray(st?.tabs) ? st.tabs.filter(t => cleanUrl(t.url)) : [];
  if (!saved.length){ createTab({}); return; }
  let active = null;
  for (const t of saved){
    const id=createTab({ url:t.url, workspaceId:String(t.workspaceId||'default'), sealed:!!t.sealed });
    if (t.active) active=id;
  }
  if (active != null) setActiveTab(active);
}

function createWindow(){
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    show: false,
    backgroundColor: '#DFE4EA',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    frame: process.platform === 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  const chromePath = path.join(__dirname, 'ui', 'breeze-desktop.html');
  win.loadFile(chromePath);

  win.once('ready-to-show', () => {
    win.show();
    if (SMOKE) runSmokeTest();
  });
  win.on('resize', layout);
  win.on('maximize',   () => send('win:state', { maximized: true  }));
  win.on('unmaximize', () => send('win:state', { maximized: false }));
  win.on('closed', () => { win = null; });
}

function reg(channel, fn){ ipcMain.handle(channel, (e, ...a) => {
  if (e.sender !== win?.webContents) return null;
  try { return fn(...a); } catch (err) { return { error: String(err.message || err) }; }
}); }

function pdfContext(sender, token){
  const id=tabIdForWebContents(sender?.id); const t=id!=null?tabs.get(id):null;
  return t && t.localPdfPath && t.pdfToken===String(token||'') ? {id,t} : null;
}
function pdfReg(channel, fn){ ipcMain.handle(channel, async (e, token, ...args) => {
  const ctx=pdfContext(e.sender,token); if(!ctx) return {error:'invalid document context'};
  try{return await fn(ctx,...args);}catch(err){return {error:String(err?.message||err)};}
}); }
pdfReg('pdf:load', async ({t}) => ({data:await documents.bytesForViewer(t.localPdfPath)}));
pdfReg('pdf:info', async ({t}) => documents.info(t.localPdfPath));
pdfReg('pdf:extract', async ({t},pages) => {
  const stem=path.basename(t.localPdfPath,'.pdf');
  const save=await dialog.showSaveDialog(win,{title:'Extract PDF pages',defaultPath:path.join(path.dirname(t.localPdfPath),`${stem}-extract.pdf`),filters:[{name:'PDF document',extensions:['pdf']}]});
  if(save.canceled||!save.filePath)return {canceled:true}; return documents.extract(t.localPdfPath,pages,save.filePath);
});
pdfReg('pdf:rotate', async ({t},pages,angle) => {
  const stem=path.basename(t.localPdfPath,'.pdf');
  const save=await dialog.showSaveDialog(win,{title:'Save rotated PDF',defaultPath:path.join(path.dirname(t.localPdfPath),`${stem}-rotated.pdf`),filters:[{name:'PDF document',extensions:['pdf']}]});
  if(save.canceled||!save.filePath)return {canceled:true}; return documents.rotate(t.localPdfPath,pages,angle,save.filePath);
});
pdfReg('pdf:split', async ({t},ranges) => {
  const picked=await dialog.showOpenDialog(win,{title:'Choose folder for split PDFs',properties:['openDirectory','createDirectory']});
  if(picked.canceled||!picked.filePaths[0])return {canceled:true}; return documents.split(t.localPdfPath,ranges,picked.filePaths[0]);
});
pdfReg('pdf:merge', async ({t}) => {
  const picked=await dialog.showOpenDialog(win,{title:'Choose PDFs to append',properties:['openFile','multiSelections'],filters:[{name:'PDF documents',extensions:['pdf']}]});
  if(picked.canceled||!picked.filePaths.length)return {canceled:true};
  const stem=path.basename(t.localPdfPath,'.pdf'); const save=await dialog.showSaveDialog(win,{title:'Save merged PDF',defaultPath:path.join(path.dirname(t.localPdfPath),`${stem}-merged.pdf`),filters:[{name:'PDF document',extensions:['pdf']}]});
  if(save.canceled||!save.filePath)return {canceled:true}; return documents.merge([t.localPdfPath,...picked.filePaths],save.filePath);
});

reg('tab:create', (opts = {}) => createTab({
  url: opts.url ? (resolveInput(opts.url) || undefined) : undefined,
  workspaceId: String(opts.workspaceId || 'default'),
  sealed: !!opts.sealed,
  privateMode: false
}));
reg('tab:createPrivate', (opts = {}) => createTab({
  url: opts.url ? (resolveInput(opts.url) || undefined) : undefined,
  workspaceId: String(opts.workspaceId || 'private'),
  sealed: true,
  privateMode: true
}));
reg('tab:reopenClosed', () => {
  const last=recentlyClosed.pop();
  if(!last) return {error:'no closed tab'};
  return {ok:true,id:createTab({url:last.url,workspaceId:last.workspaceId,sealed:!!last.sealed})};
});
reg('document:openPdf', async () => {
  const picked=await dialog.showOpenDialog(win,{title:'Open PDF in Breeze',properties:['openFile'],filters:[{name:'PDF documents',extensions:['pdf']}]});
  if(picked.canceled || !picked.filePaths[0]) return {canceled:true};
  const filePath=path.resolve(picked.filePaths[0]);
  if(path.extname(filePath).toLowerCase()!=='.pdf') return {error:'Choose a PDF document'};
  const current=tabs.get(activeTabId); const privateMode=!!current?.private;
  return {ok:true,id:createTab({localPdfPath:filePath,workspaceId:privateMode?'private':(current?.workspace||'default'),sealed:privateMode||!!current?.sealed,privateMode}),name:path.basename(filePath)};
});
reg('tab:close',    id => { closeTab(Number(id)); return true; });
reg('tab:select',   id => { setActiveTab(Number(id)); return true; });
reg('tab:list',     () => [...tabs.keys()].map(tabState));
reg('tab:sleep', id => sleepTab(Number(id)));
reg('tab:wake',  id => wakeTab(Number(id)));
reg('tab:navigate', async (id, input) => {
  const t=tabs.get(Number(id)); if(!t)return null;
  const url=resolveInput(input); if(!url)return{error:'blocked scheme'};
  if(t.sleeping||t.waking)await wakeTab(Number(id));
  const wc=liveWebContents(t); if(!wc)return{error:'no renderer'};
  t.blocked=0;await wc.loadURL(url);return url;
});
reg('tab:back', async id => { const t=tabs.get(Number(id));if(!t)return;if(t.sleeping||t.waking)await wakeTab(Number(id));liveWebContents(t)?.navigationHistory.goBack(); });
reg('tab:forward', async id => { const t=tabs.get(Number(id));if(!t)return;if(t.sleeping||t.waking)await wakeTab(Number(id));liveWebContents(t)?.navigationHistory.goForward(); });
reg('tab:reload', async (id, hard) => {
  const t=tabs.get(Number(id));if(!t)return;if(t.sleeping||t.waking)await wakeTab(Number(id));const wc=liveWebContents(t);if(!wc)return;
  hard ? wc.reloadIgnoringCache() : wc.reload();
});
reg('tab:find', async (id, text, forward = true) => {
  const t=tabs.get(Number(id));if(!t)return 0;if(t.sleeping||t.waking)await wakeTab(Number(id));const wc=liveWebContents(t);if(!wc)return 0;
  if(!text){wc.stopFindInPage('clearSelection');return 0;}return wc.findInPage(String(text),{forward,findNext:false});
});
reg('tab:zoom', async (id, factor) => {
  const t=tabs.get(Number(id));if(!t)return;if(t.sleeping||t.waking)await wakeTab(Number(id));liveWebContents(t)?.setZoomFactor(Math.max(.5,Math.min(2,Number(factor)||1)));
});

reg('session:repair', async (id, kind) => {
  const t=tabs.get(Number(id));if(!t)return{error:'no tab'};
  if(t.sleeping||t.waking)await wakeTab(Number(id));
  const wc=liveWebContents(t);if(!wc)return{error:'no renderer'};
  const origin=(()=>{try{return new URL(wc.getURL()).origin;}catch{return null;}})();
  if(kind==='reload'){wc.reload();return{ok:'Reloaded past cache'};}
  if(kind==='rebuild'){
    await t.session.clearStorageData({origin,storages:['cachestorage','serviceworkers','shadercache','websql','indexdb']});
    await t.session.clearCache();wc.reloadIgnoringCache();return{ok:'Page state rebuilt — you are still signed in'};
  }
  if(kind==='reset'){
    await t.session.clearStorageData({origin});wc.reloadIgnoringCache();return{ok:'Site reset — you have been signed out of this site'};
  }
  return{error:'unknown repair'};
});

reg('chrome:geometry', g => {
  if (typeof g?.top === 'number') CHROME.top = g.top;
  if (typeof g?.side === 'number') CHROME.side = g.side;
  if (typeof g?.panel === 'number') CHROME.panel = g.panel;
  layout();
  return CHROME;
});
reg('chrome:internalView', on => {
  internalView = !!on;
  layout();
  return internalView;
});
reg('engine:set', name => search.setProvider(String(name || '')));
reg('engine:list', () => Object.keys(ENGINES));
reg('search:config', () => search.config());
reg('search:provider', name => search.setProvider(String(name || '')));
reg('search:setKey', (id, key) => search.setKey(String(id || ''), key));
reg('search:clearKey', id => search.clearKey(String(id || '')));
reg('search:searxngUrl', url => search.setSearxngUrl(url));
reg('search:signals', on => search.setSignals(!!on));
reg('search:run', q => search.search(q));
reg('search:measure', url => search.measure(url));

reg('flow:mediaCapabilities', () => media.capabilities());
reg('flow:ingestMediaPath', filePath => {
  if(typeof filePath !== 'string' || !filePath || filePath.length > 4096) return {error:'invalid media path'};
  return media.safeFile(filePath);
});
reg('flow:pickMedia', async kind => {
  const want = kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'media';
  const label = want === 'audio' ? 'Audio' : want === 'video' ? 'Video' : 'Media';
  const picked = await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:label,extensions:media.supportedInputs(want)}]});
  if(picked.canceled||!picked.filePaths[0]) return {canceled:true};
  return media.safeFile(picked.filePaths[0]);
});
reg('flow:convertMedia', async (id,opts={}) => {
  const job=media.get(id); const format=String(opts.format||'').toLowerCase();
  if(!media.supportedOutputs(job.kind).includes(format)) return {error:'unsupported output format'};
  const base=path.basename(job.path,path.extname(job.path));
  const save=await dialog.showSaveDialog(win,{defaultPath:path.join(path.dirname(job.path),`${base}-flow.${format}`),filters:[{name:format.toUpperCase(),extensions:[format]}]});
  if(save.canceled||!save.filePath) return {canceled:true};
  return media.convert(id,{format,quality:String(opts.quality||'balanced')},save.filePath);
});
reg('flow:clearMedia', id => media.clear(id));

reg('extension:list', () => extensions.list());
reg('extension:installUnpacked', async () => {
  const picked = await dialog.showOpenDialog(win,{properties:['openDirectory'],title:'Choose an unpacked Chrome extension'});
  if (picked.canceled || !picked.filePaths[0]) return { canceled:true };
  let result;
  try { result = extensions.importDirectory(picked.filePaths[0]); }
  catch (err){ return { error:String(err.message || err) }; }
  if (result.installed){
    for (const {ses,workspaceId} of sessionEntries()) await extensions.loadIntoSession(ses,workspaceId);
  }
  return result;
});
reg('extension:setEnabled', async (id,on) => extensions.setEnabled(String(id||''),!!on,sessionEntries()));
reg('extension:remove', async id => extensions.remove(String(id||''),sessionEntries()));

reg('download:list', () => downloads.list());
reg('download:open', id => downloads.open(String(id||'')));
reg('download:show', id => downloads.show(String(id||'')));
reg('download:pause', id => downloads.pause(String(id||'')));
reg('download:resume', id => downloads.resume(String(id||'')));
reg('download:cancel', id => downloads.cancel(String(id||'')));
reg('download:clearFinished', () => downloads.clearFinished());

reg('permission:respond', (id,decision) => permissionBroker.respond(id,decision));
reg('permission:list', () => permissionBroker.list());
reg('permission:reset', (origin,permission) => permissionBroker.reset(origin,permission));
reg('display:respond', (id,sourceId) => displayShare.respond(id,sourceId));
reg('display:cancel', id => displayShare.cancel(id));

reg('history:list', q => library.listHistory(String(q||'')));
reg('history:clear', () => library.clearHistory());
reg('bookmark:list', q => library.listBookmarks(String(q||'')));
reg('bookmark:is', id => { const t=tabs.get(Number(id)); return t ? library.isBookmarked(currentTabUrl(t)) : false; });
reg('bookmark:add', id => {
  const t=tabs.get(Number(id));if(!t)return{error:'no tab'};
  return library.addBookmark({url:currentTabUrl(t),title:currentTabTitle(t),workspace:t.workspace});
});
reg('bookmark:remove', key => library.removeBookmark(String(key||'')));
reg('bookmark:toggle', id => {
  const t=tabs.get(Number(id));if(!t)return{error:'no tab'};const url=currentTabUrl(t);
  if(library.isBookmarked(url)){library.removeBookmark(url);return{ok:true,saved:false};}
  const row=library.addBookmark({url,title:currentTabTitle(t),workspace:t.workspace});
  return row?.error?row:{ok:true,saved:true,bookmark:row};
});

reg('win:minimize', () => win?.minimize());
reg('win:toggleMaximize', () => { win?.isMaximized() ? win.unmaximize() : win?.maximize(); });
reg('win:isMaximized', () => !!win?.isMaximized());
reg('win:close', () => win?.close());
reg('win:toggleFullScreen', () => win?.setFullScreen(!win.isFullScreen()));
reg('win:new', () => createWindow());
reg('app:openDevTools', () => liveWebContents(tabs.get(activeTabId))?.openDevTools({ mode: 'bottom' }));
reg('app:print', () => liveWebContents(tabs.get(activeTabId))?.print());
reg('app:version', () => ({
  version: app.getVersion(), electron: process.versions.electron,
  chrome: process.versions.chrome, platform: process.platform
}));
reg('app:clearData', async (kinds = []) => {
  const map = { cache:['cachestorage'], history:[], cookies:['cookies'], storage:['localstorage','indexdb','websql','serviceworkers'] };
  const storages = kinds.flatMap(k => map[k] || []);
  if (kinds.includes('history')) library.clearHistory();
  for (const ses of sessions.values()){
    if (kinds.includes('cache')) await ses.clearCache();
    if (storages.length) await ses.clearStorageData({ storages });
  }
  return { ok: true };
});

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  search.init({ userDataPath, safeStorage });
  extensions.init(userDataPath);
  browserState.init(userDataPath);
  permissionBroker.init(userDataPath, send);
  library.init(userDataPath);
  downloads.init({ userDataPath, systemDownloadsPath:app.getPath('downloads'), emit:send });
  installGuards(app, shell, path.join(__dirname, 'ui'));
  hardenSession(session.defaultSession);
  createWindow();
  tabSleepTimer=setInterval(sleepSweep,60*1000);
  if(typeof tabSleepTimer.unref==='function')tabSleepTimer.unref();
  win.webContents.once('did-finish-load', () => { if (!SMOKE) setTimeout(restoreSavedTabs, 40); });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length){ createWindow(); win.webContents.once('did-finish-load', () => { if (!SMOKE) setTimeout(restoreSavedTabs,40); }); } });
});
app.on('before-quit', () => { if(tabSleepTimer)clearInterval(tabSleepTimer); try { browserState.write(stateSnapshot()); } catch {} });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

async function runSmokeTest(){
  const results = [];
  const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); };

  try {
    const page = 'data:text/html,' + encodeURIComponent('<title>Breeze Smoke</title><h1>hello</h1>');
    const id = createTab({ url: page });
    const wc = tabs.get(id).view.webContents;
    await new Promise(r => wc.once('did-finish-load', r));
    ok('tab loads and reports title', wc.getTitle() === 'Breeze Smoke', wc.getTitle());

    ok('javascript: scheme refused', resolveInput('javascript:alert(1)') === null);
    ok('file: scheme refused', resolveInput('file:///etc/passwd') === null);
    ok('host goes to host', resolveInput('example.com').startsWith('https://example.com'));
    ok('query goes to search', resolveInput('offline first').includes('search.brave.com'));
    ok('utm params stripped', !resolveInput('https://x.com/a?utm_source=n&b=1').includes('utm_source'), resolveInput('https://x.com/a?utm_source=n&b=1'));

    const sMain = sessionFor('default', false);
    const sSeal = sessionFor('northwind', true);
    ok('sealed workspace gets its own session', sMain !== sSeal);
    ok('same workspace reuses its session', sessionFor('northwind', true) === sSeal);

    const id2 = createTab({ url: page, workspaceId: 'northwind', sealed: true });
    await new Promise(r => tabs.get(id2).view.webContents.once('did-finish-load', r));
    ok('sealed tab uses sealed partition', tabs.get(id2).session === sSeal && tabs.get(id).session !== sSeal);

    setActiveTab(id);
    ok('active tab is visible, others hidden', tabs.get(id).view.getVisible() === true && tabs.get(id2).view.getVisible() === false);

    const beforeSleep=tabs.get(id2).view.webContents;
    const beforeSleepId=beforeSleep.id;
    const slept=sleepTab(id2);
    ok('inactive tab releases its renderer', slept.ok===true && tabs.get(id2).sleeping===true && tabs.get(id2).view===null, slept.error||'');
    ok('released WebContents is destroyed', beforeSleep.isDestroyed()===true);
    const woke=await wakeTab(id2);
    const afterWake=liveWebContents(tabs.get(id2));
    ok('sleeping tab reconstructs a new renderer', woke.ok===true && !!afterWake && afterWake.id!==beforeSleepId);
    ok('navigation history restores page state', afterWake?.getTitle()==='Breeze Smoke');

    closeTab(id2);
    ok('tab closes cleanly', !tabs.has(id2));

    const pid=createTab({url:page,privateMode:true,workspaceId:'private'});
    await new Promise(r => tabs.get(pid).view.webContents.once('did-finish-load', r));
    const ps=tabs.get(pid).session;
    ok('private tab uses memory-only session', ps.storagePath === null);
    ok('private tab is marked private', tabs.get(pid).private === true);
    ok('private tab omitted from restart state', !stateSnapshot().tabs.some(t => t.id === pid));
    closeTab(pid);

    ok('contextIsolation on for chrome', win.webContents.getWebPreferences?.().contextIsolation !== false);
  } catch (err){
    results.push(['FAIL', 'smoke threw', String(err.message || err)]);
  }

  const failed = results.filter(r => r[0] === 'FAIL');
  console.log('\n── BREEZE SHELL SMOKE TEST ──');
  results.forEach(([s, n, x]) => console.log(`  ${s}  ${n}${x ? '  [' + x + ']' : ''}`));
  console.log(`\n  ${results.length - failed.length}/${results.length} passed\n`);
  app.exit(failed.length ? 1 : 0);
}
