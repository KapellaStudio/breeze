#!/usr/bin/env python3
from pathlib import Path

p=Path('shell/main.js')
s=p.read_text(encoding='utf-8')

def between(start,end,new):
    global s
    a=s.index(start); b=s.index(end,a)
    s=s[:a]+new+s[b:]

def must(old,new):
    global s
    if old not in s: raise SystemExit('missing anchor: '+old[:90])
    s=s.replace(old,new,1)

must("const downloads = require('./downloads');\n", "const downloads = require('./downloads');\nconst preferences = require('./preferences');\n")
must("const recentlyClosed = [];          // normal tabs only; private tabs never enter recovery\n", "const recentlyClosed = [];          // normal tabs only; private tabs never enter recovery\nconst TAB_SLEEP_AFTER_MS = 30 * 60 * 1000;\nlet tabSleepTimer = null;\n")

between("function downloadContextForWebContents(wcId){", "function sessionEntries(){", r'''function liveWebContents(t){
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
''')

between("function tabIdForWebContents(id){", "/* ── url handling", r'''function tabIdForWebContents(id){
  for (const [tid, t] of tabs){
    const wc=liveWebContents(t);
    if (wc && wc.id === id) return tid;
  }
  return null;
}

''')

between("function createTab({", "function tabState(id){", r'''function mountTabView(id,t){
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
  if(t.loading)return'page is loading';
  const url=wc.getURL();
  if(!/^https?:\/\//i.test(url) && !(SMOKE && /^data:/i.test(url)))return'not a web page';
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

''')

between("function tabState(id){", "function setActiveTab(id){", r'''function tabState(id){
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

''')

between("function setActiveTab(id){", "function closeTab(id){", r'''function setActiveTab(id){
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

''')

between("function closeTab(id){", "/* ── layout", r'''function closeTab(id){
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

''')

between("function layout(){", "const send =", r'''function layout(){
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

''')

between("function stateSnapshot(){", "function scheduleStateSave(){", r'''function stateSnapshot(){
  return {
    version:1, activeTabId, savedAt:Date.now(),
    tabs:[...tabs.entries()].filter(([,t]) => !t.private).map(([id,t]) => ({
      id, url:cleanUrl(currentTabUrl(t)), workspaceId:t.workspace, sealed:!!t.sealed,
      active:id===activeTabId
    })).filter(t => t.url)
  };
}
''')

between("reg('tab:navigate',", "/* Session recovery", r'''reg('tab:sleep', id => sleepTab(Number(id)));
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

''')

between("reg('session:repair',", "reg('chrome:geometry'", r'''reg('session:repair', async (id, kind) => {
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

''')

between("reg('bookmark:is',", "reg('win:minimize'", r'''reg('bookmark:is', id => { const t=tabs.get(Number(id)); return t ? library.isBookmarked(currentTabUrl(t)) : false; });
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

''')

must("reg('app:openDevTools',   () => tabs.get(activeTabId)?.view.webContents.openDevTools({ mode: 'bottom' }));\nreg('app:print',          () => tabs.get(activeTabId)?.view.webContents.print());\n", "reg('app:openDevTools',   () => liveWebContents(tabs.get(activeTabId))?.openDevTools({ mode: 'bottom' }));\nreg('app:print',          () => liveWebContents(tabs.get(activeTabId))?.print());\n")

must("  createWindow();\n  win.webContents.once('did-finish-load', () => { if (!SMOKE) setTimeout(restoreSavedTabs, 40); });\n", "  createWindow();\n  tabSleepTimer=setInterval(sleepSweep,60*1000);\n  if(typeof tabSleepTimer.unref==='function')tabSleepTimer.unref();\n  win.webContents.once('did-finish-load', () => { if (!SMOKE) setTimeout(restoreSavedTabs, 40); });\n")
must("app.on('before-quit', () => { try { browserState.write(stateSnapshot()); } catch {} });\n", "app.on('before-quit', () => { if(tabSleepTimer)clearInterval(tabSleepTimer); try { browserState.write(stateSnapshot()); } catch {} });\n")

old="""    setActiveTab(id);\n    ok('active tab is visible, others hidden',\n       tabs.get(id).view.getVisible() === true && tabs.get(id2).view.getVisible() === false);\n\n    closeTab(id2);\n"""
new="""    setActiveTab(id);\n    ok('active tab is visible, others hidden',\n       tabs.get(id).view.getVisible() === true && tabs.get(id2).view.getVisible() === false);\n\n    const beforeSleep=tabs.get(id2).view.webContents;\n    const beforeSleepId=beforeSleep.id;\n    const slept=sleepTab(id2);\n    ok('inactive tab releases its renderer', slept.ok===true && tabs.get(id2).sleeping===true && tabs.get(id2).view===null);\n    ok('released WebContents is destroyed', beforeSleep.isDestroyed()===true);\n    const woke=await wakeTab(id2);\n    const afterWake=liveWebContents(tabs.get(id2));\n    ok('sleeping tab reconstructs a new renderer', woke.ok===true && !!afterWake && afterWake.id!==beforeSleepId);\n    ok('navigation history restores page state', afterWake?.getTitle()==='Breeze Smoke');\n\n    closeTab(id2);\n"""
must(old,new)

p.write_text(s,encoding='utf-8',newline='\n')
print('Applied true tab sleeping refactor to shell/main.js')
