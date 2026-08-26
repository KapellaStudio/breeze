/* Breeze desktop bootstrap.
   Keeps first-run/import/preferences/workspace/context/vault IPC separate from
   the browser runtime so product setup can evolve without widening page surfaces. */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard, nativeTheme } = require('electron');
const path = require('node:path');
const launch = require('./launch');
const preferences = require('./preferences');
const workspaces = require('./workspaces');
const workspaceData = require('./workspace-data');
const vault = require('./vault');
const weather = require('./weather');
const search = require('./search');
const omnibox = require('./omnibox');

// Present the public release identity users see. The package remains valid
// semver (1.0.0), while ordinary websites receive the intentionally concise
// Breeze/1.0 product version.
const defaultUA = String(app.userAgentFallback || '');
app.userAgentFallback = /Breeze\/[\d.]+/.test(defaultUA)
  ? defaultUA.replace(/Breeze\/[\d.]+/g, 'Breeze/1.0')
  : `${defaultUA} Breeze/1.0`.trim();

function applyNativeTheme(value){
  const theme = String(value || 'auto');
  nativeTheme.themeSource = theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'system';
  return nativeTheme.themeSource;
}

let initialized = false;
function ensureInit(){
  if (!initialized){
    const userDataPath=app.getPath('userData');
    launch.init(userDataPath);
    // The main-process smoke suite validates real tab visibility and renderer
    // lifecycle, not first-run onboarding. Complete first-run only inside this
    // isolated --smoke-test profile so the production onboarding guard cannot
    // intentionally hide the very WebContentsView that smoke is measuring.
    if(process.argv.includes('--smoke-test') && !launch.status().firstRunComplete){
      launch.completeFirstRun();
    }
    preferences.init(userDataPath);
    applyNativeTheme(preferences.get().theme);
    workspaces.init(userDataPath);
    workspaceData.init(userDataPath);
    vault.init(userDataPath,safeStorage,clipboard,process.platform);
    initialized = true;
  }
}
function trustedChrome(event){
  try {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner || owner.isDestroyed()) return false;
    const url = event.sender.getURL();
    if (!url.startsWith('file://')) return false;
    const pathname = decodeURIComponent(new URL(url).pathname).replace(/\\/g,'/');
    return pathname.endsWith('/ui/breeze-desktop.html') || pathname.endsWith('/ui/breeze-mobile.html');
  } catch { return false; }
}
function handle(channel, fn){
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trustedChrome(event)) return { error: 'untrusted setup caller' };
    ensureInit();
    try { return await fn(...args); }
    catch (err){ return { error: String(err?.message || err) }; }
  });
}

handle('launch:status', () => launch.status());
handle('launch:complete', () => launch.completeFirstRun());
handle('launch:reset', () => launch.resetFirstRun());
handle('launch:sources', () => launch.detectSources());
handle('launch:importBrowser', (browser, options={}) => launch.importBrowserData(String(browser||''), options || {}));
handle('launch:importBookmarksHtml', async () => {
  const picked = await dialog.showOpenDialog({title:'Import bookmarks into Breeze',properties:['openFile'],filters:[{name:'Bookmarks HTML',extensions:['html','htm']}]});
  if (picked.canceled || !picked.filePaths[0]) return { canceled:true };
  return launch.importBookmarksHtml(path.resolve(picked.filePaths[0]));
});
handle('launch:exportBookmarksHtml', async () => {
  const picked = await dialog.showSaveDialog({title:'Export Breeze bookmarks',defaultPath:path.join(app.getPath('documents'),'Breeze Bookmarks.html'),filters:[{name:'Bookmarks HTML',extensions:['html']}]});
  if (picked.canceled || !picked.filePath) return { canceled:true };
  return launch.exportBookmarksHtml(path.resolve(picked.filePath));
});
handle('launch:defaultStatus', () => launch.defaultBrowserStatus(app));
handle('launch:requestDefault', () => launch.requestDefaultBrowser(app));
handle('launch:openDefaultSettings', () => launch.openDefaultBrowserSettings(shell));

handle('prefs:get', () => preferences.get());
handle('prefs:set', (key,value) => {
  const name=String(key||'');
  const result=preferences.set(name,value);
  if(!result?.error && name==='theme') applyNativeTheme(value);
  return result;
});
handle('prefs:setMany', patch => {
  const next=patch || {};
  const result=preferences.setMany(next);
  if(!result?.error && Object.prototype.hasOwnProperty.call(next,'theme')) applyNativeTheme(next.theme);
  return result;
});
handle('prefs:reset', () => {
  const result=preferences.reset();
  applyNativeTheme(result.theme);
  return result;
});

/* Browser-grade omnibox helpers. Remote suggestions are never persisted, can
   be disabled in preferences, and are suppressed by the preload in Private. */
handle('omnibox:resolve', value => omnibox.resolve(value,search.config().provider));
handle('omnibox:shortcuts', () => omnibox.shortcuts());
handle('omnibox:suggest', (query,privateMode=false) => omnibox.suggest(query,{
  provider:search.config().provider,
  privateMode:!!privateMode,
  enabled:preferences.get().searchSuggestions!==false
}));

handle('workspace:list', () => workspaces.list());
handle('workspace:get', id => workspaces.get(String(id||'')));
handle('workspace:create', opts => workspaces.create(opts || {}));
handle('workspace:update', (id,patch) => workspaces.update(String(id||''),patch || {}));
handle('workspace:remove', id => workspaces.remove(String(id||'')));

handle('queue:list', workspace => workspaceData.listQueue(workspace));
handle('queue:add', item => workspaceData.addQueue(item || {}));
handle('queue:remove', id => workspaceData.removeQueue(String(id||'')));
handle('queue:top', id => workspaceData.moveQueueTop(String(id||'')));
handle('queue:clear', workspace => workspaceData.clearQueue(workspace));
handle('note:list', workspace => workspaceData.listNotes(workspace));
handle('note:add', item => workspaceData.addNote(item || {}));
handle('note:update', (id,body) => workspaceData.updateNote(String(id||''),body));
handle('note:remove', id => workspaceData.removeNote(String(id||'')));
handle('snapshot:list', workspace => workspaceData.listSnapshots(workspace));
handle('snapshot:save', item => workspaceData.saveSnapshot(item || {}));
handle('snapshot:remove', id => workspaceData.removeSnapshot(String(id||'')));

handle('vault:status', () => vault.securityStatus());
handle('vault:list', q => vault.list(String(q||'')));
handle('vault:add', item => vault.add(item || {}));
handle('vault:update', (id,patch) => vault.update(String(id||''),patch || {}));
handle('vault:remove', id => vault.remove(String(id||'')));
handle('vault:copyUsername', id => vault.copyField(String(id||''),'username'));
handle('vault:copyPassword', id => vault.copyField(String(id||''),'password'));
handle('vault:importCsv', async () => {
  const picked=await dialog.showOpenDialog({title:'Import passwords into Breeze Vault',properties:['openFile'],filters:[{name:'Password CSV',extensions:['csv']}]});
  if(picked.canceled||!picked.filePaths[0])return{canceled:true};
  return vault.importCsv(path.resolve(picked.filePaths[0]));
});

handle('weather:current', unit => weather.current(unit));

/* main.js intentionally keeps browser tabs private to its own module. Capture
   only the narrow, already-trusted tab IPC entry points so the extension host
   bridge can request a normal Breeze tab without exposing those internals to
   web content. */
const capturedMainIpc = new Map();
const originalIpcHandle = ipcMain.handle.bind(ipcMain);
const captureChannels = new Set(['tab:create','tab:list','tab:navigate','tab:select','tab:close']);
ipcMain.handle = function(channel, listener){
  if (captureChannels.has(channel) && typeof listener === 'function') capturedMainIpc.set(channel,listener);
  return originalIpcHandle(channel,listener);
};

/* Load the production extension adapter into the module cache before main.js
   resolves ./extensions. The adapter wraps the stable registry; it does not
   fork the browser shell or change the public preload API. */
const extensionRuntime = require('./extensions-runtime');
require.cache[require.resolve('./extensions')].exports = extensionRuntime;

/* Chromium lets a privileged extension popup/notification close its own
   browser-created top-level window. Electron applies the normal web close
   restriction, so restore only that self-close behavior through a narrow,
   origin-checked IPC handler. */
require('./extension-self-close').install(ipcMain,BrowserWindow);

app.whenReady().then(() => ensureInit());
require('./main');
ipcMain.handle = originalIpcHandle;

extensionRuntime.setInternalInvoker(async (channel,...args) => {
  const listener=capturedMainIpc.get(String(channel||''));
  if(!listener) throw new Error(`Breeze internal browser operation is unavailable: ${channel}`);
  const owner=BrowserWindow.getAllWindows().find(w=>{
    try{
      if(!w||w.isDestroyed()) return false;
      const url=w.webContents.getURL();
      if(!url.startsWith('file://')) return false;
      const pathname=decodeURIComponent(new URL(url).pathname).replace(/\\/g,'/');
      return pathname.endsWith('/ui/breeze-desktop.html')||pathname.endsWith('/ui/breeze-mobile.html');
    }catch{return false;}
  });
  if(!owner) throw new Error('Breeze browser chrome is not ready for an extension request');
  return listener({sender:owner.webContents},...args);
});
