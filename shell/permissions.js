/* Breeze site-permission broker.
   Unknown or unsafe requests fail closed. User decisions are keyed to a real
   http(s) origin, never a display hostname, and persistent grants stay local.

   PRIVATE SESSIONS
   Private browsing gets a separate ephemeral decision map. Even when the UI
   says "always allow", that grant lasts only for the current private session
   and is never written to permissions.json. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const AUTO_ALLOW=new Set(['fullscreen','clipboard-sanitized-write']);
const PROMPT=new Set(['media','geolocation','notifications','clipboard-read','midi','pointerLock','keyboardLock','speaker-selection','window-management','fileSystem','openExternal']);
const HARD_BLOCK=new Set(['unknown','midiSysex']);
let file=null, emit=()=>{}, saved={}, pending=new Map(), once=new Set();
const privateMaps=new WeakMap();

function init(userDataPath, sender){
  file=path.join(userDataPath,'permissions.json'); emit=typeof sender==='function'?sender:()=>{};
  try{saved=JSON.parse(fs.readFileSync(file,'utf8'))||{};}catch{saved={};}
}
function save(){ if(file) fs.writeFileSync(file,JSON.stringify(saved,null,2)); }
function cleanOrigin(raw){
  try{
    const u=new URL(raw); const loop=['localhost','127.0.0.1','::1'].includes(u.hostname);
    if(u.protocol!=='https:' && !(u.protocol==='http:'&&loop)) return null;
    return u.origin;
  }catch{return null;}
}
function key(origin,permission){ return origin+'|'+permission; }
function decision(origin,permission){
  if(!origin || HARD_BLOCK.has(permission)) return 'block';
  if(AUTO_ALLOW.has(permission)) return 'allow';
  const k=key(origin,permission); if(once.has(k)) return 'allow';
  return saved[k]||'ask';
}
function privateDecision(origin,permission,map){
  if(!origin || HARD_BLOCK.has(permission)) return 'block';
  if(AUTO_ALLOW.has(permission)) return 'allow';
  return map.get(key(origin,permission)) || 'ask';
}
function safeDetails(permission,details={}){
  const out={};
  if(permission==='media' && Array.isArray(details.mediaTypes)) out.mediaTypes=details.mediaTypes.filter(x=>['audio','video'].includes(x)).slice(0,2);
  if(permission==='fileSystem') out.access=String(details.fileAccessType||'').slice(0,30);
  return out;
}
function makePending(webContents,permission,callback,details,privateMap=null){
  const raw=details.requestingUrl || details.requestingOrigin || webContents?.getURL?.() || '';
  const origin=cleanOrigin(raw);
  const d=privateMap ? privateDecision(origin,permission,privateMap) : decision(origin,permission);
  if(d==='allow') return callback(true);
  if(d==='block' || !PROMPT.has(permission)) return callback(false);
  const id=crypto.randomUUID();
  const timer=setTimeout(()=>{ const p=pending.get(id); if(p){pending.delete(id); try{p.callback(false);}catch{}} },30000);
  pending.set(id,{callback,origin,permission,timer,privateMap});
  emit('permission:request',{id,origin,host:new URL(origin).hostname,permission,private:!!privateMap,details:safeDetails(permission,details)});
}
function request(webContents,permission,callback,details={}){ return makePending(webContents,permission,callback,details,null); }
function check(_webContents,permission,requestingOrigin,details={}){
  const raw=details.requestingUrl || details.securityOrigin || requestingOrigin || '';
  const origin=cleanOrigin(raw);
  return decision(origin,permission)==='allow';
}
function respond(id,value){
  const p=pending.get(String(id||'')); if(!p) return {error:'permission request expired'};
  pending.delete(String(id)); clearTimeout(p.timer);
  const v=String(value||'block'); const k=key(p.origin,p.permission);
  if(p.privateMap){
    // Private mode never writes a site decision to disk. "Always" means for
    // this private session only; closing the final private tab destroys it.
    if(v==='always' || v==='once') p.privateMap.set(k,'allow');
    else if(v==='block') p.privateMap.set(k,'block');
    else return {error:'invalid permission decision'};
  } else {
    if(v==='always'){ saved[k]='allow'; save(); }
    else if(v==='block'){ saved[k]='block'; save(); }
    else if(v==='once') once.add(k);
    else return {error:'invalid permission decision'};
  }
  try{p.callback(v!=='block');}catch{}
  return {ok:true,private:!!p.privateMap};
}
function attach(ses,opts={}){
  const privateMode=!!opts.private;
  const local=privateMode ? new Map() : null;
  if(local) privateMaps.set(ses,local);
  ses.setPermissionRequestHandler((wc,permission,callback,details)=>makePending(wc,permission,callback,details||{},local));
  ses.setPermissionCheckHandler((wc,permission,origin,details)=>{
    const raw=(details||{}).requestingUrl || (details||{}).securityOrigin || origin || '';
    const o=cleanOrigin(raw);
    return (local ? privateDecision(o,permission,local) : decision(o,permission))==='allow';
  });
  // Device APIs (USB/HID/serial) remain blocked until Breeze has a dedicated
  // chooser UI. Silently granting hardware is not acceptable.
  if(typeof ses.setDevicePermissionHandler==='function') ses.setDevicePermissionHandler(()=>false);
}
function clearPrivate(ses){
  const map=privateMaps.get(ses); if(map) map.clear(); privateMaps.delete(ses);
  for(const [id,p] of pending){ if(p.privateMap===map){ pending.delete(id); clearTimeout(p.timer); try{p.callback(false);}catch{} } }
}
function list(){
  return Object.entries(saved).map(([k,v])=>{const i=k.lastIndexOf('|'); return {origin:k.slice(0,i),permission:k.slice(i+1),decision:v};});
}
function reset(origin,permission){
  const o=cleanOrigin(origin); if(!o)return {error:'invalid origin'}; delete saved[key(o,String(permission||''))]; save(); return {ok:true};
}
module.exports={init,attach,clearPrivate,respond,list,reset,cleanOrigin,decision,request,check,AUTO_ALLOW,PROMPT};
