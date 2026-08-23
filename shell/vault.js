/* Breeze Vault — local credential storage protected by Electron safeStorage.
   Passwords are never returned to the chrome renderer. Copy operations happen
   in the main process and clear the clipboard after a short timeout when the
   clipboard still contains the copied secret. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

let file=null;
let rows=[];
let crypt=null;
let clip=null;
let platform=process.platform;
const MAX=2000;

function atomic(){if(!file)return;const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(rows,null,2),'utf8');fs.renameSync(tmp,file);}
function safeRead(){try{const v=JSON.parse(fs.readFileSync(file,'utf8'));return Array.isArray(v)?v:[];}catch{return[];}}
function clean(v,n){return String(v||'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,n);}
function normalizeOrigin(raw){
  const value=String(raw||'').trim();
  try{const u=new URL(/^[a-z][a-z0-9+.-]*:/i.test(value)?value:'https://'+value);if(!['http:','https:'].includes(u.protocol))return null;return u.origin;}
  catch{return null;}
}
function init(userDataPath,cryptoProvider,clipboardProvider,platformOverride){
  file=path.join(userDataPath,'vault.json');crypt=cryptoProvider;clip=clipboardProvider;platform=platformOverride||process.platform;
  rows=safeRead().filter(r=>r&&typeof r.id==='string'&&normalizeOrigin(r.origin)&&typeof r.usernameCipher==='string'&&typeof r.passwordCipher==='string').slice(0,MAX);
}
async function securityStatus(){
  if(!crypt)return{available:false,backend:'unavailable',reason:'OS encryption service unavailable'};
  let available=false;try{available=typeof crypt.isAsyncEncryptionAvailable==='function'?await crypt.isAsyncEncryptionAvailable():!!crypt.isEncryptionAvailable?.();}catch{}
  let backend=platform==='linux'?'unknown':platform==='darwin'?'Keychain':platform==='win32'?'DPAPI':'OS encryption';
  if(platform==='linux'&&typeof crypt.getSelectedStorageBackend==='function'){try{backend=crypt.getSelectedStorageBackend();}catch{}}
  if(!available)return{available:false,backend,reason:'OS encryption is not available yet'};
  if(platform==='linux'&&backend==='basic_text')return{available:false,backend,reason:'Linux has no secure keyring available; Breeze refuses the basic_text fallback'};
  return{available:true,backend};
}
async function requireSecure(){const s=await securityStatus();if(!s.available)throw new Error(s.reason||'secure storage unavailable');return s;}
async function encrypt(value){
  await requireSecure();
  let buf;
  if(typeof crypt.encryptStringAsync==='function')buf=await crypt.encryptStringAsync(String(value));
  else buf=crypt.encryptString(String(value));
  return Buffer.from(buf).toString('base64');
}
async function decrypt(cipher){
  await requireSecure();const buf=Buffer.from(String(cipher||''),'base64');
  if(typeof crypt.decryptStringAsync==='function'){
    const out=await crypt.decryptStringAsync(buf);return typeof out==='string'?out:String(out?.result||'');
  }
  return crypt.decryptString(buf);
}
async function publicRow(r){
  let username='';try{username=await decrypt(r.usernameCipher);}catch{}
  return{id:r.id,origin:r.origin,label:r.label||'',username,createdAt:r.createdAt,updatedAt:r.updatedAt};
}
async function list(query=''){
  const q=String(query||'').trim().toLowerCase();const out=[];
  for(const r of rows){const p=await publicRow(r);if(!q||p.origin.toLowerCase().includes(q)||p.label.toLowerCase().includes(q)||p.username.toLowerCase().includes(q))out.push(p);}
  return out;
}
async function add({origin,label,username,password}={}){
  const secure=await securityStatus();if(!secure.available)return{error:secure.reason,backend:secure.backend};
  origin=normalizeOrigin(origin);if(!origin)return{error:'Enter a valid website or domain'};
  username=String(username||'').slice(0,512);password=String(password||'').slice(0,4096);if(!username&&!password)return{error:'Enter a username or password'};
  const now=Date.now();const existing=rows.find(r=>r.origin===origin&&r.label===clean(label,120));
  const usernameCipher=await encrypt(username),passwordCipher=await encrypt(password);
  if(existing){existing.usernameCipher=usernameCipher;existing.passwordCipher=passwordCipher;existing.updatedAt=now;atomic();return{ok:true,updated:true,credential:await publicRow(existing)};}
  if(rows.length>=MAX)return{error:'vault limit reached'};
  const row={id:crypto.randomUUID(),origin,label:clean(label,120),usernameCipher,passwordCipher,createdAt:now,updatedAt:now};rows.unshift(row);atomic();return{ok:true,credential:await publicRow(row)};
}
async function update(id,patch={}){
  const row=rows.find(r=>r.id===String(id||''));if(!row)return{error:'credential not found'};
  const secure=await securityStatus();if(!secure.available)return{error:secure.reason,backend:secure.backend};
  if(Object.prototype.hasOwnProperty.call(patch,'origin')){const o=normalizeOrigin(patch.origin);if(!o)return{error:'Enter a valid website or domain'};row.origin=o;}
  if(Object.prototype.hasOwnProperty.call(patch,'label'))row.label=clean(patch.label,120);
  if(Object.prototype.hasOwnProperty.call(patch,'username'))row.usernameCipher=await encrypt(String(patch.username||'').slice(0,512));
  if(Object.prototype.hasOwnProperty.call(patch,'password'))row.passwordCipher=await encrypt(String(patch.password||'').slice(0,4096));
  row.updatedAt=Date.now();atomic();return{ok:true,credential:await publicRow(row)};
}
function remove(id){const key=String(id||'');const n=rows.length;rows=rows.filter(r=>r.id!==key);if(n!==rows.length)atomic();return{ok:n!==rows.length};}
function clearClipboardLater(value){
  if(!clip)return;setTimeout(()=>{try{if(clip.readText()===value)clip.clear();}catch{}},30000).unref?.();
}
async function copyField(id,field){
  const row=rows.find(r=>r.id===String(id||''));if(!row)return{error:'credential not found'};
  if(!clip)return{error:'clipboard unavailable'};
  const value=field==='username'?await decrypt(row.usernameCipher):field==='password'?await decrypt(row.passwordCipher):'';
  if(!value)return{error:`${field} is empty`};clip.writeText(value);clearClipboardLater(value);return{ok:true,field,clearsInSeconds:30};
}
function parseCsv(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"')quoted=false;else field+=ch;}
    else if(ch==='"')quoted=true;else if(ch===','){row.push(field);field='';}else if(ch==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}else field+=ch;
  }
  if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}return rows;
}
async function importCsv(filePath){
  const secure=await securityStatus();if(!secure.available)return{error:secure.reason,backend:secure.backend};
  let text;try{text=fs.readFileSync(filePath,'utf8');}catch{return{error:'Could not read that CSV file'};}
  if(text.length>20*1024*1024)return{error:'Credential CSV is too large'};
  const parsed=parseCsv(text);if(parsed.length<2)return{error:'No credentials found'};
  const header=parsed[0].map(x=>x.trim().toLowerCase());const idx=n=>header.indexOf(n);
  const urlIndex=Math.max(idx('url'),idx('origin'));const userIndex=Math.max(idx('username'),idx('user'));const passIndex=idx('password');const nameIndex=Math.max(idx('name'),idx('label'));
  if(urlIndex<0||passIndex<0)return{error:'CSV needs at least url and password columns'};
  let imported=0,skipped=0;
  for(const cols of parsed.slice(1,5001)){
    const origin=normalizeOrigin(cols[urlIndex]);const password=String(cols[passIndex]||'');if(!origin||!password){skipped++;continue;}
    const result=await add({origin,label:nameIndex>=0?cols[nameIndex]:'',username:userIndex>=0?cols[userIndex]:'',password});if(result.ok)imported++;else skipped++;
  }
  return{ok:true,imported,skipped};
}
module.exports={init,securityStatus,list,add,update,remove,copyField,importCsv,normalizeOrigin,parseCsv};
