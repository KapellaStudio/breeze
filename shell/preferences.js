/* Persistent Breeze chrome preferences. No browsing content lives here and
   nothing leaves the device. The renderer may only read/write this allowlist. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

let file = null;
const DEFAULTS = Object.freeze({
  theme: 'light',
  accent: 'blue',
  density: 'standard',
  tabs: 'side',
  newtab: 'continue',
  comfort: 'comfort',
  sidebar: 'on',
  compact: false,
  // Real renderer discard/version polling are not enabled in this Electron RC.
  // Keep their stored defaults off rather than persisting a visual promise.
  sleep: false,
  tint: true,
  group: true,
  askwhere: false,
  provenance: true,
  versionDetection: false
});
let state = { ...DEFAULTS };

const ENUMS = {
  theme: new Set(['light','dark','auto']),
  accent: new Set(['blue','cyan','teal','mint']),
  density: new Set(['compact','standard','spacious']),
  tabs: new Set(['side','classic']),
  newtab: new Set(['continue','blank','links','queue']),
  comfort: new Set(['bright','comfort','dim']),
  sidebar: new Set(['on','auto','off'])
};
const BOOLS = new Set(['compact','sleep','tint','group','askwhere','provenance','versionDetection']);

function atomicWrite(value){
  if(!file) return;
  const tmp=file+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(value,null,2),'utf8');
  fs.renameSync(tmp,file);
}
function normalize(raw={}){
  const out={...DEFAULTS};
  for(const [key,allowed] of Object.entries(ENUMS)){
    if(allowed.has(raw[key])) out[key]=raw[key];
  }
  for(const key of BOOLS) if(typeof raw[key]==='boolean') out[key]=raw[key];
  // Migrate the short-lived boolean rail preference from early RC builds.
  if(!ENUMS.sidebar.has(raw.sidebar) && typeof raw.rail==='boolean') out.sidebar=raw.rail?'auto':'on';
  // Old prototypes used neutral/warm labels that never existed in the UI.
  if(raw.comfort==='neutral') out.comfort='comfort';
  if(raw.comfort==='warm') out.comfort='dim';
  // Unsupported switches remain off even if an earlier build persisted them on.
  out.sleep=false;
  out.versionDetection=false;
  return out;
}
function init(userDataPath){
  file=path.join(userDataPath,'preferences.json');
  try{state=normalize(JSON.parse(fs.readFileSync(file,'utf8')));}catch{state={...DEFAULTS};}
}
function get(){return {...state};}
function set(key,value){
  key=String(key||'');
  if(ENUMS[key]){
    if(!ENUMS[key].has(value)) return {error:'invalid preference value'};
    state[key]=value;
  } else if(BOOLS.has(key)){
    if(typeof value!=='boolean') return {error:'invalid preference value'};
    if(key==='sleep'||key==='versionDetection') value=false;
    state[key]=value;
  } else return {error:'unknown preference'};
  atomicWrite(state); return {ok:true,preferences:get()};
}
function setMany(patch={}){
  if(!patch||typeof patch!=='object'||Array.isArray(patch)) return {error:'invalid preferences'};
  const next={...state};
  for(const [key,input] of Object.entries(patch)){
    let value=input;
    if(ENUMS[key]){if(!ENUMS[key].has(value))return {error:`invalid ${key}`};next[key]=value;}
    else if(BOOLS.has(key)){
      if(typeof value!=='boolean')return {error:`invalid ${key}`};
      if(key==='sleep'||key==='versionDetection') value=false;
      next[key]=value;
    }
    else return {error:`unknown preference ${key}`};
  }
  state=next; atomicWrite(state); return {ok:true,preferences:get()};
}
function reset(){state={...DEFAULTS};atomicWrite(state);return get();}
module.exports={init,get,set,setMany,reset,DEFAULTS};
