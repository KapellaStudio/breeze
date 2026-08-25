/* Breeze MV3 identity bootstrap.
   Electron can expose a partial native WebExtension `browser` namespace before
   an extension worker starts. Some extensions choose that namespace instead of
   `chrome` and expect browser.identity.getRedirectURL synchronously during
   startup. This preload only fills that local deterministic identity surface;
   privileged OAuth still routes through Breeze's managed compatibility layer. */
'use strict';
const { contextBridge } = require('electron');

function patchMainWorld(){
  try {
    return contextBridge.executeInMainWorld({
      func: () => {
        const chromeApi = globalThis.chrome;
        const runtimeId = String(chromeApi?.runtime?.id || '');
        if (!chromeApi || !runtimeId) return false;

        let identity = null;
        try {
          if (!chromeApi.identity) chromeApi.identity = {};
          identity = chromeApi.identity || null;
          if (identity && typeof identity.getRedirectURL !== 'function') {
            identity.getRedirectURL = (suffix='') =>
              'https://' + runtimeId + '.chromiumapp.org/' + String(suffix || '').replace(/^\/+/, '');
          }
        } catch {}

        // Electron 43 may provide `browser` as a real but incomplete object.
        // webextension-polyfill then uses it as-is, so mirror the deterministic
        // identity helper without waiting for browser.runtime.id to appear.
        const browserApi = globalThis.browser;
        if (browserApi && identity) {
          try {
            if (!browserApi.identity) browserApi.identity = {};
            if (browserApi.identity && typeof browserApi.identity.getRedirectURL !== 'function') {
              browserApi.identity.getRedirectURL = identity.getRedirectURL;
            }
            // The managed worker bootstrap may have installed launchWebAuthFlow
            // after this preload ran. Mirror it on retry without implementing a
            // second privileged bridge here.
            if (typeof identity.launchWebAuthFlow === 'function' &&
                typeof browserApi.identity?.launchWebAuthFlow !== 'function') {
              browserApi.identity.launchWebAuthFlow = identity.launchWebAuthFlow;
            }
          } catch {}
        }
        return typeof identity?.getRedirectURL === 'function';
      }
    });
  } catch {
    return false;
  }
}

patchMainWorld();
setTimeout(patchMainWorld, 0);
setTimeout(patchMainWorld, 25);
setTimeout(patchMainWorld, 100);
setTimeout(patchMainWorld, 250);
