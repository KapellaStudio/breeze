/* Breeze desktop bootstrap.
   Keeps first-run/import IPC separate from the browser runtime so setup work can
   evolve without widening main.js's page-facing surface. */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const launch = require('./launch');

let initialized = false;
function ensureInit(){
  if (!initialized){
    launch.init(app.getPath('userData'));
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
    title: 'Import bookmarks into Breeze',
    properties: ['openFile'],
    filters: [{ name:'Bookmarks HTML', extensions:['html','htm'] }]
  });
  if (picked.canceled || !picked.filePaths[0]) return { canceled:true };
  return launch.importBookmarksHtml(path.resolve(picked.filePaths[0]));
});
handle('launch:exportBookmarksHtml', async () => {
  const picked = await dialog.showSaveDialog({
    title: 'Export Breeze bookmarks',
    defaultPath: path.join(app.getPath('documents'), 'Breeze Bookmarks.html'),
    filters: [{ name:'Bookmarks HTML', extensions:['html'] }]
  });
  if (picked.canceled || !picked.filePath) return { canceled:true };
  return launch.exportBookmarksHtml(path.resolve(picked.filePath));
});
handle('launch:defaultStatus', () => launch.defaultBrowserStatus(app));
handle('launch:requestDefault', () => launch.requestDefaultBrowser(app));
handle('launch:openDefaultSettings', () => launch.openDefaultBrowserSettings(shell));

app.whenReady().then(() => ensureInit());
require('./main');
