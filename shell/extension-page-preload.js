/* Breeze extension-page compatibility preload.
   Runs only in Breeze-owned extension windows. It exposes a single frozen
   method bridge and fills browser-shaped APIs before extension page scripts run.
   No ipcRenderer object or arbitrary channel access crosses contextIsolation. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (method, params={}) => {
  const name=String(method||'');
  if(name==='__breezeCloseSelf') return ipcRenderer.invoke('extension:closeSelf');
  if(name==='__breezeGetSelfWindow') return ipcRenderer.invoke('extension:selfWindow');
  return ipcRenderer.invoke('extension:pageApi', name, params && typeof params==='object' ? params : {});
};
contextBridge.exposeInMainWorld('__breezeExtensionHost', Object.freeze({ call }));

if (typeof contextBridge.executeInMainWorld === 'function') {
  contextBridge.executeInMainWorld({
    func: () => {
      const host = globalThis.__breezeExtensionHost;
      if (!host || typeof host.call !== 'function' || !globalThis.chrome?.runtime?.id) return;
      const dual = (method, params, cb) => {
        const promise = host.call(method, params || {});
        if (typeof cb === 'function') promise.then(v => cb(v), () => cb(undefined));
        return promise;
      };
      const root = name => {
        try { if (!chrome[name]) chrome[name] = {}; return chrome[name]; }
        catch { return null; }
      };
      const normalizeUrl = value => {
        if (typeof value !== 'string') return value;
        const raw=value.trim();
        if (!raw) return raw;
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
        try { return chrome.runtime.getURL(raw.replace(/^\/+/,'')); } catch { return raw; }
      };
      const normalizeDetails = details => {
        const out=details&&typeof details==='object'?{...details}:{};
        if (typeof out.url === 'string') out.url=normalizeUrl(out.url);
        if (Array.isArray(out.url)) out.url=out.url.map(normalizeUrl);
        return out;
      };

      // Chrome extension notification/popup pages are allowed to close their
      // browser-created top-level window. Electron applies the normal web rule
      // that window.close() may fail for a window not opened by script. Route
      // only this self-close operation to the trusted Breeze main process so
      // wallet approval windows can complete their normal lifecycle.
      const nativeClose=typeof globalThis.close==='function'?globalThis.close.bind(globalThis):null;
      try {
        Object.defineProperty(globalThis,'close',{
          configurable:true,writable:true,
          value:()=>{
            const p=host.call('__breezeCloseSelf',{});
            if(p&&typeof p.catch==='function'&&nativeClose)p.catch(()=>{try{nativeClose();}catch{}});
          }
        });
      } catch {}

      const tabs = root('tabs');
      if (tabs) {
        tabs.create = (details,cb) => dual('tabs.create', normalizeDetails(details), cb);
        tabs.query = (details,cb) => { if(typeof details==='function'){cb=details;details={};} return dual('tabs.query', details||{}, cb); };
        tabs.get = (id,cb) => dual('tabs.get',{tabId:id},cb);
        tabs.getCurrent = cb => dual('tabs.getCurrent',{},cb);
        tabs.update = (id,details,cb) => { if(id&&typeof id==='object'){cb=details;details=id;id=null;} return dual('tabs.update',{tabId:id,props:normalizeDetails(details)},cb); };
        tabs.remove = (ids,cb) => dual('tabs.remove',{tabIds:ids},cb);
      }

      const windows = root('windows');
      if (windows) {
        windows.create = (details,cb) => dual('windows.create',normalizeDetails(details),cb);
        windows.getAll = (details,cb) => { if(typeof details==='function'){cb=details;details={};} return dual('windows.getAll',details||{},cb); };
        windows.getCurrent = (details,cb) => {
          if(typeof details==='function'){cb=details;details={};}
          const promise=host.call('__breezeGetSelfWindow',{}).then(row=>{
            if(row&&row.error) throw new Error(row.error);
            return row;
          });
          if(typeof cb==='function') promise.then(v=>cb(v),()=>cb(undefined));
          return promise;
        };
        windows.getLastFocused = (details,cb) => { if(typeof details==='function'){cb=details;details={};} return dual('windows.getLastFocused',details||{},cb); };
        windows.update = (id,details,cb) => dual('windows.update',{id,...(details||{})},cb);
        windows.remove = (id,cb) => dual('windows.remove',{id},cb);
        if (windows.WINDOW_ID_NONE == null) windows.WINDOW_ID_NONE = -1;
      }

      const cookies = root('cookies');
      if (cookies) for (const name of ['get','getAll','set','remove']) cookies[name] = (details,cb) => dual('cookies.'+name,details||{},cb);

      const notifications = root('notifications');
      if (notifications) {
        notifications.create = (id,options,cb) => { if(id&&typeof id==='object'){cb=options;options=id;id='';} return dual('notifications.create',{id:id||'',options:options||{}},cb); };
        notifications.clear = (id,cb) => dual('notifications.clear',{id},cb);
      }

      const identity = root('identity');
      if (identity) {
        if (typeof identity.getRedirectURL !== 'function') identity.getRedirectURL = (suffix='') => 'https://'+chrome.runtime.id+'.chromiumapp.org/'+String(suffix||'').replace(/^\/+/, '');
        identity.launchWebAuthFlow = (details,cb) => dual('identity.launchWebAuthFlow',details||{},cb);
      }

      const commands = root('commands');
      if (commands && typeof commands.getAll !== 'function') {
        commands.getAll = cb => {
          const declared=chrome.runtime.getManifest().commands||{};
          const rows=Object.entries(declared).map(([name,v])=>({name,description:v&&v.description||'',shortcut:v&&v.suggested_key&&(v.suggested_key.default||v.suggested_key.windows||v.suggested_key.mac)||''}));
          if(typeof cb==='function') queueMicrotask(()=>cb(rows));
          return Promise.resolve(rows);
        };
      }

      // Electron 43 can expose a native `browser` namespace that is only a
      // partial WebExtension surface. webextension-polyfill deliberately uses
      // that object as-is when browser.runtime.id exists, so extension UIs such
      // as MetaMask would otherwise bypass the Breeze host-backed methods above.
      // In Breeze-owned extension windows, make the supported browser methods
      // resolve through the same narrow page bridge as their chrome aliases.
      const browserApi = globalThis.browser;
      if (browserApi && browserApi.runtime && browserApi.runtime.id) {
        const sync = (name, props) => {
          try {
            const source = chrome[name];
            if (!source) return;
            if (!browserApi[name]) browserApi[name] = {};
            const target = browserApi[name];
            if (!target) return;
            for (const prop of props) {
              if (source[prop] === undefined) continue;
              try { target[prop] = source[prop]; } catch {}
            }
          } catch {}
        };
        sync('tabs',['create','query','get','getCurrent','update','remove','onRemoved','onUpdated','onActivated']);
        sync('windows',['create','getAll','getCurrent','getLastFocused','update','remove','onRemoved','onFocusChanged','WINDOW_ID_NONE']);
        sync('cookies',['get','getAll','set','remove']);
        sync('notifications',['create','clear','onClicked']);
        sync('identity',['getRedirectURL','launchWebAuthFlow']);
        sync('commands',['getAll']);
      }
    }
  });
}
