/* Breeze extension-page compatibility preload.
   Runs only in Breeze-owned extension windows. It exposes a single frozen
   method bridge and fills browser-shaped APIs before extension page scripts run.
   No ipcRenderer object or arbitrary channel access crosses contextIsolation. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (method, params={}) => ipcRenderer.invoke('extension:pageApi', String(method||''), params && typeof params==='object' ? params : {});
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

      const tabs = root('tabs');
      if (tabs) {
        tabs.create = (details,cb) => dual('tabs.create', details||{}, cb);
        tabs.query = (details,cb) => { if(typeof details==='function'){cb=details;details={};} return dual('tabs.query', details||{}, cb); };
        tabs.get = (id,cb) => dual('tabs.get',{tabId:id},cb);
        tabs.getCurrent = cb => dual('tabs.getCurrent',{},cb);
        tabs.update = (id,details,cb) => { if(id&&typeof id==='object'){cb=details;details=id;id=null;} return dual('tabs.update',{tabId:id,props:details||{}},cb); };
        tabs.remove = (ids,cb) => dual('tabs.remove',{tabIds:ids},cb);
      }

      const windows = root('windows');
      if (windows) {
        windows.create = (details,cb) => dual('windows.create',details||{},cb);
        for (const name of ['getAll','getCurrent','getLastFocused']) {
          windows[name] = (details,cb) => { if(typeof details==='function'){cb=details;details={};} return dual('windows.'+name,details||{},cb); };
        }
        windows.update = (id,details,cb) => dual('windows.update',{id,...(details||{})},cb);
        windows.remove = (id,cb) => dual('windows.remove',{id},cb);
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
    }
  });
}
