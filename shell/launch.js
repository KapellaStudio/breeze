/* Breeze first-run, migration and default-browser service.
   This module owns only local desktop setup state. It never uploads imported
   browser data, never receives private-session data, and never stores a cloud
   account. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const library = require('./library');

let userDataPath = null;
let prefsFile = null;
let prefs = { version: 1, firstRunComplete: false, completedAt: null };

function atomicJson(file, value){
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
function init(dir){
  userDataPath = dir;
  prefsFile = path.join(dir, 'launch-state.json');
  try {
    const v = JSON.parse(fs.readFileSync(prefsFile, 'utf8'));
    if (v && typeof v === 'object') prefs = { ...prefs, ...v, version: 1 };
  } catch {}
}
function ensureInit(){ if (!prefsFile) throw new Error('launch service not initialized'); }
function status(){ ensureInit(); return { ...prefs }; }
function completeFirstRun(){
  ensureInit();
  prefs.firstRunComplete = true;
  prefs.completedAt = Date.now();
  atomicJson(prefsFile, prefs);
  return status();
}
function resetFirstRun(){
  ensureInit();
  prefs.firstRunComplete = false;
  prefs.completedAt = null;
  atomicJson(prefsFile, prefs);
  return status();
}

function chromiumRoots(){
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const roots = [];
  if (process.platform === 'win32'){
    roots.push(['chrome', path.join(local, 'Google', 'Chrome', 'User Data')]);
    roots.push(['edge', path.join(local, 'Microsoft', 'Edge', 'User Data')]);
  } else if (process.platform === 'darwin'){
    roots.push(['chrome', path.join(home, 'Library', 'Application Support', 'Google', 'Chrome')]);
    roots.push(['edge', path.join(home, 'Library', 'Application Support', 'Microsoft Edge')]);
  } else {
    roots.push(['chrome', path.join(home, '.config', 'google-chrome')]);
    roots.push(['edge', path.join(home, '.config', 'microsoft-edge')]);
  }
  return roots;
}
function profileDirectories(root){
  if (!fs.existsSync(root)) return [];
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name); }
  catch { return []; }
  return names.filter(n => n === 'Default' || /^Profile \d+$/.test(n)).sort((a,b) => a === 'Default' ? -1 : b === 'Default' ? 1 : a.localeCompare(b));
}
function detectSources(){
  return chromiumRoots().map(([browser, root]) => {
    const profiles = profileDirectories(root).map(name => {
      const dir = path.join(root, name);
      return {
        name,
        bookmarks: fs.existsSync(path.join(dir, 'Bookmarks')),
        history: fs.existsSync(path.join(dir, 'History'))
      };
    }).filter(p => p.bookmarks || p.history);
    return { browser, available: profiles.length > 0, profiles };
  });
}

function htmlDecode(s){
  return String(s || '')
    .replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/&#(\d+);/g, (_,n) => String.fromCodePoint(Number(n) || 0));
}
function chromiumBookmarkRows(file, browser, profile){
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
  const out = [];
  const walk = (node, trail=[]) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'url' && typeof node.url === 'string'){
      out.push({
        url: node.url,
        title: String(node.name || ''),
        workspace: `Imported · ${browser === 'edge' ? 'Edge' : 'Chrome'}${profile && profile !== 'Default' ? ' · ' + profile : ''}`,
        folder: trail.join(' / ')
      });
      return;
    }
    const next = node.name && !/^bookmark_(bar|roots)$/i.test(String(node.name)) ? [...trail, String(node.name)] : trail;
    if (Array.isArray(node.children)) node.children.forEach(c => walk(c, next));
  };
  const roots = data.roots || {};
  Object.values(roots).forEach(r => walk(r, []));
  return out;
}
function importBookmarkRows(rows){
  let imported = 0, skipped = 0;
  for (const row of rows){
    const clean = library.safeUrl(row.url);
    if (!clean){ skipped++; continue; }
    const result = library.addBookmark({ url: clean, title: row.title, workspace: row.workspace || 'Imported' });
    if (result?.error) skipped++; else imported++;
  }
  return { imported, skipped };
}

const CHROME_EPOCH_MS = 11644473600000;
function chromiumTimeToUnixMs(value){
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return Math.max(0, Math.round(n / 1000 - CHROME_EPOCH_MS));
}
function historyRows(file, browser, profile){
  if (!userDataPath || !fs.existsSync(file)) return [];
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); }
  catch { return []; }
  const temp = path.join(userDataPath, `import-history-${crypto.randomUUID()}.sqlite`);
  try {
    fs.copyFileSync(file, temp);
    const db = new DatabaseSync(temp, { readOnly: true });
    const rows = db.prepare('SELECT url, title, last_visit_time FROM urls WHERE hidden = 0 AND url IS NOT NULL ORDER BY last_visit_time DESC LIMIT 5000').all();
    db.close();
    return rows.map(r => ({
      url: String(r.url || ''),
      title: String(r.title || ''),
      visitedAt: chromiumTimeToUnixMs(r.last_visit_time),
      workspace: `Imported · ${browser === 'edge' ? 'Edge' : 'Chrome'}${profile && profile !== 'Default' ? ' · ' + profile : ''}`
    }));
  } catch { return []; }
  finally { try { fs.rmSync(temp, { force: true }); } catch {} }
}

function rootFor(browser){
  const hit = chromiumRoots().find(([name]) => name === browser);
  return hit ? hit[1] : null;
}
function importBrowserData(browser, options={}){
  ensureInit();
  if (!['chrome','edge'].includes(browser)) return { error: 'unsupported browser' };
  const root = rootFor(browser);
  if (!root || !fs.existsSync(root)) return { error: `${browser === 'edge' ? 'Edge' : 'Chrome'} profile not found` };
  const wantBookmarks = options.bookmarks !== false;
  const wantHistory = options.history !== false;
  let bookmarksImported = 0, bookmarksSkipped = 0, historyImported = 0, historySkipped = 0;
  const profiles = profileDirectories(root);
  for (const profile of profiles){
    const dir = path.join(root, profile);
    if (wantBookmarks && fs.existsSync(path.join(dir, 'Bookmarks'))){
      const r = importBookmarkRows(chromiumBookmarkRows(path.join(dir, 'Bookmarks'), browser, profile));
      bookmarksImported += r.imported; bookmarksSkipped += r.skipped;
    }
    if (wantHistory && fs.existsSync(path.join(dir, 'History'))){
      const rows = historyRows(path.join(dir, 'History'), browser, profile);
      const r = library.importHistory(rows);
      historyImported += r.imported; historySkipped += r.skipped;
    }
  }
  return { ok: true, browser, profiles: profiles.length, bookmarksImported, bookmarksSkipped, historyImported, historySkipped };
}

function importBookmarksHtml(file){
  ensureInit();
  let html;
  try { html = fs.readFileSync(file, 'utf8'); }
  catch { return { error: 'Could not read that bookmarks file' }; }
  const rows = [];
  const re = /<A\b[^>]*\bHREF\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/A>/gi;
  let m;
  while ((m = re.exec(html))){
    const url = htmlDecode(m[1] || m[2] || m[3] || '');
    const title = htmlDecode(String(m[4] || '').replace(/<[^>]+>/g,'').trim());
    rows.push({ url, title, workspace: 'Imported bookmarks' });
  }
  if (!rows.length) return { error: 'No bookmarks were found in that HTML file' };
  return { ok: true, ...importBookmarkRows(rows) };
}
function escapeHtml(s){ return String(s || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function bookmarksHtml(){
  const rows = library.listBookmarks('');
  const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>','<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">','<TITLE>Breeze Bookmarks</TITLE>','<H1>Breeze Bookmarks</H1>','<DL><p>'];
  for (const b of rows) lines.push(`  <DT><A HREF="${escapeHtml(b.url)}">${escapeHtml(b.title || b.url)}</A>`);
  lines.push('</DL><p>');
  return lines.join('\n') + '\n';
}
function exportBookmarksHtml(file){
  ensureInit();
  fs.writeFileSync(file, bookmarksHtml(), 'utf8');
  return { ok: true, count: library.listBookmarks('').length };
}

function defaultBrowserStatus(app){
  const safe = proto => { try { return !!app.isDefaultProtocolClient(proto); } catch { return false; } };
  const http = safe('http'), https = safe('https');
  return { platform: process.platform, http, https, isDefault: http && https };
}
function requestDefaultBrowser(app){
  const set = proto => { try { return !!app.setAsDefaultProtocolClient(proto); } catch { return false; } };
  const requested = { http: set('http'), https: set('https') };
  return { requested, ...defaultBrowserStatus(app) };
}
async function openDefaultBrowserSettings(shell){
  try {
    if (process.platform === 'win32'){
      await shell.openExternal('ms-settings:defaultapps');
      return { ok: true };
    }
    if (process.platform === 'darwin'){
      await shell.openExternal('x-apple.systempreferences:com.apple.Desktop-Settings.extension?DefaultWebBrowser');
      return { ok: true };
    }
    try {
      execFileSync('xdg-settings', ['set','default-web-browser','breeze.desktop'], { stdio:'ignore', timeout:4000 });
      return { ok: true, attempted: true };
    } catch { return { ok: false, manual: true, message: 'Choose Breeze as the default browser in your desktop settings.' }; }
  } catch (err){ return { ok: false, message: String(err?.message || err) }; }
}

module.exports = {
  init, status, completeFirstRun, resetFirstRun,
  detectSources, importBrowserData, importBookmarksHtml, exportBookmarksHtml,
  defaultBrowserStatus, requestDefaultBrowser, openDefaultBrowserSettings,
  chromiumTimeToUnixMs, bookmarksHtml
};
