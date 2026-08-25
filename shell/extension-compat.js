/* Breeze managed extension compatibility layer.

   Electron 43 supplies a strong MV3 floor, but browser-shaped products still
   need Chrome APIs that Electron intentionally does not implement. This module
   fills those gaps only inside Breeze's managed MV3 extension copies.

   Security rules:
   - Never mutate the user's source directory; only Breeze's managed copy.
   - Keep pristine worker/manifest backups outside the loadable extension tree.
   - Bind RPC to 127.0.0.1 only and use a random per-extension bearer token.
   - Expose only an allowlisted method set derived from the manifest.
   - Reject Private Browsing runtime registration.
   - Fail closed when one extension runtime maps to multiple Breeze sessions;
     never guess which cookie jar/workspace an RPC belongs to.
*/
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const LOOPBACK_PERMISSION = 'http://127.0.0.1/*';
const MAX_BODY = 64 * 1024;
const PATCH_MARKER = '/* BREEZE_EXTENSION_COMPAT_V2 */';
const EARLY_IDENTITY_MARKER = '/* BREEZE_EARLY_IDENTITY_V1 */';
const BASE_METHODS = new Set([
  'tabs.create','tabs.query','tabs.get','tabs.getCurrent','tabs.update','tabs.remove',
  'windows.create','windows.getAll','windows.getCurrent','windows.getLastFocused',
  'windows.update','windows.remove'
]);
const COOKIE_METHODS = new Set(['cookies.get','cookies.getAll','cookies.set','cookies.remove']);
const NOTIFICATION_METHODS = new Set(['notifications.create','notifications.clear']);
const IDENTITY_METHODS = new Set(['identity.launchWebAuthFlow']);

let rootDir = null;
let originalsDir = null;
let server = null;
let endpoint = '';
let startPromise = null;
let handlers = Object.create(null);
const entriesByLocalId = new Map();
const entriesByToken = new Map();

function safeLocalId(value){
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) throw new Error('invalid extension local id');
  return id;
}
function isInside(root, target){
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function safeRelativeFile(base, relative, label='extension file'){
  const rel = String(relative || '').replace(/\\/g,'/');
  if (!rel || rel.startsWith('/') || rel.includes('\0') || rel.split('/').includes('..')) throw new Error(`${label} path is invalid`);
  const full = path.resolve(base, rel);
  if (!isInside(base, full)) throw new Error(`${label} escaped extension directory`);
  return { rel, full };
}
function readJson(file){ return JSON.parse(fs.readFileSync(file,'utf8')); }
function writeJson(file, value){ fs.writeFileSync(file, JSON.stringify(value,null,2) + '\n', 'utf8'); }
function mkdirFor(file){ fs.mkdirSync(path.dirname(file),{recursive:true}); }
function clone(value){ return JSON.parse(JSON.stringify(value)); }

function manifestPermissions(manifest){
  const list = [];
  for (const key of ['permissions','optional_permissions']) {
    if (Array.isArray(manifest?.[key])) list.push(...manifest[key].filter(x=>typeof x==='string'));
  }
  return new Set(list);
}
function allowedMethodsForManifest(manifest){
  const mv = Number(manifest?.manifest_version || 0);
  const worker = manifest?.background && typeof manifest.background === 'object' ? manifest.background.service_worker : null;
  if (mv !== 3 || typeof worker !== 'string' || !worker.trim()) return new Set();
  const out = new Set(BASE_METHODS);
  const perms = manifestPermissions(manifest);
  if (perms.has('cookies')) for (const method of COOKIE_METHODS) out.add(method);
  if (perms.has('notifications')) for (const method of NOTIFICATION_METHODS) out.add(method);
  if (perms.has('identity')) for (const method of IDENTITY_METHODS) out.add(method);
  return out;
}
function backgroundWorker(manifest){
  const worker = manifest?.background && typeof manifest.background === 'object' ? manifest.background.service_worker : null;
  return typeof worker === 'string' && worker.trim() ? worker.trim() : '';
}
function moduleBackground(manifest){
  return Number(manifest?.manifest_version||0)===3 && manifest?.background?.type==='module';
}

function init(options={}){
  const nextRoot = path.resolve(String(options.rootDir || ''));
  if (!nextRoot) throw new Error('extension compatibility rootDir is required');
  if (rootDir && rootDir !== nextRoot) throw new Error('extension compatibility already initialized for another root');
  rootDir = nextRoot;
  originalsDir = path.join(rootDir,'.compat-originals');
  fs.mkdirSync(rootDir,{recursive:true});
  fs.mkdirSync(originalsDir,{recursive:true});
  handlers = options.handlers && typeof options.handlers === 'object' ? options.handlers : Object.create(null);
  return { ready:true };
}
function setHandlers(next){ handlers = next && typeof next === 'object' ? next : Object.create(null); }

function corsOrigin(req){
  const origin = String(req.headers.origin || '');
  return /^chrome-extension:\/\/[a-p]{32}$/i.test(origin) ? origin : '';
}
function jsonResponse(res,status,body,origin=''){
  const headers = {'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'};
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers['vary'] = 'Origin';
  }
  res.writeHead(status,headers);
  res.end(JSON.stringify(body));
}
function authToken(req){
  const raw = String(req.headers.authorization || '');
  return raw.startsWith('Bearer ') ? raw.slice(7) : '';
}
function tokenEntry(token){
  if (!token || token.length !== 64 || !/^[0-9a-f]+$/i.test(token)) return null;
  return entriesByToken.get(token) || null;
}
function runtimeIdFromOrigin(origin){
  const m = String(origin || '').match(/^chrome-extension:\/\/([a-p]{32})$/i);
  return m ? m[1] : '';
}
function selectRuntime(entry, runtimeId){
  const rows = [...entry.runtimes.values()].filter(x => !runtimeId || x.runtimeId === runtimeId);
  if (rows.length === 1) return { context:rows[0], ambiguous:false };
  if (rows.length > 1) return { context:null, ambiguous:true };
  return { context:null, ambiguous:false };
}
function methodHandler(method){
  return typeof handlers[method] === 'function' ? handlers[method] : null;
}

async function readBody(req){
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('request too large'),{status:413});
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error('invalid JSON'),{status:400}); }
}

function closeRuntimeEvents(context){
  if(!context)return;
  for(const waiter of [...(context.eventWaiters||[])]){
    try{waiter.finish([]);}catch{}
  }
  if(Array.isArray(context.events))context.events.length=0;
}
function waitRuntimeEvent(context,res,origin){
  if(!Array.isArray(context.events))context.events=[];
  if(!(context.eventWaiters instanceof Set))context.eventWaiters=new Set();
  if(context.events.length){
    const events=context.events.splice(0,Math.min(16,context.events.length));
    jsonResponse(res,200,{events},origin);
    return;
  }
  const waiter={closed:false,timer:null,finish:null};
  waiter.finish=(events=[])=>{
    if(waiter.closed)return;
    waiter.closed=true;
    if(waiter.timer)clearTimeout(waiter.timer);
    context.eventWaiters.delete(waiter);
    try{jsonResponse(res,200,{events:Array.isArray(events)?events:[]},origin);}catch{}
  };
  waiter.timer=setTimeout(()=>waiter.finish([]),25000);
  context.eventWaiters.add(waiter);
  res.once('close',()=>{
    if(waiter.closed)return;
    waiter.closed=true;
    if(waiter.timer)clearTimeout(waiter.timer);
    context.eventWaiters.delete(waiter);
  });
}
async function handleEvents(req,res){
  const origin=corsOrigin(req);
  if(req.method!=='POST'||req.url!=='/events'){jsonResponse(res,404,{error:'not found'},origin);return;}
  const entry=tokenEntry(authToken(req));
  if(!entry){jsonResponse(res,401,{error:'unauthorized'},origin);return;}
  let body;
  try{body=await readBody(req);}
  catch(err){jsonResponse(res,Number(err.status||400),{error:String(err.message||err)},origin);return;}
  const originRuntime=runtimeIdFromOrigin(origin);
  const requestedRuntime=String(body?.runtimeId||'');
  if(originRuntime&&requestedRuntime&&originRuntime!==requestedRuntime){jsonResponse(res,403,{error:'extension origin mismatch'},origin);return;}
  const picked=selectRuntime(entry,originRuntime||requestedRuntime);
  if(picked.ambiguous){jsonResponse(res,409,{error:'extension runtime is active in multiple Breeze sessions'},origin);return;}
  if(!picked.context){jsonResponse(res,503,{error:'extension runtime is not registered yet'},origin);return;}
  if(picked.context.private){jsonResponse(res,403,{error:'extensions are unavailable in Private Browsing'},origin);return;}
  waitRuntimeEvent(picked.context,res,origin);
}

async function handleRpc(req,res){
  const origin = corsOrigin(req);
  if (req.method === 'OPTIONS') {
    if (!origin) { res.writeHead(403); res.end(); return; }
    res.writeHead(204,{
      'access-control-allow-origin':origin,
      'access-control-allow-methods':'POST, OPTIONS',
      'access-control-allow-headers':'authorization, content-type',
      'access-control-max-age':'300',
      'cache-control':'no-store','vary':'Origin'
    });
    res.end(); return;
  }
  if (req.method !== 'POST' || req.url !== '/rpc') { jsonResponse(res,404,{error:'not found'},origin); return; }
  const entry = tokenEntry(authToken(req));
  if (!entry) { jsonResponse(res,401,{error:'unauthorized'},origin); return; }

  let body;
  try { body = await readBody(req); }
  catch (err) { jsonResponse(res,Number(err.status||400),{error:String(err.message||err)},origin); return; }
  const method = String(body?.method || '');
  if (!entry.allowed.has(method)) { jsonResponse(res,403,{error:'method not allowed'},origin); return; }

  const originRuntime = runtimeIdFromOrigin(origin);
  const requestedRuntime = String(body?.runtimeId || '');
  if (originRuntime && requestedRuntime && originRuntime !== requestedRuntime) {
    jsonResponse(res,403,{error:'extension origin mismatch'},origin); return;
  }
  const runtimeId = originRuntime || requestedRuntime;
  const picked = selectRuntime(entry,runtimeId);
  if (picked.ambiguous) {
    jsonResponse(res,409,{error:'extension runtime is active in multiple Breeze sessions'},origin); return;
  }
  if (!picked.context) {
    jsonResponse(res,503,{error:'extension runtime is not registered yet'},origin); return;
  }
  if (picked.context.private) {
    jsonResponse(res,403,{error:'extensions are unavailable in Private Browsing'},origin); return;
  }
  const fn = methodHandler(method);
  if (!fn) { jsonResponse(res,501,{error:'compatibility method is not implemented by this Breeze build'},origin); return; }

  const params = body?.params && typeof body.params === 'object' ? clone(body.params) : {};
  try {
    const result = await fn({
      localId:entry.localId,
      runtimeId:picked.context.runtimeId,
      workspaceId:picked.context.workspaceId,
      sealed:!!picked.context.sealed,
      ses:picked.context.ses,
      origin
    }, params);
    jsonResponse(res,200,{result:result === undefined ? null : result},origin);
  } catch (err) {
    const status = Number(err?.status || 500);
    jsonResponse(res,status >= 400 && status < 600 ? status : 500,{error:String(err?.message || err || 'compatibility call failed')},origin);
  }
}

async function ensureServer(){
  if (server && endpoint) return endpoint;
  if (startPromise) return startPromise;
  startPromise = new Promise((resolve,reject)=>{
    const srv = http.createServer((req,res)=>{
      const task=req.url==='/events'&&req.method==='POST'?handleEvents(req,res):handleRpc(req,res);
      task.catch(()=>{try{jsonResponse(res,500,{error:'bridge failure'});}catch{}});
    });
    srv.on('error',reject);
    srv.listen(0,'127.0.0.1',()=>{
      server = srv;
      const address = srv.address();
      endpoint = `http://127.0.0.1:${address.port}/rpc`;
      resolve(endpoint);
    });
  }).finally(()=>{ startPromise = null; });
  return startPromise;
}

function backupPaths(localId, workerRel){
  const base = path.join(originalsDir,safeLocalId(localId));
  const worker = safeRelativeFile(base,workerRel,'backup worker').full;
  return { base, manifest:path.join(base,'manifest.json'), worker };
}
function ensurePristineBackups(localId, managedDir, _manifest, workerRel){
  const backups = backupPaths(localId,workerRel);
  fs.mkdirSync(backups.base,{recursive:true});
  const managedManifest = path.join(managedDir,'manifest.json');
  const managedWorker = safeRelativeFile(managedDir,workerRel,'background worker').full;
  if (!fs.existsSync(backups.manifest)) {
    const currentWorker = fs.readFileSync(managedWorker,'utf8');
    if (currentWorker.includes('BREEZE_EXTENSION_COMPAT_')) throw new Error('managed worker is patched but pristine backup is missing');
    fs.copyFileSync(managedManifest,backups.manifest);
  }
  if (!fs.existsSync(backups.worker)) {
    const currentWorker = fs.readFileSync(managedWorker,'utf8');
    if (currentWorker.includes('BREEZE_EXTENSION_COMPAT_')) throw new Error('managed worker is patched but pristine backup is missing');
    mkdirFor(backups.worker);
    fs.copyFileSync(managedWorker,backups.worker);
  }
  return backups;
}

function earlyIdentitySource(){
  return [
    EARLY_IDENTITY_MARKER,
    ';(()=>{try{',
    "  const id=globalThis.chrome&&chrome.runtime&&chrome.runtime.id||'';if(!id)return;",
    "  const redirect=(suffix='')=>'https://'+id+'.chromiumapp.org/'+String(suffix||'').replace(/^\\/+/, '');",
    "  const ensure=(root)=>{if(!root)return null;let target=null;try{target=root.identity;}catch{}if(!target){try{root.identity={};target=root.identity;}catch{}}if(!target){try{Object.defineProperty(root,'identity',{value:{},writable:true,configurable:true,enumerable:true});target=root.identity;}catch{}}return target||null;};",
    "  const install=(root)=>{const target=ensure(root);if(!target)return;try{if(typeof target.getRedirectURL!=='function')target.getRedirectURL=redirect;}catch{}if(typeof target.getRedirectURL!=='function'){try{Object.defineProperty(target,'getRedirectURL',{value:redirect,writable:true,configurable:true,enumerable:true});}catch{}}};",
    '  install(globalThis.chrome);',
    '  install(globalThis.browser);',
    '}catch{}})();',
    ''
  ].join('\n');
}
function patchEarlyIdentityModules(managedDir, manifest, workerRel){
  if(!moduleBackground(manifest)||!manifestPermissions(manifest).has('identity'))return [];
  const patched=[];
  const stack=[managedDir];
  const workerFull=safeRelativeFile(managedDir,workerRel,'background worker').full;
  while(stack.length){
    const dir=stack.pop();
    for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
      const full=path.join(dir,ent.name);
      if(ent.isDirectory()){stack.push(full);continue;}
      if(!ent.isFile()||full===workerFull||!/[.](?:m?js)$/i.test(ent.name))continue;
      let source='';
      try{
        const st=fs.statSync(full);
        if(st.size>32*1024*1024)continue;
        source=fs.readFileSync(full,'utf8');
      }catch{continue;}
      if(!source.includes('getRedirectURL')||source.includes(EARLY_IDENTITY_MARKER))continue;
      fs.writeFileSync(full,earlyIdentitySource()+source,'utf8');
      patched.push(path.relative(managedDir,full).replace(/\\/g,'/'));
    }
  }
  return patched;
}

function bootstrapSource(endpointUrl, token, allowed){
  const methods=[...allowed];
  const lines = [
    PATCH_MARKER,
    ';(()=>{',
    "  'use strict';",
    `  const endpoint=${JSON.stringify(endpointUrl)};`,
    "  const eventEndpoint=endpoint.replace(/\\/rpc$/,'/events');",
    `  const token=${JSON.stringify(token)};`,
    `  const allowed=new Set(${JSON.stringify(methods)});`,
    "  const invoke=async(method,params={})=>{",
    "    if(!allowed.has(method))throw new Error('Breeze compatibility method is not allowed: '+method);",
    "    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+token},body:JSON.stringify({method,params,runtimeId:chrome.runtime&&chrome.runtime.id||''})});",
    "    const payload=await response.json().catch(()=>({error:'invalid Breeze compatibility response'}));",
    "    if(!response.ok)throw new Error(payload&&payload.error||('Breeze compatibility '+response.status));",
    '    return payload.result;',
    '  };',
    "  const callback=(promise,cb)=>{if(typeof cb==='function'){promise.then(v=>cb(v)).catch(()=>cb(undefined));}return promise;};",
    "  const registry=globalThis.__breezeExtensionEventRegistry instanceof Map?globalThis.__breezeExtensionEventRegistry:new Map();",
    "  globalThis.__breezeExtensionEventRegistry=registry;",
    "  const event=(name)=>{const key=String(name||'');const existing=registry.get(key);if(existing?.api)return existing.api;const listeners=new Set();const api={addListener(fn){if(typeof fn==='function')listeners.add(fn);},removeListener(fn){listeners.delete(fn);},hasListener(fn){return listeners.has(fn);},hasListeners(){return listeners.size>0;}};registry.set(key,{api,listeners});return api;};",
    "  const trackedWindows=new Set();const removedWindows=new Set();let eventPoll=null;",
    "  const dispatchEvent=(name,...args)=>{const key=String(name||'');if(key==='windows.onRemoved'&&args[0]!=null){const id=Number(args[0]);if(removedWindows.has(id))return;removedWindows.add(id);if(removedWindows.size>64)removedWindows.delete(removedWindows.values().next().value);trackedWindows.delete(id);}const entry=registry.get(key);if(!entry)return;for(const fn of [...entry.listeners]){try{fn(...args);}catch(err){queueMicrotask(()=>{throw err;});}}};",
    "  globalThis.__breezeDispatchExtensionEvent=dispatchEvent;",
    "  const assign=(target,name,value)=>{if(!target)return false;try{target[name]=value;if(target[name]===value)return true;}catch{}try{Object.defineProperty(target,name,{value,writable:true,configurable:true,enumerable:true});return target[name]===value;}catch{return false;}};",
    "  const pollWindowEvents=()=>{if(eventPoll||!trackedWindows.size)return;eventPoll=fetch(eventEndpoint,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+token},body:JSON.stringify({runtimeId:chrome.runtime&&chrome.runtime.id||''})}).then(async response=>{const payload=await response.json().catch(()=>({events:[]}));if(!response.ok)throw new Error(payload&&payload.error||('Breeze event bridge '+response.status));for(const row of Array.isArray(payload.events)?payload.events:[]){dispatchEvent(row&&row.name,...(Array.isArray(row&&row.args)?row.args:[]));}}).catch(()=>{trackedWindows.clear();}).finally(()=>{eventPoll=null;if(trackedWindows.size)pollWindowEvents();});};",
    "  const rememberWindow=(row)=>{const id=Number(row&&row.id);if(!Number.isInteger(id))return row;trackedWindows.add(id);pollWindowEvents();return row;};",
    "  const extUrl=(value)=>{if(typeof value!=='string')return value;const raw=value.trim();if(!raw)return raw;if(/^[a-z][a-z0-9+.-]*:/i.test(raw))return raw;return chrome.runtime.getURL(raw.replace(/^\\/+/,''));};",
    "  const extDetails=(details)=>{const out=details&&typeof details==='object'?{...details}:{};if(typeof out.url==='string')out.url=extUrl(out.url);else if(Array.isArray(out.url))out.url=out.url.map(extUrl);return out;};",
    '  try{',
    '    if(!chrome.tabs)chrome.tabs={};',
    "    if(!chrome.tabs.onRemoved)chrome.tabs.onRemoved=event('tabs.onRemoved');",
    "    if(!chrome.tabs.onUpdated)chrome.tabs.onUpdated=event('tabs.onUpdated');",
    "    if(!chrome.tabs.onActivated)chrome.tabs.onActivated=event('tabs.onActivated');",
    "    if(allowed.has('tabs.create'))chrome.tabs.create=(details,cb)=>callback(invoke('tabs.create',extDetails(details)),cb);",
    "    if(allowed.has('tabs.query'))chrome.tabs.query=(details,cb)=>{if(typeof details==='function'){cb=details;details={};}return callback(invoke('tabs.query',details&&typeof details==='object'?details:{}),cb);};",
    "    if(allowed.has('tabs.get'))chrome.tabs.get=(id,cb)=>callback(invoke('tabs.get',{tabId:id}),cb);",
    "    if(allowed.has('tabs.getCurrent'))chrome.tabs.getCurrent=(cb)=>callback(invoke('tabs.getCurrent',{}),cb);",
    "    if(allowed.has('tabs.update'))chrome.tabs.update=(id,details,cb)=>{if(id&&typeof id==='object'){cb=details;details=id;id=null;}return callback(invoke('tabs.update',{tabId:id,props:extDetails(details)}),cb);};",
    "    if(allowed.has('tabs.remove'))chrome.tabs.remove=(ids,cb)=>callback(invoke('tabs.remove',{tabIds:ids}),cb);",
    '    if(!chrome.windows)chrome.windows={};',
    "    const removedEvent=event('windows.onRemoved');assign(chrome.windows,'onRemoved',removedEvent);",
    "    if(!chrome.windows.onFocusChanged)chrome.windows.onFocusChanged=event('windows.onFocusChanged');",
    '    if(chrome.windows.WINDOW_ID_NONE==null)chrome.windows.WINDOW_ID_NONE=-1;',
    "    if(allowed.has('windows.create'))chrome.windows.create=(details,cb)=>callback(invoke('windows.create',extDetails(details)).then(rememberWindow),cb);",
    "    for(const name of ['getAll','getCurrent','getLastFocused']){const method='windows.'+name;if(allowed.has(method)&&typeof chrome.windows[name]!=='function')chrome.windows[name]=(details,cb)=>{if(typeof details==='function'){cb=details;details={};}return callback(invoke(method,details&&typeof details==='object'?details:{}),cb);};}",
    "    if(allowed.has('windows.update')&&typeof chrome.windows.update!=='function')chrome.windows.update=(id,details,cb)=>callback(invoke('windows.update',{id,...(details||{})}),cb);",
    "    if(allowed.has('windows.remove')&&typeof chrome.windows.remove!=='function')chrome.windows.remove=(id,cb)=>callback(invoke('windows.remove',{id}),cb);",
    "    if(allowed.has('cookies.get')||allowed.has('cookies.getAll')||allowed.has('cookies.set')||allowed.has('cookies.remove')){if(!chrome.cookies)chrome.cookies={};for(const name of ['get','getAll','set','remove']){const method='cookies.'+name;if(allowed.has(method)&&typeof chrome.cookies[name]!=='function')chrome.cookies[name]=(details,cb)=>callback(invoke(method,details&&typeof details==='object'?details:{}),cb);}}",
    "    if(allowed.has('notifications.create')||allowed.has('notifications.clear')){if(!chrome.notifications)chrome.notifications={};if(!chrome.notifications.onClicked)chrome.notifications.onClicked=event();if(allowed.has('notifications.create')&&typeof chrome.notifications.create!=='function')chrome.notifications.create=(id,options,cb)=>{if(id&&typeof id==='object'){cb=options;options=id;id='';}return callback(invoke('notifications.create',{id:id||'',options:options&&typeof options==='object'?options:{}}),cb);};if(allowed.has('notifications.clear')&&typeof chrome.notifications.clear!=='function')chrome.notifications.clear=(id,cb)=>callback(invoke('notifications.clear',{id}),cb);}",
    '    if(!chrome.commands)chrome.commands={};',
    "    if(typeof chrome.commands.getAll!=='function')chrome.commands.getAll=(cb)=>{const commands=chrome.runtime.getManifest().commands||{};const rows=Object.entries(commands).map(([name,v])=>({name,description:v&&v.description||'',shortcut:v&&v.suggested_key&&(v.suggested_key.default||v.suggested_key.windows||v.suggested_key.mac)||''}));if(typeof cb==='function')queueMicrotask(()=>cb(rows));return Promise.resolve(rows);};",
    "    if(allowed.has('identity.launchWebAuthFlow')){if(!chrome.identity)chrome.identity={};if(typeof chrome.identity.getRedirectURL!=='function')chrome.identity.getRedirectURL=(suffix='')=>'https://'+chrome.runtime.id+'.chromiumapp.org/'+String(suffix||'').replace(/^\\/+/, '');if(typeof chrome.identity.launchWebAuthFlow!=='function')chrome.identity.launchWebAuthFlow=(details,cb)=>callback(invoke('identity.launchWebAuthFlow',details&&typeof details==='object'?details:{}),cb);}",
    "    const browserApi=globalThis.browser;",
    "    if(browserApi&&browserApi.runtime&&browserApi.runtime.id){const mirror=(name,props)=>{try{const source=chrome[name];if(!source)return;if(!browserApi[name])browserApi[name]={};const target=browserApi[name];if(!target)return;for(const prop of props){if(source[prop]==null)continue;const value=source[prop];if(typeof value==='function'||target[prop]==null)assign(target,prop,value);}}catch{}};mirror('tabs',['create','query','get','getCurrent','update','remove','onRemoved','onUpdated','onActivated']);mirror('windows',['create','getAll','getCurrent','getLastFocused','update','remove','onRemoved','onFocusChanged','WINDOW_ID_NONE']);const browserWindows=browserApi.windows;const sharedRemoved=chrome.windows&&chrome.windows.onRemoved;if(browserWindows&&sharedRemoved)assign(browserWindows,'onRemoved',sharedRemoved);mirror('cookies',['get','getAll','set','remove']);mirror('notifications',['create','clear','onClicked']);mirror('commands',['getAll']);mirror('identity',['getRedirectURL','launchWebAuthFlow']);}",
    '  }catch{}',
    '})();',
    ''
  ];
  return lines.join('\n');
}

async function prepareManagedCopy(options={}){
  if (!rootDir) throw new Error('extension compatibility is not initialized');
  const localId = safeLocalId(options.localId);
  const managedDir = path.resolve(String(options.managedDir || ''));
  if (!isInside(rootDir,managedDir) || managedDir === rootDir) throw new Error('managed extension directory is outside Breeze extension storage');
  const existing = entriesByLocalId.get(localId);
  if (existing) return status(localId);

  const manifestFile = path.join(managedDir,'manifest.json');
  const currentManifest = readJson(manifestFile);
  const allowed = allowedMethodsForManifest(currentManifest);
  const workerRel = backgroundWorker(currentManifest);
  if (!workerRel || !allowed.size) return {prepared:false,reason:'no MV3 compatibility bridge required'};
  const worker = safeRelativeFile(managedDir,workerRel,'background worker');
  if (!fs.statSync(worker.full).isFile()) throw new Error('background worker is not a file');
  if (fs.statSync(worker.full).size > 32 * 1024 * 1024) throw new Error('background worker is too large to patch safely');

  const bridgeEndpoint = await ensureServer();
  const backups = ensurePristineBackups(localId,managedDir,currentManifest,workerRel);
  const pristineManifest = readJson(backups.manifest);
  const pristineWorker = fs.readFileSync(backups.worker,'utf8');
  const permissionManifest = clone(pristineManifest);
  const hp = Array.isArray(permissionManifest.host_permissions) ? permissionManifest.host_permissions.slice() : [];
  if (!hp.includes(LOOPBACK_PERMISSION)) hp.push(LOOPBACK_PERMISSION);
  permissionManifest.host_permissions = hp;

  // Module service workers evaluate their static dependency graph before the
  // service-worker file's body. Patch only managed module files that actually
  // reference getRedirectURL so identity exists before those imports evaluate.
  // This is what current Phantom requires; the user's original extension files
  // remain untouched and the patch is idempotent on persisted managed copies.
  const earlyIdentityModules=patchEarlyIdentityModules(managedDir,pristineManifest,workerRel);

  const token = crypto.randomBytes(32).toString('hex');
  writeJson(manifestFile,permissionManifest);
  fs.writeFileSync(worker.full,bootstrapSource(bridgeEndpoint,token,allowed) + pristineWorker,'utf8');
  const entry = { localId, managedDir, workerRel, token, allowed, earlyIdentityModules, runtimes:new Map() };
  entriesByLocalId.set(localId,entry);
  entriesByToken.set(token,entry);
  return status(localId);
}

function registerRuntime(localId, runtimeId, context={}){
  const id = safeLocalId(localId);
  const entry = entriesByLocalId.get(id);
  if (!entry) return {registered:false,reason:'extension compatibility is not prepared'};
  if (context.private) return {registered:false,reason:'extensions are unavailable in Private Browsing'};
  const rid = String(runtimeId || '').trim();
  if (!/^[a-p]{32}$/i.test(rid)) return {registered:false,reason:'invalid extension runtime id'};
  const workspaceId = String(context.workspaceId || 'default').replace(/[^a-z0-9_-]/gi,'-').slice(0,80) || 'default';
  const storage = String(context.ses?.storagePath || 'memory').replace(/\\/g,'/');
  const key = workspaceId + ':' + crypto.createHash('sha256').update(storage).digest('hex').slice(0,16);
  closeRuntimeEvents(entry.runtimes.get(key));
  entry.runtimes.set(key,{runtimeId:rid,workspaceId,sealed:!!context.sealed,private:false,ses:context.ses||null,events:[],eventWaiters:new Set()});
  return {registered:true,runtimeId:rid,workspaceId};
}
function emitEvent(localId,runtimeId,ses,name,args=[]){
  const entry=entriesByLocalId.get(String(localId||''));
  if(!entry)return 0;
  const rid=String(runtimeId||'');
  const event={name:String(name||''),args:Array.isArray(args)?clone(args):[]};
  let delivered=0;
  for(const context of entry.runtimes.values()){
    if(context.runtimeId!==rid||(ses&&context.ses!==ses))continue;
    if(!(context.eventWaiters instanceof Set))context.eventWaiters=new Set();
    const waiter=context.eventWaiters.values().next().value;
    if(waiter)waiter.finish([event]);
    else{
      if(!Array.isArray(context.events))context.events=[];
      context.events.push(event);
      if(context.events.length>32)context.events.splice(0,context.events.length-32);
    }
    delivered++;
  }
  return delivered;
}
function unregisterRuntime(localId, context={}){
  const entry = entriesByLocalId.get(String(localId||''));
  if (!entry) return false;
  const workspaceId = String(context.workspaceId || 'default').replace(/[^a-z0-9_-]/gi,'-').slice(0,80) || 'default';
  const storage = String(context.ses?.storagePath || 'memory').replace(/\\/g,'/');
  const key = workspaceId + ':' + crypto.createHash('sha256').update(storage).digest('hex').slice(0,16);
  closeRuntimeEvents(entry.runtimes.get(key));
  return entry.runtimes.delete(key);
}
function status(localId){
  const entry = entriesByLocalId.get(String(localId||''));
  if (!entry) return {prepared:false};
  return {
    prepared:true,
    localId:entry.localId,
    methods:[...entry.allowed].sort(),
    earlyIdentityModules:Array.isArray(entry.earlyIdentityModules)?entry.earlyIdentityModules.length:0,
    runtimeCount:entry.runtimes.size,
    bridge:'loopback-v2'
  };
}
function remove(localId){
  const id = String(localId||'');
  const entry = entriesByLocalId.get(id);
  if (entry) {
    for(const context of entry.runtimes.values())closeRuntimeEvents(context);
    entriesByToken.delete(entry.token); entriesByLocalId.delete(id);
  }
  if (originalsDir) {
    try { fs.rmSync(path.join(originalsDir,safeLocalId(id)),{recursive:true,force:true}); } catch {}
  }
}
async function close(){
  const srv = server;
  server = null; endpoint = '';
  for(const entry of entriesByLocalId.values())for(const context of entry.runtimes.values())closeRuntimeEvents(context);
  entriesByToken.clear(); entriesByLocalId.clear();
  if (!srv) return;
  await new Promise(resolve=>srv.close(()=>resolve()));
}

module.exports = {
  init,setHandlers,prepareManagedCopy,registerRuntime,unregisterRuntime,emitEvent,status,remove,close,
  allowedMethodsForManifest,
  LOOPBACK_PERMISSION,PATCH_MARKER,EARLY_IDENTITY_MARKER
};
