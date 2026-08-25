/* Secure self-window bridge for Breeze-owned extension pages.
   Chrome extension notification windows may inspect and close their own
   browser-created top-level window. Chromium grants extension pages that
   privilege; Electron's generic web-window rules do not. This bridge restores
   only those narrow, origin-checked semantics. */
'use strict';

let installed=false;

function trustedOwner(event,BrowserWindow){
  const sender=event?.sender;
  if(!sender) return {error:'missing extension sender'};
  let url;
  try{url=new URL(String(sender.getURL?.()||''));}
  catch{return {error:'invalid extension sender URL'};}
  if(url.protocol!=='chrome-extension:') return {error:'untrusted extension window caller'};
  const ext=sender.session?.extensions?.getExtension?.(url.hostname);
  if(!ext) return {error:'extension is not registered in this session'};
  const owner=BrowserWindow.fromWebContents(sender);
  if(!owner||owner.isDestroyed()) return {error:'extension window is unavailable'};
  return {sender,owner,url};
}

function windowRow(owner){
  const b=owner.getBounds();
  const parent=owner.getParentWindow?.()||null;
  return {
    id:owner.id,
    focused:owner.isFocused(),
    top:b.y,left:b.x,width:b.width,height:b.height,
    incognito:false,
    type:parent?'popup':'normal',
    state:owner.isMaximized()?'maximized':owner.isMinimized()?'minimized':owner.isFullScreen()?'fullscreen':'normal',
    alwaysOnTop:owner.isAlwaysOnTop()
  };
}

function install(ipcMain,BrowserWindow){
  if(installed||!ipcMain||!BrowserWindow||typeof ipcMain.handle!=='function')return;
  installed=true;

  try{ipcMain.removeHandler('extension:selfWindow');}catch{}
  ipcMain.handle('extension:selfWindow',(event)=>{
    try{
      const resolved=trustedOwner(event,BrowserWindow);
      if(resolved.error) return {error:resolved.error};
      return windowRow(resolved.owner);
    }catch(err){
      return {error:String(err?.message||err)};
    }
  });

  try{ipcMain.removeHandler('extension:closeSelf');}catch{}
  ipcMain.handle('extension:closeSelf',(event)=>{
    try{
      const resolved=trustedOwner(event,BrowserWindow);
      if(resolved.error) return {error:resolved.error};
      const id=resolved.owner.id;
      resolved.owner.close();
      return {ok:true,windowId:id};
    }catch(err){
      return {error:String(err?.message||err)};
    }
  });
}

module.exports={install};
