/* ═══════════════════════════════════════════════════════════════════════════
   BREEZE — PRELOAD
   Narrow, named bridge from trusted Breeze chrome to the main process.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const EVENTS = ['tab:update','tab:loading','tab:closed','tab:favicon','tab:error','win:state','download:update','download:refresh','permission:request','display:request'];
const listeners = new Map();
let activeWorkspace = { workspaceId:'default', sealed:false };
let activePrivate = false;

EVENTS.forEach(ch => {
  ipcRenderer.on(ch, (_e, payload) => {
    if(ch==='tab:update' && payload?.active){
      activePrivate=!!payload.private;
      if(!payload.private) activeWorkspace={workspaceId:String(payload.workspace||'default'),sealed:!!payload.sealed};
    }
    (listeners.get(ch) || []).forEach(fn => { try { fn(payload); } catch {} });
  });
});

contextBridge.exposeInMainWorld('__BREEZE_SHELL__', {
  isShell: true,
  version: () => call('app:version'),

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

  getPreferences: () => call('prefs:get'),
  setPreference: (key,value) => call('prefs:set', key, value),
  setPreferences: patch => call('prefs:setMany', patch || {}),
  resetPreferences: () => call('prefs:reset'),
  currentWeather: unit => call('weather:current', unit),

  /* Omnibox privacy state is captured from trusted main-process tab updates.
     Callers cannot opt a Private tab into remote keystroke suggestions. */
  resolveOmnibox: value => call('omnibox:resolve', value),
  omniboxShortcuts: () => call('omnibox:shortcuts'),
  omniboxSuggestions: query => call('omnibox:suggest', query, activePrivate),

  listWorkspaces: () => call('workspace:list'),
  getWorkspace: id => call('workspace:get', id),
  createWorkspace: opts => call('workspace:create', opts || {}),
  updateWorkspace: (id,patch) => call('workspace:update', id, patch || {}),
  removeWorkspace: id => call('workspace:remove', id),

  listQueue: workspace => call('queue:list', workspace || ''),
  addQueue: item => call('queue:add', item || {}),
  removeQueue: id => call('queue:remove', id),
  moveQueueTop: id => call('queue:top', id),
  clearQueue: workspace => call('queue:clear', workspace || 'default'),
  listNotes: workspace => call('note:list', workspace || ''),
  addNote: item => call('note:add', item || {}),
  updateNote: (id,body) => call('note:update', id, body),
  removeNote: id => call('note:remove', id),
  listSnapshots: workspace => call('snapshot:list', workspace || ''),
  saveSnapshot: item => call('snapshot:save', item || {}),
  removeSnapshot: id => call('snapshot:remove', id),

  vaultStatus: () => call('vault:status'),
  vaultList: q => call('vault:list', q || ''),
  vaultAdd: item => call('vault:add', item || {}),
  vaultUpdate: (id,patch) => call('vault:update', id, patch || {}),
  vaultRemove: id => call('vault:remove', id),
  vaultCopyUsername: id => call('vault:copyUsername', id),
  vaultCopyPassword: id => call('vault:copyPassword', id),
  vaultImportCsv: () => call('vault:importCsv'),

  newTab: opts => call('tab:create', { ...activeWorkspace, ...(opts || {}) }),
  newPrivateTab: opts => call('tab:createPrivate', opts || {}),
  reopenClosedTab: () => call('tab:reopenClosed'),
  openPdf: () => call('document:openPdf'),
  closeTab: id => call('tab:close', id),
  selectTab: id => call('tab:select', id),
  listTabs: () => call('tab:list'),
  sleepTab: id => call('tab:sleep', id),
  wakeTab: id => call('tab:wake', id),
  navigate: (id, input) => call('tab:navigate', id, input),
  back: id => call('tab:back', id),
  forward: id => call('tab:forward', id),
  reload: (id, hard) => call('tab:reload', id, !!hard),
  find: (id, text, forward) => call('tab:find', id, text, forward !== false),
  setZoom: (id, factor) => call('tab:zoom', id, factor),
  repairSession: (id, kind) => call('session:repair', id, kind),
  reportGeometry: g => call('chrome:geometry', g),
  setInternalView: on => call('chrome:internalView', !!on),

  setEngine: name => call('engine:set', name),
  listEngines: () => call('engine:list'),
  searchConfig: () => call('search:config'),
  setSearchProvider: id => call('search:provider', id),
  setSearchKey: (id, key) => call('search:setKey', id, key),
  clearSearchKey: id => call('search:clearKey', id),
  setSearxngUrl: url => call('search:searxngUrl', url),
  setSearchSignals: on => call('search:signals', !!on),
  runSearch: q => call('search:run', q),
  measureResult: url => call('search:measure', url),

  mediaCapabilities: () => call('flow:mediaCapabilities'),
  ingestMediaFile: file => {
    try {
      const filePath = webUtils.getPathForFile(file);
      return filePath ? call('flow:ingestMediaPath', filePath) : Promise.resolve({ error:'That file is not backed by a desktop path' });
    } catch { return Promise.resolve({ error:'Could not read that desktop file' }); }
  },
  pickMedia: kind => call('flow:pickMedia', kind),
  convertMedia: (id, opts) => call('flow:convertMedia', id, opts || {}),
  clearMedia: id => call('flow:clearMedia', id),

  listExtensions: () => call('extension:list'),
  installUnpacked: () => call('extension:installUnpacked'),
  setExtensionEnabled:(id,on) => call('extension:setEnabled', id, !!on),
  removeExtension: id => call('extension:remove', id),

  listDownloads: () => call('download:list'),
  openDownload: id => call('download:open', id),
  showDownload: id => call('download:show', id),
  pauseDownload: id => call('download:pause', id),
  resumeDownload: id => call('download:resume', id),
  cancelDownload: id => call('download:cancel', id),
  clearDownloadHistory:() => call('download:clearFinished'),

  respondPermission: (id,decision) => call('permission:respond', id, decision),
  listPermissions: () => call('permission:list'),
  resetPermission: (origin,permission) => call('permission:reset', origin, permission),
  respondDisplayShare: (id,sourceId) => call('display:respond', id, sourceId),
  cancelDisplayShare: id => call('display:cancel', id),

  historyList: q => call('history:list', q || ''),
  clearHistory: () => call('history:clear'),
  bookmarkList: q => call('bookmark:list', q || ''),
  isBookmarked: id => call('bookmark:is', id),
  addBookmark: id => call('bookmark:add', id),
  removeBookmark: key => call('bookmark:remove', key),
  toggleBookmark: id => call('bookmark:toggle', id),

  minimize: () => call('win:minimize'),
  toggleMaximize: () => call('win:toggleMaximize'),
  isMaximized: () => call('win:isMaximized'),
  close: () => call('win:close'),
  toggleFullScreen: () => call('win:toggleFullScreen'),
  newWindow: () => call('win:new'),

  openDevTools: () => call('app:openDevTools'),
  print: () => call('app:print'),
  clearData: kinds => call('app:clearData', kinds),

  on(channel, fn){
    if (!EVENTS.includes(channel) || typeof fn !== 'function') return () => {};
    const arr = listeners.get(channel) || [];
    arr.push(fn); listeners.set(channel, arr);
    return () => listeners.set(channel, (listeners.get(channel) || []).filter(f => f !== fn));
  }
});
