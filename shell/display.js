/* Breeze screen-sharing broker.
   getDisplayMedia is separate from ordinary camera/mic permission. The page
   never receives the raw desktopCapturer source list directly; Breeze chrome
   gets a sanitized chooser model and returns one opaque source id. */
'use strict';
const crypto=require('node:crypto');
const { desktopCapturer }=require('electron');
const pending=new Map();
function originOf(raw){ try{const u=new URL(raw); const loop=['localhost','127.0.0.1','::1'].includes(u.hostname); if(u.protocol!=='https:'&&!(u.protocol==='http:'&&loop))return null; return u.origin;}catch{return null;} }
function safeSource(s){ return {id:String(s.id||'').slice(0,300),name:String(s.name||'Screen').slice(0,180),type:String(s.id||'').startsWith('screen:')?'screen':'window'}; }
function attach(ses,emit){
  if(typeof ses.setDisplayMediaRequestHandler!=='function') return;
  ses.setDisplayMediaRequestHandler(async(request,callback)=>{
    const origin=originOf(request.securityOrigin||request.frame?.url||'');
    if(!origin || !request.userGesture || !request.videoRequested) return callback({});
    let sources=[]; try{ sources=await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:0,height:0},fetchWindowIcons:false}); }catch{return callback({});}
    if(!sources.length)return callback({});
    const id=crypto.randomUUID(); const timer=setTimeout(()=>{const p=pending.get(id);if(p){pending.delete(id);try{p.callback({});}catch{}}},30000);
    pending.set(id,{callback,sources,timer,origin});
    emit('display:request',{id,origin,host:new URL(origin).hostname,sources:sources.map(safeSource),audioRequested:!!request.audioRequested});
  },{useSystemPicker:true});
}
function respond(id,sourceId){
  const p=pending.get(String(id||'')); if(!p)return {error:'screen-share request expired'};
  pending.delete(String(id)); clearTimeout(p.timer);
  const source=p.sources.find(s=>String(s.id)===String(sourceId||''));
  if(!source){try{p.callback({});}catch{} return {ok:true,shared:false};}
  // Screen audio stays off until Breeze has a platform-tested loopback toggle.
  try{p.callback({video:source});}catch{}
  return {ok:true,shared:true};
}
function cancel(id){return respond(id,'');}
module.exports={attach,respond,cancel,originOf,safeSource};
