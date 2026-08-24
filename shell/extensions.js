/* Breeze extension registry.
   Electron 43 gives us a useful subset of Chrome extensions, including a
   working MV3 service-worker/runtime/content-script path that Breeze verifies
   in CI. It is still not full Chrome Web Store/API parity, so modern extensions
   are admitted with an explicit compatibility report instead of being falsely
   blocked or falsely advertised as fully compatible. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { BrowserWindow, ipcMain, shell } = require('electron');

const MAX_MANIFEST = 1024 * 1024;
const META_KEYS = new Set(['name','version','description','author','icons','short_name','default_locale','minimum_chrome_version']);
const SUPPORTED_KEYS = new Set([
  ...META_KEYS,
  'manifest_version','permissions','host_permissions','content_scripts','devtools_page','background'
]);
const HIGH_RISK_KEYS = new Set([
  'action','browser_action','page_action','side_panel','declarative_net_request',
  'commands','omnibox','options_page','options_ui','chrome_url_overrides','externally_connectable'
]);
const KNOWN_UNSUPPORTED_PERMS = new Set([
  'alarms','bookmarks','browsingData','commands','contextMenus','cookies','declarativeNetRequest',
  'downloads','geolocation','history','identity','idle','nativeMessaging','notifications',
  'sessions','sidePanel','topSites','webNavigation'
]);

let rootDir = null;
let registryPath = null;
let rows = [];
let actionIpcReady = false;
const sessionRefs = new Map();
const popupWindows = new Set();

function safeReadJSON(file, fallback){
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function save(){
  if (!registryPath) return;
  fs.mkdirSync(path.dirname(registryPath), { recursive:true });
  const clean = rows.map(({ runtimeIds, ...r }) => r);
  fs.writeFileSync(registryPath, JSON.stringify(clean, null, 2));
}
function safeWorkspaceId(value){ return String(value || 'default').replace(/[^a-z0-9_-]/gi,'-').slice(0,80) || 'default'; }
function sessionKey(ses, workspaceId='default'){
  const storage = String(ses?.storagePath || 'memory').replace(/\\/g,'/');
  return safeWorkspaceId(workspaceId) + ':' + crypto.createHash('sha256').update(storage).digest('hex').slice(0,16);
}
function sessionLooksSealed(ses, workspaceId='default'){
  const storage = String(ses?.storagePath || '').replace(/\\/g,'/').toLowerCase();
  return storage.includes('/partitions/ws-' + safeWorkspaceId(workspaceId).toLowerCase());
}
function rememberSession(ses, workspaceId='default'){
  const ws = safeWorkspaceId(workspaceId);
  const key = sessionKey(ses, ws);
  sessionRefs.set(key, { key, ses, workspaceId:ws, sealed:sessionLooksSealed(ses,ws) });
  return key;
}
function actionPopupFor(manifest){
  const action = (manifest && typeof manifest.action === 'object' && manifest.action)
    || (manifest && typeof manifest.browser_action === 'object' && manifest.browser_action)
    || (manifest && typeof manifest.page_action === 'object' && manifest.page_action)
    || null;
  let popup = action && typeof action.default_popup === 'string' ? action.default_popup.trim() : '';
  if (!popup || popup.length > 512 || popup.includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(popup)) return '';
  return popup.replace(/^\/+/, '');
}
function installActionIpc(){
  if (actionIpcReady) return;
  actionIpcReady = true;
  ipcMain.handle('extension:openAction', (_event, localId, context) => openAction(String(localId||''), context || {}));
}
function init(userDataPath){
  rootDir = path.join(userDataPath, 'extensions');
  registryPath = path.join(rootDir, 'registry.json');
  fs.mkdirSync(rootDir, { recursive:true });
  rows = safeReadJSON(registryPath, []).filter(r => r && typeof r.localId === 'string' && typeof r.dir === 'string');
  rows.forEach(r => {
    r.runtimeIds = {};
    try { r.actionPopup = actionPopupFor(readManifest(managedPath(r))); } catch { r.actionPopup = ''; }
  });
  installActionIpc();
  return list();
}

function validateTree(dir){
  let files=0, bytes=0;
  const stack=[dir];
  while(stack.length){
    const cur=stack.pop();
    for(const ent of fs.readdirSync(cur,{withFileTypes:true})){
      const full=path.join(cur,ent.name);
      const st=fs.lstatSync(full);
      if(st.isSymbolicLink()) throw new Error('extensions containing symbolic links are not accepted');
      if(st.isDirectory()) stack.push(full);
      else if(st.isFile()){ files++; bytes+=st.size; }
      if(files>10000 || bytes>250*1024*1024) throw new Error('extension package is too large');
    }
  }
}

function readManifest(dir){
  const file = path.join(dir, 'manifest.json');
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > MAX_MANIFEST) throw new Error('manifest.json is missing or too large');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!manifest || typeof manifest !== 'object') throw new Error('invalid extension manifest');
  return manifest;
}
function flattenPermissions(manifest){
  const p = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const hp = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  return [...new Set([...p, ...hp].filter(x => typeof x === 'string').map(x => x.slice(0, 180)))];
}
function analyzeManifest(manifest){
  const mv = Number(manifest.manifest_version || 0);
  const reasons = [];
  const warnings = [];
  if (![2,3].includes(mv)) reasons.push('Breeze currently accepts Manifest V2 or V3 manifests only.');
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) reasons.push('The extension has no valid name.');
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) reasons.push('The extension has no valid version.');

  const background = manifest.background && typeof manifest.background === 'object' ? manifest.background : {};
  const backgroundKind = mv === 3 && typeof background.service_worker === 'string'
    ? 'mv3-service-worker'
    : (mv === 2 && Array.isArray(background.scripts) ? 'mv2-background' : 'none');
  if (backgroundKind === 'mv3-service-worker'){
    warnings.push('Manifest V3 service-worker runtime is verified in Breeze, but Chrome APIs used by the worker are certified separately.');
  }
  for (const key of Object.keys(manifest)){
    if (HIGH_RISK_KEYS.has(key)) warnings.push(`Manifest feature “${key}” is not part of Breeze’s current certified compatibility tier.`);
    else if (!SUPPORTED_KEYS.has(key)) warnings.push(`Manifest feature “${key}” has not been certified by Breeze.`);
  }
  for (const p of flattenPermissions(manifest)){
    if (KNOWN_UNSUPPORTED_PERMS.has(p)) warnings.push(`Chrome permission “${p}” is not certified in the current engine.`);
  }
  const status = reasons.length ? 'blocked' : warnings.length ? 'partial' : 'compatible';
  return { status, manifestVersion:mv, backgroundKind, reasons, warnings, permissions:flattenPermissions(manifest) };
}
function safeName(s){ return String(s || 'Extension').replace(/[\r\n\t]/g,' ').trim().slice(0,75) || 'Extension'; }
function safeVersion(s){ return String(s || '0').replace(/[^0-9A-Za-z._-]/g,'').slice(0,40) || '0'; }
function publicRow(r){
  return {
    localId:r.localId, name:r.name, version:r.version, author:r.author || '',
    description:r.description || '', manifestVersion:r.manifestVersion,
    backgroundKind:r.backgroundKind || 'none', hasActionPopup:!!r.actionPopup,
    compatibility:r.compatibility, reasons:r.reasons || [], warnings:r.warnings || [],
    permissions:r.permissions || [], enabled:r.enabled !== false,
    workspaces:Array.isArray(r.workspaces) ? r.workspaces : ['*']
  };
}
function list(){ return rows.map(publicRow); }
function get(localId){ return rows.find(r => r.localId === localId); }
function managedPath(r){ return path.join(rootDir, r.dir); }

function inspectDirectory(dir){
  validateTree(dir);
  const manifest = readManifest(dir);
  const report = analyzeManifest(manifest);
  return {
    name:safeName(manifest.name), version:safeVersion(manifest.version),
    author:safeName(manifest.author || ''), description:String(manifest.description || '').slice(0,240),
    actionPopup:actionPopupFor(manifest), report, manifest
  };
}
function importDirectory(sourceDir){
  const inspected = inspectDirectory(sourceDir);
  if (inspected.report.status === 'blocked') return { installed:false, ...inspected.report, name:inspected.name, version:inspected.version };
  const localId = crypto.randomUUID();
  const dir = localId;
  const dest = path.join(rootDir, dir);
  fs.cpSync(sourceDir, dest, { recursive:true, errorOnExist:true });
  const r = {
    localId, dir, name:inspected.name, version:inspected.version, author:inspected.author,
    description:inspected.description, manifestVersion:inspected.report.manifestVersion,
    backgroundKind:inspected.report.backgroundKind, actionPopup:inspected.actionPopup,
    compatibility:inspected.report.status, reasons:inspected.report.reasons,
    warnings:inspected.report.warnings, permissions:inspected.report.permissions,
    enabled:true, workspaces:['*'], runtimeIds:{}
  };
  rows.push(r); save();
  return { installed:true, extension:publicRow(r) };
}
async function loadIntoSession(ses, workspaceId='default'){
  const out = [];
  const ws = safeWorkspaceId(workspaceId);
  const ctxKey = rememberSession(ses, ws);
  for (const r of rows){
    if (r.enabled === false) continue;
    const scopes = Array.isArray(r.workspaces) ? r.workspaces : ['*'];
    if (!scopes.includes('*') && !scopes.includes(ws)) continue;
    try {
      if (r.runtimeIds?.[ctxKey]) { out.push({ localId:r.localId, runtimeId:r.runtimeIds[ctxKey], ok:true, already:true }); continue; }
      const ext = await ses.extensions.loadExtension(managedPath(r), { allowFileAccess:false });
      r.runtimeIds[ctxKey] = ext.id;
      out.push({ localId:r.localId, runtimeId:ext.id, ok:true });
    } catch (err){
      out.push({ localId:r.localId, ok:false, error:String(err.message || err) });
    }
  }
  return out;
}
async function unloadFromSession(ses, r, workspaceId='default'){
  const ctxKey = sessionKey(ses, safeWorkspaceId(workspaceId));
  const id = r.runtimeIds?.[ctxKey];
  if (!id) return;
  try { ses.extensions.removeExtension(id); } catch {}
  delete r.runtimeIds[ctxKey];
}
async function setEnabled(localId, enabled, sessionEntries=[]){
  const r = get(localId); if (!r) return { error:'extension not found' };
  r.enabled = !!enabled; save();
  for (const { ses, workspaceId } of sessionEntries){
    if (r.enabled) await loadOne(ses, r, workspaceId);
    else await unloadFromSession(ses, r, workspaceId);
  }
  return { ok:true, extension:publicRow(r) };
}
async function loadOne(ses, r, workspaceId='default'){
  if (!r || r.enabled === false) return;
  const ws = safeWorkspaceId(workspaceId);
  const ctxKey = rememberSession(ses, ws);
  if (r.runtimeIds?.[ctxKey]) return;
  const scopes = Array.isArray(r.workspaces) ? r.workspaces : ['*'];
  if (!scopes.includes('*') && !scopes.includes(ws)) return;
  try {
    const ext = await ses.extensions.loadExtension(managedPath(r), { allowFileAccess:false });
    r.runtimeIds[ctxKey] = ext.id;
  } catch {}
}
function chooseSession(workspaceId='default', sealed=false){
  const ws = safeWorkspaceId(workspaceId);
  const candidates = [...sessionRefs.values()].filter(x => x.workspaceId === ws);
  return candidates.find(x => x.sealed === !!sealed) || candidates[0] || null;
}
async function openAction(localId, context={}){
  const r = get(localId);
  if (!r) return { error:'extension not found' };
  if (r.enabled === false) return { error:'extension is disabled' };
  if (!r.actionPopup) return { error:'this extension has no action popup' };
  const ws = safeWorkspaceId(context.workspaceId || 'default');
  const ref = chooseSession(ws, !!context.sealed);
  if (!ref) return { error:'extension session is not ready' };
  const ctxKey = sessionKey(ref.ses, ws);
  if (!r.runtimeIds?.[ctxKey]) await loadOne(ref.ses, r, ws);
  const runtimeId = r.runtimeIds?.[ctxKey];
  const ext = runtimeId ? ref.ses.extensions.getExtension(runtimeId) : null;
  if (!ext) return { error:'extension could not be loaded in this workspace' };
  let popupUrl;
  try { popupUrl = new URL(r.actionPopup, ext.url).toString(); }
  catch { return { error:'extension popup path is invalid' }; }
  if (!popupUrl.startsWith(ext.url)) return { error:'extension popup escaped its own origin' };

  const parent = BrowserWindow.getFocusedWindow() || null;
  const bounds = parent && !parent.isDestroyed() ? parent.getBounds() : null;
  const width = 390, height = 600;
  const opts = {
    width, height, minWidth:320, minHeight:360,
    show:false, resizable:true, minimizable:false, maximizable:false,
    autoHideMenuBar:true, title:r.name,
    parent:parent || undefined,
    webPreferences:{ session:ref.ses, contextIsolation:true, nodeIntegration:false, sandbox:true, webSecurity:true }
  };
  if (bounds){
    opts.x = Math.max(bounds.x + 12, bounds.x + bounds.width - width - 18);
    opts.y = Math.max(bounds.y + 12, bounds.y + 54);
  }
  const popup = new BrowserWindow(opts);
  popupWindows.add(popup);
  popup.webContents.setWindowOpenHandler(({url}) => {
    if (typeof url === 'string' && url.startsWith(ext.url)){
      return { action:'allow', overrideBrowserWindowOptions:{ autoHideMenuBar:true, webPreferences:{ session:ref.ses, contextIsolation:true, nodeIntegration:false, sandbox:true, webSecurity:true } } };
    }
    try { const u=new URL(url); if(['http:','https:'].includes(u.protocol)) shell.openExternal(u.toString()); } catch {}
    return { action:'deny' };
  });
  popup.webContents.on('will-navigate', (event,url) => {
    if (typeof url === 'string' && url.startsWith(ext.url)) return;
    event.preventDefault();
    try { const u=new URL(url); if(['http:','https:'].includes(u.protocol)) shell.openExternal(u.toString()); } catch {}
  });
  popup.once('ready-to-show', () => { if(!popup.isDestroyed()) popup.show(); });
  popup.on('closed', () => popupWindows.delete(popup));
  await popup.loadURL(popupUrl);
  return { ok:true, localId:r.localId, runtimeId, popup:true };
}
async function remove(localId, sessionEntries=[]){
  const r = get(localId); if (!r) return { error:'extension not found' };
  for (const { ses, workspaceId } of sessionEntries) await unloadFromSession(ses, r, workspaceId);
  rows = rows.filter(x => x.localId !== localId); save();
  try { fs.rmSync(managedPath(r), { recursive:true, force:true }); } catch {}
  return { ok:true };
}

module.exports = { init, list, inspectDirectory, importDirectory, loadIntoSession, setEnabled, remove, openAction, analyzeManifest };
