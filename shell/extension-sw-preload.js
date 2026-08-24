/* Breeze MV3 service-worker compatibility preload.
   Runs in Electron's isolated service-worker preload realm before an extension
   worker's module graph is evaluated. The bridge is deliberately narrow:
   extension code never receives ipcRenderer or arbitrary host IPC access. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const { setTimeout } = require('node:timers');

try { ipcRenderer.send('breeze:preload-loaded', { type:process.type, isolated:!!process.contextIsolated }); } catch {}

const ALLOWED = new Set([
  'tabs.create','tabs.query','tabs.get','tabs.getCurrent','tabs.update','tabs.remove',
  'windows.create','windows.getAll','windows.getCurrent','windows.getLastFocused',
  'windows.update','windows.remove',
  'cookies.get','cookies.getAll','cookies.set','cookies.remove',
  'notifications.create','notifications.clear',
  'identity.launchWebAuthFlow'
]);

function compatInvoke(method, params){
  const name = String(method || '');
  if (!ALLOWED.has(name)) return Promise.reject(new Error('Breeze compatibility method is not allowed'));
  const clean = params && typeof params === 'object' ? params : {};
  return ipcRenderer.invoke('breeze:extension-compat', name, clean);
}

let bridgeExposed = false;
try {
  contextBridge.exposeInMainWorld('__breezeExtensionCompat', Object.freeze({
    invoke: (method, params) => compatInvoke(method, params)
  }));
  bridgeExposed = true;
} catch (err) {
  try { ipcRenderer.send('breeze:preload-error', 'expose: '+String(err&&err.message||err)); } catch {}
}

// ServiceWorkerMain.send() lands here. Keep host event delivery one-way and
// narrowly named; extension code never receives an IPC object or arbitrary
// host channel. This is required for Chrome lifecycle events such as
// windows.onRemoved, which wallet background workers use to release a closed
// approval popup before opening the next request.
ipcRenderer.on('breeze:extension-event', (_event, name, args) => {
  try {
    contextBridge.executeInMainWorld({
      func: (eventName, eventArgs) => {
        const dispatch = globalThis.__breezeDispatchExtensionEvent;
        if (typeof dispatch === 'function') dispatch(String(eventName||''), ...(Array.isArray(eventArgs)?eventArgs:[]));
      },
      args: [String(name||''), Array.isArray(args)?args:[]]
    });
  } catch {}
});

function patchMainWorld(){
  try {
    const result=contextBridge.executeInMainWorld({
      func: (preloadBridgeExposed) => {
        globalThis.__breezePreloadMarker = 'loaded';
        globalThis.__breezePreloadBridgeExposed = !!preloadBridgeExposed;
        const bridge = globalThis.__breezeExtensionCompat;
        globalThis.__breezePreloadBridgeVisible = !!bridge && typeof bridge.invoke === 'function';
        globalThis.__breezePreloadSawChrome = !!globalThis.chrome;
        if (!globalThis.chrome || !chrome.runtime || !chrome.runtime.id) return false;

        const manifest = (()=>{ try { return chrome.runtime.getManifest?.() || {}; } catch { return {}; } })();
        const permissions = new Set(Array.isArray(manifest.permissions) ? manifest.permissions : []);
        const bridgeReady = !!bridge && typeof bridge.invoke === 'function';
        const registry = globalThis.__breezeExtensionEventRegistry instanceof Map
          ? globalThis.__breezeExtensionEventRegistry
          : new Map();
        const extensionWindowTypes = globalThis.__breezeExtensionWindowTypes instanceof Map
          ? globalThis.__breezeExtensionWindowTypes
          : new Map();
        globalThis.__breezeExtensionEventRegistry = registry;
        globalThis.__breezeExtensionWindowTypes = extensionWindowTypes;
        globalThis.__breezeDispatchExtensionEvent = (name,...args) => {
          const key=String(name||'');
          if(key==='windows.onRemoved'&&args[0]!=null) extensionWindowTypes.delete(Number(args[0]));
          const entry=registry.get(key);
          if(!entry)return;
          for(const fn of [...entry.listeners]){
            try{fn(...args);}catch(err){queueMicrotask(()=>{throw err;});}
          }
        };
        const event = name => {
          const key=String(name||'');
          const existing=registry.get(key);
          if(existing?.api)return existing.api;
          const listeners=new Set();
          const api={
            addListener(fn){if(typeof fn==='function')listeners.add(fn);},
            removeListener(fn){listeners.delete(fn);},
            hasListener(fn){return listeners.has(fn);},
            hasListeners(){return listeners.size>0;}
          };
          registry.set(key,{api,listeners});
          return api;
        };
        const ensureOn = (root,name) => {
          if(!root)return null;
          try{
            if(!root[name]){
              try{root[name]={};}catch{}
              if(!root[name]){
                try{Object.defineProperty(root,name,{value:{},writable:true,configurable:true,enumerable:true});}catch{}
              }
            }
            return root[name] || null;
          }catch{return null;}
        };
        const assign = (target,name,value) => {
          if(!target)return false;
          try{target[name]=value;if(target[name]===value)return true;}catch{}
          try{Object.defineProperty(target,name,{value,writable:true,configurable:true,enumerable:true});return target[name]===value;}catch{return false;}
        };
        const wrap = method => function(details, callback){
          let params = details;
          let cb = callback;
          if (typeof details === 'function') { cb = details; params = {}; }
          const promise = bridgeReady
            ? bridge.invoke(method, params && typeof params === 'object' ? params : {})
            : Promise.reject(new Error('Breeze extension host is not ready'));
          if (typeof cb === 'function') promise.then(value => cb(value)).catch(() => cb(undefined));
          return promise;
        };
        const rememberWindowType = (row,fallback='normal') => {
          if(!row||!Number.isInteger(Number(row.id)))return row;
          const id=Number(row.id);
          const remembered=extensionWindowTypes.get(id);
          const type=remembered||String(row.type||fallback||'normal');
          if(type)extensionWindowTypes.set(id,type);
          return row.type===type?row:{...row,type};
        };

        const tabs = ensureOn(chrome,'tabs');
        if(tabs){
          if(!tabs.onRemoved)assign(tabs,'onRemoved',event('tabs.onRemoved'));
          if(!tabs.onUpdated)assign(tabs,'onUpdated',event('tabs.onUpdated'));
          if(!tabs.onActivated)assign(tabs,'onActivated',event('tabs.onActivated'));
          const tabMethods={
            create:wrap('tabs.create'),
            query:wrap('tabs.query'),
            get:(id,cb)=>{const p=bridgeReady?bridge.invoke('tabs.get',{tabId:id}):Promise.reject(new Error('Breeze extension host is not ready'));if(typeof cb==='function')p.then(v=>cb(v)).catch(()=>cb(undefined));return p;},
            getCurrent:(cb)=>{const p=bridgeReady?bridge.invoke('tabs.getCurrent',{}):Promise.reject(new Error('Breeze extension host is not ready'));if(typeof cb==='function')p.then(v=>cb(v)).catch(()=>cb(undefined));return p;},
            update:(id,details,cb)=>{if(id&&typeof id==='object'){cb=details;details=id;id=null;}const p=bridgeReady?bridge.invoke('tabs.update',{tabId:id,props:details&&typeof details==='object'?details:{}}):Promise.reject(new Error('Breeze extension host is not ready'));if(typeof cb==='function')p.then(v=>cb(v)).catch(()=>cb(undefined));return p;},
            remove:(ids,cb)=>{const p=bridgeReady?bridge.invoke('tabs.remove',{tabIds:ids}):Promise.reject(new Error('Breeze extension host is not ready'));if(typeof cb==='function')p.then(v=>cb(v)).catch(()=>cb(undefined));return p;}
          };
          for(const [name,fn] of Object.entries(tabMethods)) if(typeof tabs[name]!=='function')assign(tabs,name,fn);
        }

        const windows = ensureOn(chrome,'windows');
        if(windows){
          if(!windows.onRemoved)assign(windows,'onRemoved',event('windows.onRemoved'));
          if(!windows.onFocusChanged)assign(windows,'onFocusChanged',event('windows.onFocusChanged'));
          if(windows.WINDOW_ID_NONE==null)assign(windows,'WINDOW_ID_NONE',-1);
          if(typeof windows.create!=='function')assign(windows,'create',function(details,cb){
            const clean=details&&typeof details==='object'?details:{};
            const requestedType=clean.type==='popup'?'popup':'normal';
            const p=bridgeReady?bridge.invoke('windows.create',clean).then(row=>{
              if(row&&Number.isInteger(Number(row.id)))extensionWindowTypes.set(Number(row.id),requestedType);
              return rememberWindowType(row,requestedType);
            }):Promise.reject(new Error('Breeze extension host is not ready'));
            if(typeof cb==='function')p.then(v=>cb(v)).catch(()=>cb(undefined));return p;
          });
          if(typeof windows.getAll!=='function')assign(windows,'getAll',function(details,cb){
            if(typeof details==='function'){cb=details;details={};}
            const p=bridgeReady?bridge.invoke('windows.getAll',details&&typeof details==='object'?details:{}).then(rows=>Array.isArray(rows)?rows.map(row=>rememberWindowType(row)):[]):Promise.reject(new Error('Breeze extension host is not ready'));
            if(typeof cb==='function')p.then(v=>cb(v)).catch(()=>cb(undefined));return p;
          });
          for(const name of ['getCurrent','getLastFocused']) if(typeof windows[name]!=='function')assign(windows,name,function(details,cb){
            if(typeof details==='function'){cb=details;details={};}
            const p=bridgeReady?bridge.invoke('windows.'+name,details&&typeof details==='object'?details:{}).then(row=>rememberWindowType(row)):Promise.reject(new Error('Breeze extension host is not ready'));
            if(typeof cb==='function')p.then(v=>cb(v)).catch(()=>cb(undefined));return p;
          });
          if(typeof windows.update!=='function')assign(windows,'update',function(id, details, cb){
            const p=bridgeReady?bridge.invoke('windows.update',{id,...(details||{})}).then(row=>rememberWindowType(row)):Promise.reject(new Error('Breeze extension host is not ready'));
            if(typeof cb==='function')p.then(v=>cb(v)).catch(()=>cb(undefined));return p;
          });
          if(typeof windows.remove!=='function')assign(windows,'remove',function(id, cb){
            const numeric=Number(id);
            const p=bridgeReady?bridge.invoke('windows.remove',{id}).then(value=>{extensionWindowTypes.delete(numeric);return value;}):Promise.reject(new Error('Breeze extension host is not ready'));
            if(typeof cb==='function')p.then(v=>cb(v)).catch(()=>cb(undefined));return p;
          });
        }

        const cookies = permissions.has('cookies') ? ensureOn(chrome,'cookies') : null;
        if(cookies) for(const name of ['get','getAll','set','remove']) if(typeof cookies[name]!=='function')assign(cookies,name,wrap('cookies.'+name));

        const notifications = permissions.has('notifications') ? ensureOn(chrome,'notifications') : null;
        if(notifications){
          if(!notifications.onClicked)assign(notifications,'onClicked',event('notifications.onClicked'));
          if(typeof notifications.create!=='function')assign(notifications,'create',function(id,options,cb){
            if(id&&typeof id==='object'){cb=options;options=id;id='';}
            const p=bridgeReady?bridge.invoke('notifications.create',{id:id||'',options:options&&typeof options==='object'?options:{}}):Promise.reject(new Error('Breeze extension host is not ready'));
            if(typeof cb==='function')p.then(v=>cb(v)).catch(()=>cb(undefined));return p;
          });
          if(typeof notifications.clear!=='function')assign(notifications,'clear',function(id,cb){
            const p=bridgeReady?bridge.invoke('notifications.clear',{id}):Promise.reject(new Error('Breeze extension host is not ready'));
            if(typeof cb==='function')p.then(v=>cb(v)).catch(()=>cb(undefined));return p;
          });
        }

        // Chrome's identity.getRedirectURL is synchronous and deterministic.
        // Patch it before MV3 module imports run; Phantom currently reads it
        // during imported-module evaluation, before its worker body executes.
        const identity = permissions.has('identity') ? ensureOn(chrome,'identity') : null;
        if(identity){
          if(typeof identity.getRedirectURL!=='function')assign(identity,'getRedirectURL',(suffix='')=>'https://'+chrome.runtime.id+'.chromiumapp.org/'+String(suffix||'').replace(/^\/+/,''));
          if(typeof identity.launchWebAuthFlow!=='function')assign(identity,'launchWebAuthFlow',wrap('identity.launchWebAuthFlow'));
        }

        const commands = ensureOn(chrome,'commands');
        if(commands&&typeof commands.getAll!=='function')assign(commands,'getAll',(cb)=>{
          const declared=manifest.commands||{};
          const rows=Object.entries(declared).map(([name,v])=>({name,description:v&&v.description||'',shortcut:v&&v.suggested_key&&(v.suggested_key.default||v.suggested_key.windows||v.suggested_key.mac)||''}));
          if(typeof cb==='function')queueMicrotask(()=>cb(rows));
          return Promise.resolve(rows);
        });

        // Electron can expose a partial `browser` namespace. If it exists,
        // make the same certified APIs visible there before webextension
        // polyfills or imported wallet modules inspect it.
        const browserApi = globalThis.browser;
        const mirror = (name,props) => {
          if(!browserApi)return;
          const source=chrome[name]; if(!source)return;
          const target=ensureOn(browserApi,name); if(!target)return;
          for(const prop of props) if(source[prop]!==undefined&&target[prop]===undefined)assign(target,prop,source[prop]);
        };
        mirror('tabs',['create','query','get','getCurrent','update','remove','onRemoved','onUpdated','onActivated']);
        mirror('windows',['create','getAll','getCurrent','getLastFocused','update','remove','onRemoved','onFocusChanged','WINDOW_ID_NONE']);
        if(permissions.has('cookies'))mirror('cookies',['get','getAll','set','remove']);
        if(permissions.has('notifications'))mirror('notifications',['create','clear','onClicked']);
        if(permissions.has('identity'))mirror('identity',['getRedirectURL','launchWebAuthFlow']);
        mirror('commands',['getAll']);

        globalThis.__breezePreloadIdentity = {
          chrome:typeof chrome.identity?.getRedirectURL,
          browser:globalThis.browser ? typeof globalThis.browser.identity?.getRedirectURL : 'absent'
        };
        globalThis.__breezePreloadPatched = typeof chrome.tabs?.create === 'function' && typeof chrome.windows?.create === 'function' && (!permissions.has('identity') || typeof chrome.identity?.getRedirectURL === 'function');
        return globalThis.__breezePreloadPatched;
      },
      args: [bridgeExposed]
    });
    try { ipcRenderer.send('breeze:preload-patch', { result:!!result, bridgeExposed }); } catch {}
    return result;
  } catch (err) {
    try { ipcRenderer.send('breeze:preload-error', 'patch: '+String(err&&err.message||err)); } catch {}
    return false;
  }
}

// The first call is the important one: it runs before the worker module graph.
// Retries cover Electron builds where extension namespaces finish initializing
// a tick later without widening the exposed bridge.
patchMainWorld();
setTimeout(patchMainWorld, 0);
setTimeout(patchMainWorld, 25);
setTimeout(patchMainWorld, 100);
