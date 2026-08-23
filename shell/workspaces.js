/* Breeze workspace registry.
   A workspace is browser organization plus an optional sealed session boundary.
   No identity/email is invented or stored here; web-account state lives in the
   Chromium session itself. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
let file=null;
let rows=[];
const ACCENTS=new Set(['blue','cyan','teal','mint']);
const MAX=32;
function cleanName(v){return String(v||'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,80);}
function normalize(row){
  if(!row||typeof row!=='object')return null;
  const id=String(row.id||'').replace(/[^a-z0-9_-]/gi,'-').slice(0,80);
  const name=cleanName(row.name);
  if(!id||!name)return null;
  return {id,name,sealed:!!row.sealed,accent:ACCENTS.has(row.accent)?row.accent:'blue',createdAt:Number(row.createdAt)||Date.now()};
}
function defaults(){return [{id:'default',name:'Personal',sealed:false,accent:'blue',createdAt:Date.now()}];}
function write(){if(!file)return;const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(rows,null,2),'utf8');fs.renameSync(tmp,file);}
function init(userDataPath){
  file=path.join(userDataPath,'workspaces.json');
  try{const raw=JSON.parse(fs.readFileSync(file,'utf8'));rows=Array.isArray(raw)?raw.map(normalize).filter(Boolean).slice(0,MAX):defaults();}catch{rows=defaults();}
  if(!rows.some(r=>r.id==='default'))rows.unshift(defaults()[0]);
  rows=rows.slice(0,MAX);write();
}
function list(){return rows.map(r=>({...r}));}
function get(id){const r=rows.find(x=>x.id===String(id||''));return r?{...r}:null;}
function create({name,sealed=false,accent='blue'}={}){
  if(rows.length>=MAX)return{error:'workspace limit reached'};
  name=cleanName(name);if(!name)return{error:'workspace name required'};
  const id='ws-'+crypto.randomUUID();
  const row={id,name,sealed:!!sealed,accent:ACCENTS.has(accent)?accent:'blue',createdAt:Date.now()};
  rows.push(row);write();return{ok:true,workspace:{...row}};
}
function update(id,patch={}){
  const row=rows.find(x=>x.id===String(id||''));if(!row)return{error:'workspace not found'};
  if(Object.prototype.hasOwnProperty.call(patch,'name')){const n=cleanName(patch.name);if(!n)return{error:'workspace name required'};row.name=n;}
  if(Object.prototype.hasOwnProperty.call(patch,'sealed')&&row.id!=='default')row.sealed=!!patch.sealed;
  if(Object.prototype.hasOwnProperty.call(patch,'accent')){if(!ACCENTS.has(patch.accent))return{error:'invalid accent'};row.accent=patch.accent;}
  write();return{ok:true,workspace:{...row}};
}
function remove(id){
  id=String(id||'');if(id==='default')return{error:'Personal workspace cannot be removed'};
  const n=rows.length;rows=rows.filter(r=>r.id!==id);if(rows.length===n)return{error:'workspace not found'};write();return{ok:true};
}
module.exports={init,list,get,create,update,remove,MAX};
