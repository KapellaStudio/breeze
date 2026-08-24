/* Breeze MV3 service-worker compatibility preload.
   Runs in Electron's isolated service-worker preload realm. The compatibility
   bridge is deliberately narrow: extension code never receives ipcRenderer. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED = new Set([
  'tabs.create','windows.create','windows.getAll','windows.getCurrent','windows.getLastFocused',
  'windows.update','windows.remove','cookies.get','cookies.getAll','cookies.set','cookies.remove'
]);

function compatInvoke(method, params){
  const name = String(method || '');
  if (!ALLOWED.has(name)) return Promise.reject(new Error('Breeze compatibility method is not allowed'));
  const clean = params && typeof params === 'object' ? params : {};
  return ipcRenderer.invoke('breeze:extension-compat', name, clean);
}

let bridgeExposed = false;
try {
  contextBridge.exposeInMainWorld('__breezeExtensionCompat', {
    invoke: (method, params) => compatInvoke(method, params)
  });
  bridgeExposed = true;
} catch (err) {
  console.error('BREEZE_SW_PRELOAD expose failed:', err && err.message || err);
}

function patchMainWorld(){
  try {
    return contextBridge.executeInMainWorld({
      func: (preloadBridgeExposed) => {
        globalThis.__breezePreloadMarker = 'loaded';
        globalThis.__breezePreloadBridgeExposed = !!preloadBridgeExposed;
        const bridge = globalThis.__breezeExtensionCompat;
        globalThis.__breezePreloadBridgeVisible = !!bridge && typeof bridge.invoke === 'function';
        globalThis.__breezePreloadSawChrome = !!globalThis.chrome;
        if (!bridge || typeof bridge.invoke !== 'function' || !globalThis.chrome) return false;
        const ensure = name => {
          try { if (!chrome[name]) chrome[name] = {}; return chrome[name]; } catch { return null; }
        };
        const wrap = method => function(details, callback){
          let params = details;
          let cb = callback;
          if (typeof details === 'function') { cb = details; params = {}; }
          const promise = bridge.invoke(method, params && typeof params === 'object' ? params : {});
          if (typeof cb === 'function') promise.then(value => cb(value)).catch(() => cb(undefined));
          return promise;
        };
        const tabs = ensure('tabs');
        const windows = ensure('windows');
        const cookies = ensure('cookies');
        if (tabs && typeof tabs.create !== 'function') tabs.create = wrap('tabs.create');
        if (windows) {
          if (typeof windows.create !== 'function') windows.create = wrap('windows.create');
          if (typeof windows.getAll !== 'function') windows.getAll = wrap('windows.getAll');
          if (typeof windows.getCurrent !== 'function') windows.getCurrent = wrap('windows.getCurrent');
          if (typeof windows.getLastFocused !== 'function') windows.getLastFocused = wrap('windows.getLastFocused');
          if (typeof windows.update !== 'function') windows.update = function(id, details, cb){
            const promise = bridge.invoke('windows.update', { id, ...(details || {}) });
            if (typeof cb === 'function') promise.then(v => cb(v)).catch(() => cb(undefined));
            return promise;
          };
          if (typeof windows.remove !== 'function') windows.remove = function(id, cb){
            const promise = bridge.invoke('windows.remove', { id });
            if (typeof cb === 'function') promise.then(v => cb(v)).catch(() => cb(undefined));
            return promise;
          };
        }
        if (cookies) {
          for (const name of ['get','getAll','set','remove']) {
            if (typeof cookies[name] !== 'function') cookies[name] = wrap('cookies.' + name);
          }
        }
        globalThis.__breezePreloadPatched = typeof chrome.tabs?.create === 'function' && typeof chrome.windows?.create === 'function';
        return globalThis.__breezePreloadPatched;
      },
      args: [bridgeExposed]
    });
  } catch (err) {
    console.error('BREEZE_SW_PRELOAD patch failed:', err && err.message || err);
    return false;
  }
}

patchMainWorld();
setTimeout(patchMainWorld, 0);
setTimeout(patchMainWorld, 25);
setTimeout(patchMainWorld, 100);
