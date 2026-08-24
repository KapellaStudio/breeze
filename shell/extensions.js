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

function safeReadJSON(file, fallback){
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function save(){
  if (!registryPath) return;
  fs.mkdirSync(path.dirname(registryPath), { recursive:true });
  const clean = rows.map(({ runtimeIds, ...r }) => r);
  fs.writeFileSync(registryPath, JSON.stringify(clean, null, 2));
}
function init(userDataPath){
  rootDir = path.join(userDataPath, 'extensions');
  registryPath = path.join(rootDir, 'registry.json');
  fs.mkdirSync(rootDir, { recursive:true });
  rows = safeReadJSON(registryPath, []).filter(r => r && typeof r.localId === 'string' && typeof r.dir === 'string');
  rows.forEach(r => { r.runtimeIds = {}; });
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
    backgroundKind:r.backgroundKind || 'none',
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
    report, manifest
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
    backgroundKind:inspected.report.backgroundKind,
    compatibility:inspected.report.status, reasons:inspected.report.reasons,
    warnings:inspected.report.warnings, permissions:inspected.report.permissions,
    enabled:true, workspaces:['*'], runtimeIds:{}
  };
  rows.push(r); save();
  return { installed:true, extension:publicRow(r) };
}
async function loadIntoSession(ses, workspaceId='default'){
  const out = [];
  for (const r of rows){
    if (r.enabled === false) continue;
    const scopes = Array.isArray(r.workspaces) ? r.workspaces : ['*'];
    if (!scopes.includes('*') && !scopes.includes(workspaceId)) continue;
    try {
      if (r.runtimeIds?.[workspaceId]) { out.push({ localId:r.localId, runtimeId:r.runtimeIds[workspaceId], ok:true, already:true }); continue; }
      const ext = await ses.extensions.loadExtension(managedPath(r), { allowFileAccess:false });
      r.runtimeIds[workspaceId] = ext.id;
      out.push({ localId:r.localId, runtimeId:ext.id, ok:true });
    } catch (err){
      out.push({ localId:r.localId, ok:false, error:String(err.message || err) });
    }
  }
  return out;
}
async function unloadFromSession(ses, r, workspaceId='default'){
  const id = r.runtimeIds?.[workspaceId];
  if (!id) return;
  try { ses.extensions.removeExtension(id); } catch {}
  delete r.runtimeIds[workspaceId];
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
  if (r.runtimeIds?.[workspaceId]) return;
  const scopes = Array.isArray(r.workspaces) ? r.workspaces : ['*'];
  if (!scopes.includes('*') && !scopes.includes(workspaceId)) return;
  try {
    const ext = await ses.extensions.loadExtension(managedPath(r), { allowFileAccess:false });
    r.runtimeIds[workspaceId] = ext.id;
  } catch {}
}
async function remove(localId, sessionEntries=[]){
  const r = get(localId); if (!r) return { error:'extension not found' };
  for (const { ses, workspaceId } of sessionEntries) await unloadFromSession(ses, r, workspaceId);
  rows = rows.filter(x => x.localId !== localId); save();
  try { fs.rmSync(managedPath(r), { recursive:true, force:true }); } catch {}
  return { ok:true };
}

module.exports = { init, list, inspectDirectory, importDirectory, loadIntoSession, setEnabled, remove, analyzeManifest };
