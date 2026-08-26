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
const { BrowserWindow } = require('electron');

const BLOCK_HOSTS = [
  'doubleclick.net','googletagmanager.com','google-analytics.com','googlesyndication.com',
  'facebook.net','connect.facebook.net','scorecardresearch.com','quantserve.com',
  'adservice.google.com','amazon-adsystem.com','criteo.com','taboola.com','outbrain.com',
  'hotjar.com','mixpanel.com','segment.io','branch.io','adnxs.com','pubmatic.com',
  'rubiconproject.com','casalemedia.com','bluekai.com','krxd.net','moatads.com'
];

function browserUserAgent(ua){
  return String(ua||'')
    .replace(/\s+Electron\/[\d.]+/gi,'')
    .replace(/\s+Breeze\/[\d.]+/gi,'')
    .replace(/\s{2,}/g,' ')
    .trim();
}

function hardenSession(ses, onBlocked, permissionBroker, permissionOptions){
  try{
    const clean=browserUserAgent(ses.getUserAgent());
    if(clean)ses.setUserAgent(clean);
  }catch{}

  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
    let host = '';
    try { host = new URL(details.url).hostname; } catch { return cb({}); }
    if (BLOCK_HOSTS.some(b => host === b || host.endsWith('.' + b))){
      if (onBlocked) onBlocked(details.webContentsId);
      return cb({ cancel: true });
    }
    cb({});
  });
  if (permissionBroker && typeof permissionBroker.attach === 'function') permissionBroker.attach(ses, permissionOptions || {});
  else {
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    if (typeof ses.setDevicePermissionHandler === 'function') ses.setDevicePermissionHandler(() => false);
  }
}

/* Applies to EVERY webContents, however it was created. Electron reports a
   WebContentsView page as type "window" too, so getType() is not a safe way
   to identify the privileged Breeze chrome. BrowserWindow.fromWebContents()
   is the ownership boundary we actually need: it resolves the BrowserWindow's
   own renderer, while ordinary page WebContentsViews remain page content. */
function installGuards(app, shell, uiDir){
  const chromePrefix = pathToFileURL(path.join(uiDir, path.sep)).toString();
  const isChromeRenderer = wc => {
    try{
      const owner=BrowserWindow.fromWebContents(wc);
      if(!owner || owner.isDestroyed()) return false;
      const current=wc.getURL();
      return !current || current==='about:blank' || current.startsWith(chromePrefix);
    }catch{return false;}
  };

  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-navigate', (ev, url) => {
      if (isChromeRenderer(wc)){
        if (!url.startsWith(chromePrefix)) ev.preventDefault();
        return;
      }
      let u; try { u = new URL(url); } catch { return ev.preventDefault(); }
      if (!['http:','https:'].includes(u.protocol)) ev.preventDefault();
    });

    wc.setWindowOpenHandler(({ url }) => {
      if (isChromeRenderer(wc) && /^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    wc.on('will-attach-webview', (ev, prefs) => {
      delete prefs.preload;
      prefs.nodeIntegration = false;
      prefs.contextIsolation = true;
    });

    wc.on('select-bluetooth-device', ev => ev.preventDefault());
  });
}

module.exports = { BLOCK_HOSTS, browserUserAgent, hardenSession, installGuards };