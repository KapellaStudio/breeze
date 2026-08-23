/* ═══════════════════════════════════════════════════════════════════════════
   BREEZE — SECURITY GUARDS
   Extracted so main.js and the breach suite install the SAME protections.
   A guard that lives inside createWindow() only protects windows created that
   way; the breach suite found exactly that hole. Enforcement belongs at the
   app level, applied to every webContents Electron ever creates.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const BLOCK_HOSTS = [
  'doubleclick.net','googletagmanager.com','google-analytics.com','googlesyndication.com',
  'facebook.net','connect.facebook.net','scorecardresearch.com','quantserve.com',
  'adservice.google.com','amazon-adsystem.com','criteo.com','taboola.com','outbrain.com',
  'hotjar.com','mixpanel.com','segment.io','branch.io','adnxs.com','pubmatic.com',
  'rubiconproject.com','casalemedia.com','bluekai.com','krxd.net','moatads.com'
];

function hardenSession(ses, onBlocked, permissionBroker, permissionOptions){
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
    let host = '';
    try { host = new URL(details.url).hostname; } catch { return cb({}); }
    if (BLOCK_HOSTS.some(b => host === b || host.endsWith('.' + b))){
      if (onBlocked) onBlocked(details.webContentsId);
      return cb({ cancel: true });
    }
    cb({});
  });
  // Default-deny remains the test/security fallback. The real browser passes a
  // permission broker that prompts the user and persists explicit per-origin
  // decisions; no site permission is silently granted.
  if (permissionBroker && typeof permissionBroker.attach === 'function') permissionBroker.attach(ses, permissionOptions || {});
  else {
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    if (typeof ses.setDevicePermissionHandler === 'function') ses.setDevicePermissionHandler(() => false);
  }
}

/* Applies to EVERY webContents, however it was created. The chrome may only
   ever sit on our own file; web content may only use http(s). */
function installGuards(app, shell, uiDir){
  const chromePrefix = pathToFileURL(path.join(uiDir, path.sep)).toString();

  app.on('web-contents-created', (_e, wc) => {
    const isChrome = wc.getType() === 'window';

    wc.on('will-navigate', (ev, url) => {
      if (isChrome){
        if (!url.startsWith(chromePrefix)) ev.preventDefault();   // chrome stays put
        return;
      }
      let u; try { u = new URL(url); } catch { return ev.preventDefault(); }
      if (!['http:','https:'].includes(u.protocol)) ev.preventDefault();
    });

    wc.setWindowOpenHandler(({ url }) => {
      if (isChrome && /^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };                                  // never an uncontrolled window
    });

    // Attaching a webview tag would bypass the guards above.
    wc.on('will-attach-webview', (ev, prefs) => {
      delete prefs.preload;
      prefs.nodeIntegration = false;
      prefs.contextIsolation = true;
    });

    wc.on('select-bluetooth-device', ev => ev.preventDefault());
  });
}

module.exports = { BLOCK_HOSTS, hardenSession, installGuards };
