/* ═══════════════════════════════════════════════════════════════════════════
   BREEZE — PRELOAD
   The ONLY channel between Breeze's chrome and the main process.

   contextIsolation is on, so the page's JavaScript cannot reach Node, cannot
   reach `require`, and cannot reach ipcRenderer. It gets exactly the methods
   listed here and nothing else. Every one is a named function — no generic
   `invoke(channel, ...args)` passthrough, because that would hand a chrome
   XSS the entire main process.

   This is the object `breeze-core.js` looks for as window.__BREEZE_SHELL__.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

/* Event subscription is also allowlisted. A page cannot listen to arbitrary
   IPC channels, only the handful the UI genuinely renders. */
const EVENTS = ['tab:update','tab:loading','tab:closed','tab:favicon','tab:error','win:state','download:update','download:refresh','permission:request','display:request'];
const listeners = new Map();
let activeWorkspace = { workspaceId:'default', sealed:false };

EVENTS.forEach(ch => {
  ipcRenderer.on(ch, (_e, payload) => {
    if(ch==='tab:update' && payload?.active && !payload.private){
      activeWorkspace={workspaceId:String(payload.workspace||'default'),sealed:!!payload.sealed};
    }
    (listeners.get(ch) || []).forEach(fn => { try { fn(payload); } catch {} });
  });
});

contextBridge.exposeInMainWorld('__BREEZE_SHELL__', {
  /* identity */
  isShell: true,
  version: () => call('app:version'),

  /* first run / move to Breeze */
  firstRunStatus: () => call('launch:status'),
  completeFirstRun: () => call('launch:complete'),
  resetFirstRun: () => call('launch:reset'),
  detectImportSources: () => call('launch:sources'),
  importBrowserData: (browser, options) => call('launch:importBrowser', browser, options || {}),
  importBookmarksFile: () => call('launch:importBookmarksHtml'),
  exportBookmarksFile: () => call('launch:exportBookmarksHtml'),
  defaultBrowserStatus: () => call('launch:defaultStatus'),
  requestDefaultBrowser: () => call('launch:requestDefault'),
  openDefaultBrowserSettings: () => call('launch:openDefaultSettings'),

  /* persistent chrome preferences */
  getPreferences: () => call('prefs:get'),
  setPreference: (key,value) => call('prefs:set', key, value),
  setPreferences: patch => call('prefs:setMany', patch || {}),
  resetPreferences: () => call('prefs:reset'),

  /* persistent workspaces */
  listWorkspaces: () => call('workspace:list'),
  getWorkspace: id => call('workspace:get', id),
  createWorkspace: opts => call('workspace:create', opts || {}),
  updateWorkspace: (id,patch) => call('workspace:update', id, patch || {}),
  removeWorkspace: id => call('workspace:remove', id),

  /* tabs. A plain New Tab inherits the active non-private workspace so the
     workspace boundary is not silently lost through a keyboard/menu action. */
  newTab: opts => call('tab:create', { ...activeWorkspace, ...(opts || {}) }),
  newPrivateTab: opts => call('tab:createPrivate', opts || {}),
  reopenClosedTab: () => call('tab:reopenClosed'),
  openPdf: () => call('document:openPdf'),
  closeTab:  id   => call('tab:close', id),
  selectTab: id   => call('tab:select', id),
  listTabs:  ()   => call('tab:list'),
  navigate:  (id, input) => call('tab:navigate', id, input),
  back:      id => call('tab:back', id),
  forward:   id => call('tab:forward', id),
  reload:    (id, hard) => call('tab:reload', id, !!hard),
  find:      (id, text, forward) => call('tab:find', id, text, forward !== false),
  setZoom:   (id, factor) => call('tab:zoom', id, factor),

  /* session recovery — 'reload' | 'rebuild' | 'reset' */
  repairSession: (id, kind) => call('session:repair', id, kind),

  /* chrome geometry: the renderer owns layout, the main process owns bounds */
  reportGeometry: g => call('chrome:geometry', g),
  setInternalView: on => call('chrome:internalView', !!on),

  /* search */
  setEngine:    name => call('engine:set', name),
  listEngines:  ()   => call('engine:list'),
  searchConfig: ()   => call('search:config'),
  setSearchProvider: id  => call('search:provider', id),
  setSearchKey:      (id, key) => call('search:setKey', id, key),
  clearSearchKey:    id  => call('search:clearKey', id),
  setSearxngUrl:     url => call('search:searxngUrl', url),
  setSearchSignals:  on  => call('search:signals', !!on),
  runSearch:         q   => call('search:run', q),
  measureResult:     url => call('search:measure', url),

  /* Breeze Flow — media paths stay in the main process */
  mediaCapabilities: () => call('flow:mediaCapabilities'),
  ingestMediaFile:  file => {
    try {
      const filePath = webUtils.getPathForFile(file);
      return filePath ? call('flow:ingestMediaPath', filePath) : Promise.resolve({ error:'That file is not backed by a desktop path' });
    } catch { return Promise.resolve({ error:'Could not read that desktop file' }); }
  },
  pickMedia:        kind => call('flow:pickMedia', kind),
  convertMedia:     (id, opts) => call('flow:convertMedia', id, opts || {}),
  clearMedia:       id => call('flow:clearMedia', id),

  /* extensions — managed locally by Breeze */
  listExtensions:      () => call('extension:list'),
  installUnpacked:     () => call('extension:installUnpacked'),
  setExtensionEnabled:(id,on) => call('extension:setEnabled', id, !!on),
  removeExtension:     id => call('extension:remove', id),

  /* downloads — the renderer never receives filesystem paths */
  listDownloads:       () => call('download:list'),
  openDownload:        id => call('download:open', id),
  showDownload:        id => call('download:show', id),
  pauseDownload:       id => call('download:pause', id),
  resumeDownload:      id => call('download:resume', id),
  cancelDownload:      id => call('download:cancel', id),
  clearDownloadHistory:() => call('download:clearFinished'),

  /* site permissions */
  respondPermission: (id,decision) => call('permission:respond', id, decision),
  listPermissions:   () => call('permission:list'),
  resetPermission:   (origin,permission) => call('permission:reset', origin, permission),
  respondDisplayShare: (id,sourceId) => call('display:respond', id, sourceId),
  cancelDisplayShare: id => call('display:cancel', id),

  /* local history + bookmarks */
  historyList: q => call('history:list', q || ''),
  clearHistory: () => call('history:clear'),
  bookmarkList: q => call('bookmark:list', q || ''),
  isBookmarked: id => call('bookmark:is', id),
  addBookmark: id => call('bookmark:add', id),
  removeBookmark: key => call('bookmark:remove', key),
  toggleBookmark: id => call('bookmark:toggle', id),

  /* window controls */
  minimize:         () => call('win:minimize'),
  toggleMaximize:   () => call('win:toggleMaximize'),
  isMaximized:      () => call('win:isMaximized'),
  close:            () => call('win:close'),
  toggleFullScreen: () => call('win:toggleFullScreen'),
  newWindow:        () => call('win:new'),

  /* app */
  openDevTools: () => call('app:openDevTools'),
  print:        () => call('app:print'),
  clearData:    kinds => call('app:clearData', kinds),

  /* events */
  on(channel, fn){
    if (!EVENTS.includes(channel) || typeof fn !== 'function') return () => {};
    const arr = listeners.get(channel) || [];
    arr.push(fn); listeners.set(channel, arr);
    return () => listeners.set(channel, (listeners.get(channel) || []).filter(f => f !== fn));
  }
});
