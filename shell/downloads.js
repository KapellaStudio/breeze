/* Breeze downloads — real Chromium downloads with local provenance metadata.
   File paths remain in the main process. The renderer gets an opaque id and
   safe metadata, then asks the main process to open/reveal/cancel by id. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { shell } = require('electron');

let historyPath = null;
let downloadsDir = null;
let send = () => {};
let rows = [];
const active = new Map();
const wired = new WeakSet();

function safeRead(file, fallback){ try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; } }
function init({ userDataPath, systemDownloadsPath, emit }){
  historyPath = path.join(userDataPath, 'downloads.json');
  downloadsDir = systemDownloadsPath;
  send = typeof emit === 'function' ? emit : () => {};
  rows = safeRead(historyPath, []).filter(r => r && typeof r.id === 'string').slice(0,500);
}
function save(){
  if (!historyPath) return;
  // Private download files stay where the user explicitly saved them, but
  // Breeze never persists private provenance/history to disk.
  fs.writeFileSync(historyPath, JSON.stringify(rows.filter(r => !r.private).slice(0,500), null, 2));
}
function safePublic(r){
  return {
    id:r.id, filename:r.filename, url:r.url, source:r.source, workspace:r.workspace, private:!!r.private,
    startedAt:r.startedAt, completedAt:r.completedAt || null, total:r.total || 0,
    received:r.received || 0, state:r.state, paused:!!r.paused, mime:r.mime || ''
  };
}
function list(){ return rows.map(safePublic); }
function uniquePath(filename){
  const ext = path.extname(filename), stem = path.basename(filename, ext);
  let candidate = path.join(downloadsDir, filename), n = 1;
  while (fs.existsSync(candidate)) candidate = path.join(downloadsDir, `${stem} (${n++})${ext}`);
  return candidate;
}
function upsert(r){
  const i = rows.findIndex(x => x.id === r.id);
  if (i >= 0) rows[i] = r; else rows.unshift(r);
  rows = rows.slice(0,500); save(); send('download:update', safePublic(r));
}
function wireSession(ses, contextForWebContents){
  if (wired.has(ses)) return;
  wired.add(ses);
  ses.on('will-download', (_event, item, webContents) => {
    const ctx = (contextForWebContents && contextForWebContents(webContents?.id)) || {};
    const id = crypto.randomUUID();
    const filename = path.basename(item.getFilename() || 'download');
    const savePath = uniquePath(filename);
    item.setSavePath(savePath);
    const row = {
      id, filename, path:savePath, url:String(item.getURL() || '').slice(0,4096),
      source:String(ctx.url || '').slice(0,4096), workspace:String(ctx.workspace || 'default').slice(0,80), private:!!ctx.private,
      startedAt:Date.now(), total:Number(item.getTotalBytes() || 0), received:Number(item.getReceivedBytes() || 0),
      state:'progressing', paused:false, mime:String(item.getMimeType?.() || '').slice(0,120)
    };
    active.set(id, item); upsert(row);
    item.on('updated', (_e, state) => {
      row.received = Number(item.getReceivedBytes() || 0); row.total = Number(item.getTotalBytes() || row.total || 0);
      row.paused = item.isPaused(); row.state = state === 'interrupted' ? 'interrupted' : 'progressing'; upsert(row);
    });
    item.once('done', (_e, state) => {
      row.received = Number(item.getReceivedBytes() || 0); row.total = Number(item.getTotalBytes() || row.total || 0);
      row.state = state; row.paused = false; row.completedAt = Date.now(); active.delete(id); upsert(row);
    });
  });
}
function get(id){ return rows.find(r => r.id === id); }
async function open(id){ const r=get(id); if(!r?.path||!fs.existsSync(r.path)) return {error:'file not found'}; const e=await shell.openPath(r.path); return e ? {error:e}:{ok:true}; }
function show(id){ const r=get(id); if(!r?.path||!fs.existsSync(r.path)) return {error:'file not found'}; shell.showItemInFolder(r.path); return {ok:true}; }
function pause(id){ const i=active.get(id); if(!i) return {error:'download is not active'}; i.pause(); return {ok:true}; }
function resume(id){ const i=active.get(id); if(!i) return {error:'download is not active'}; i.resume(); return {ok:true}; }
function cancel(id){ const i=active.get(id); if(!i) return {error:'download is not active'}; i.cancel(); return {ok:true}; }
function clearFinished(){ rows = rows.filter(r => active.has(r.id)); save(); send('download:refresh', list()); return {ok:true}; }
function endPrivateSession(){
  for(const r of rows.filter(r => r.private)){
    const item=active.get(r.id); if(item){ try{ item.cancel(); }catch{} active.delete(r.id); }
  }
  rows=rows.filter(r => !r.private);
  save(); send('download:refresh', list());
  return {ok:true};
}

module.exports = { init, wireSession, list, open, show, pause, resume, cancel, clearFinished, endPrivateSession };
