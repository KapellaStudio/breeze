/* Breeze local browsing library: real history + bookmarks.
   History is automatic for normal browsing and is NEVER written for private
   tabs. Bookmarks are explicit user intent, so they persist only when the user
   asks to save one. No cloud account is required. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
let historyFile=null, bookmarksFile=null, history=[], bookmarks=[];
function read(file,fallback){ try{const v=JSON.parse(fs.readFileSync(file,'utf8'));return Array.isArray(v)?v:fallback;}catch{return fallback;} }
function write(file,value){ const tmp=file+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(value,null,2)); fs.renameSync(tmp,file); }
function init(userDataPath){
  historyFile=path.join(userDataPath,'history.json'); bookmarksFile=path.join(userDataPath,'bookmarks.json');
  history=read(historyFile,[]).filter(x=>x&&typeof x.url==='string').slice(0,5000);
  bookmarks=read(bookmarksFile,[]).filter(x=>x&&typeof x.url==='string').slice(0,2000);
}
function safeUrl(raw){ try{const u=new URL(raw); return ['http:','https:'].includes(u.protocol)?u.toString():null;}catch{return null;} }
function saveHistory(){ if(historyFile) write(historyFile,history.slice(0,5000)); }
function saveBookmarks(){ if(bookmarksFile) write(bookmarksFile,bookmarks.slice(0,2000)); }
function recordVisit({url,title,workspace,privateMode}={}){
  if(privateMode) return null;
  const clean=safeUrl(url); if(!clean) return null;
  const now=Date.now(); const top=history[0];
  const row={id:top?.url===clean?top.id:crypto.randomUUID(),url:clean,title:String(title||'').slice(0,300),workspace:String(workspace||'default').slice(0,80),visitedAt:now};
  if(top?.url===clean) history[0]={...top,...row}; else history.unshift(row);
  history=history.slice(0,5000); saveHistory(); return row;
}
function importHistory(rows=[]){
  if(!Array.isArray(rows)) return {imported:0,skipped:0};
  const byUrl=new Map(history.map(r=>[r.url,r]));
  let imported=0, skipped=0;
  for(const src of rows.slice(0,5000)){
    const clean=safeUrl(src?.url); if(!clean){skipped++;continue;}
    const when=Number(src?.visitedAt); const visitedAt=Number.isFinite(when)&&when>0?when:Date.now();
    const existing=byUrl.get(clean);
    if(existing && Number(existing.visitedAt||0)>=visitedAt){skipped++;continue;}
    const row={id:existing?.id||crypto.randomUUID(),url:clean,title:String(src?.title||existing?.title||'').slice(0,300),workspace:String(src?.workspace||existing?.workspace||'Imported').slice(0,80),visitedAt};
    byUrl.set(clean,row); imported++;
  }
  history=[...byUrl.values()].sort((a,b)=>Number(b.visitedAt||0)-Number(a.visitedAt||0)).slice(0,5000);
  if(imported) saveHistory();
  return {imported,skipped};
}
function listHistory(q=''){
  const needle=String(q||'').trim().toLowerCase();
  return history.filter(r=>!needle||r.title.toLowerCase().includes(needle)||r.url.toLowerCase().includes(needle)).slice(0,500);
}
function clearHistory(){ history=[]; saveHistory(); return {ok:true}; }
function addBookmark({url,title,workspace}={}){
  const clean=safeUrl(url); if(!clean) return {error:'invalid bookmark url'};
  const existing=bookmarks.find(b=>b.url===clean);
  if(existing){ existing.title=String(title||existing.title||'').slice(0,300); existing.workspace=String(workspace||existing.workspace||'default').slice(0,80); existing.updatedAt=Date.now(); saveBookmarks(); return existing; }
  const row={id:crypto.randomUUID(),url:clean,title:String(title||'').slice(0,300),workspace:String(workspace||'default').slice(0,80),createdAt:Date.now()};
  bookmarks.unshift(row); saveBookmarks(); return row;
}
function removeBookmark(idOrUrl){
  const key=String(idOrUrl||''); const n=bookmarks.length; bookmarks=bookmarks.filter(b=>b.id!==key&&b.url!==key); if(bookmarks.length!==n) saveBookmarks(); return {ok:bookmarks.length!==n};
}
function listBookmarks(q=''){
  const needle=String(q||'').trim().toLowerCase();
  return bookmarks.filter(r=>!needle||r.title.toLowerCase().includes(needle)||r.url.toLowerCase().includes(needle)).slice(0,500);
}
function isBookmarked(url){ const clean=safeUrl(url); return !!clean&&bookmarks.some(b=>b.url===clean); }
module.exports={init,recordVisit,importHistory,listHistory,clearHistory,addBookmark,removeBookmark,listBookmarks,isBookmarked,safeUrl};
