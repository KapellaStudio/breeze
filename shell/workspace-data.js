/* Breeze local context library: Reading Queue, Notes and workspace snapshots.
   These records are explicit user-created context. They stay in userData and
   are never synchronized or sent to Supabase. Automatic snapshots omit Private
   tabs and local-file paths. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
let file=null;
let data={queue:[],notes:[],snapshots:[]};
const LIMITS={queue:1000,notes:2000,snapshots:200};
function atomic(){if(!file)return;const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2),'utf8');fs.renameSync(tmp,file);}
function safeRead(){try{const v=JSON.parse(fs.readFileSync(file,'utf8'));return v&&typeof v==='object'?v:null;}catch{return null;}}
function safeUrl(raw){try{const u=new URL(String(raw||''));return ['http:','https:'].includes(u.protocol)?u.toString():null;}catch{return null;}}
function text(v,n){return String(v||'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0,n);}
function ws(v){return text(v||'default',80)||'default';}
function init(userDataPath){
  file=path.join(userDataPath,'workspace-data.json');
  const raw=safeRead()||{};
  data.queue=Array.isArray(raw.queue)?raw.queue.filter(x=>x&&x.id&&safeUrl(x.url)).slice(0,LIMITS.queue):[];
  data.notes=Array.isArray(raw.notes)?raw.notes.filter(x=>x&&x.id&&typeof x.body==='string').slice(0,LIMITS.notes):[];
  data.snapshots=Array.isArray(raw.snapshots)?raw.snapshots.filter(x=>x&&x.id&&Array.isArray(x.tabs)).slice(0,LIMITS.snapshots):[];
}
function listQueue(workspace){const w=workspace?ws(workspace):null;return data.queue.filter(x=>!w||x.workspace===w).map(x=>({...x}));}
function addQueue(item={}){
  const url=safeUrl(item.url);if(!url)return{error:'Only web pages can be added to the reading queue'};
  const workspace=ws(item.workspace);const existing=data.queue.find(x=>x.url===url&&x.workspace===workspace);
  if(existing){existing.title=text(item.title||existing.title,300);existing.source=text(item.source||existing.source,300);existing.addedAt=Date.now();data.queue=[existing,...data.queue.filter(x=>x!==existing)];atomic();return{ok:true,existing:true,item:{...existing}};}
  const row={id:crypto.randomUUID(),url,title:text(item.title||url,300),source:text(item.source,300),workspace,addedAt:Date.now()};
  data.queue.unshift(row);data.queue=data.queue.slice(0,LIMITS.queue);atomic();return{ok:true,item:{...row}};
}
function removeQueue(id){const key=String(id||'');const n=data.queue.length;data.queue=data.queue.filter(x=>x.id!==key);if(n!==data.queue.length)atomic();return{ok:n!==data.queue.length};}
function moveQueueTop(id){const key=String(id||'');const i=data.queue.findIndex(x=>x.id===key);if(i<0)return{error:'queue item not found'};const [row]=data.queue.splice(i,1);data.queue.unshift(row);atomic();return{ok:true};}
function clearQueue(workspace){const w=ws(workspace);const n=data.queue.length;data.queue=data.queue.filter(x=>x.workspace!==w);if(n!==data.queue.length)atomic();return{ok:true,removed:n-data.queue.length};}

function listNotes(workspace){const w=workspace?ws(workspace):null;return data.notes.filter(x=>!w||x.workspace===w).map(x=>({...x}));}
function addNote(item={}){
  const body=text(item.body,12000);if(!body)return{error:'note is empty'};
  const url=safeUrl(item.url)||'';
  const row={id:crypto.randomUUID(),url,title:text(item.title||'Untitled page',300),workspace:ws(item.workspace),body,kind:item.kind==='highlight'?'highlight':'note',createdAt:Date.now(),updatedAt:Date.now()};
  data.notes.unshift(row);data.notes=data.notes.slice(0,LIMITS.notes);atomic();return{ok:true,note:{...row}};
}
function updateNote(id,body){const row=data.notes.find(x=>x.id===String(id||''));if(!row)return{error:'note not found'};body=text(body,12000);if(!body)return{error:'note is empty'};row.body=body;row.updatedAt=Date.now();atomic();return{ok:true,note:{...row}};}
function removeNote(id){const key=String(id||'');const n=data.notes.length;data.notes=data.notes.filter(x=>x.id!==key);if(n!==data.notes.length)atomic();return{ok:n!==data.notes.length};}

function normalizeSnapshotTabs(tabs){
  const out=[];
  for(const t of Array.isArray(tabs)?tabs:[]){
    if(!t||t.private)continue;
    const url=safeUrl(t.url);if(!url)continue;
    out.push({url,title:text(t.title||url,300),workspace:ws(t.workspace),sealed:!!t.sealed});
    if(out.length>=100)break;
  }
  return out;
}
function sameTabs(a,b){if(a.length!==b.length)return false;return a.every((x,i)=>x.url===b[i].url&&x.workspace===b[i].workspace&&x.sealed===b[i].sealed);}
function saveSnapshot(item={}){
  const tabs=normalizeSnapshotTabs(item.tabs);if(!tabs.length)return{error:'No restorable web tabs to snapshot'};
  const workspace=ws(item.workspace);const now=Date.now();
  const latest=data.snapshots.find(x=>x.workspace===workspace);
  if(latest&&now-Number(latest.createdAt||0)<120000&&sameTabs(latest.tabs,tabs))return{ok:true,unchanged:true,snapshot:{...latest,tabs:latest.tabs.map(t=>({...t}))}};
  const row={id:crypto.randomUUID(),workspace,label:text(item.label,120),createdAt:now,tabs};
  data.snapshots.unshift(row);data.snapshots=data.snapshots.slice(0,LIMITS.snapshots);atomic();return{ok:true,snapshot:{...row,tabs:tabs.map(t=>({...t}))}};
}
function listSnapshots(workspace){const w=workspace?ws(workspace):null;return data.snapshots.filter(x=>!w||x.workspace===w).map(x=>({...x,tabs:x.tabs.map(t=>({...t}))}));}
function removeSnapshot(id){const key=String(id||'');const n=data.snapshots.length;data.snapshots=data.snapshots.filter(x=>x.id!==key);if(n!==data.snapshots.length)atomic();return{ok:n!==data.snapshots.length};}
module.exports={init,listQueue,addQueue,removeQueue,moveQueueTop,clearQueue,listNotes,addNote,updateNote,removeNote,saveSnapshot,listSnapshots,removeSnapshot,safeUrl};
