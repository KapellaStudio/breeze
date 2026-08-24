/* Breeze desktop bootstrap.
   Keeps first-run/import/preferences/workspace/context/vault IPC separate from
   the browser runtime so product setup can evolve without widening page surfaces. */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard } = require('electron');
const path = require('node:path');
const launch = require('./launch');
const preferences = require('./preferences');
const workspaces = require('./workspaces');
const workspaceData = require('./workspace-data');
const vault = require('./vault');
const weather = require('./weather');

let initialized = false;
function ensureInit(){
  if (!initialized){
    const userDataPath=app.getPath('userData');
    launch.init(userDataPath);
    preferences.init(userDataPath);
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
  const picked = await dialog.showOpenDialog({
    title: 'Import bookmarks into Breeze', properties: ['openFile'],
    filters: [{ name:'Bookmarks HTML', extensions:['html','htm'] }]
  });
  if (picked.canceled || !picked.filePaths[0]) return { canceled:true };
  return launch.importBookmarksHtml(path.resolve(picked.filePaths[0]));
});
handle('launch:exportBookmarksHtml', async () => {
  const picked = await dialog.showSaveDialog({
    title: 'Export Breeze bookmarks', defaultPath: path.join(app.getPath('documents'), 'Breeze Bookmarks.html'),
    filters: [{ name:'Bookmarks HTML', extensions:['html'] }]
  });
  if (picked.canceled || !picked.filePath) return { canceled:true };
  return launch.exportBookmarksHtml(path.resolve(picked.filePath));
});
handle('launch:defaultStatus', () => launch.defaultBrowserStatus(app));
handle('launch:requestDefault', () => launch.requestDefaultBrowser(app));
handle('launch:openDefaultSettings', () => launch.openDefaultBrowserSettings(shell));

handle('prefs:get', () => preferences.get());
handle('prefs:set', (key,value) => preferences.set(String(key||''),value));
handle('prefs:setMany', patch => preferences.setMany(patch || {}));
handle('prefs:reset', () => preferences.reset());

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

/* Breeze Vault: passwords never cross back into the chrome renderer. */
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

/* Live weather uses the approximate network location already exposed to the
   internet. No OS geolocation permission, Google API key or coordinate is
   required from the renderer. The weather module keeps its caches in memory. */
handle('weather:current', unit => weather.current(unit));

app.whenReady().then(() => ensureInit());
require('./main');
