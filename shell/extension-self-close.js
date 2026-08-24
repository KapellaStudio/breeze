/* Secure self-close bridge for Breeze-owned extension pages.
   Chrome extension notification windows may call window.close() even though
   their top-level window was created by the browser host. Chromium grants
   extension pages that privilege; Electron's normal renderer window.close()
   rules do not. This bridge restores only that narrow behavior. */
'use strict';

let installed=false;

function install(ipcMain,BrowserWindow){
  if(installed||!ipcMain||!BrowserWindow||typeof ipcMain.handle!=='function')return;
  installed=true;
  try{ipcMain.removeHandler('extension:closeSelf');}catch{}
  ipcMain.handle('extension:closeSelf',(event)=>{
    try{
      const sender=event?.sender;
      if(!sender) return {error:'missing extension sender'};
      const url=new URL(String(sender.getURL?.()||''));
      if(url.protocol!=='chrome-extension:') return {error:'untrusted extension close caller'};
      const ext=sender.session?.extensions?.getExtension?.(url.hostname);
      if(!ext) return {error:'extension is not registered in this session'};
      const owner=BrowserWindow.fromWebContents(sender);
      if(!owner||owner.isDestroyed()) return {error:'extension window is unavailable'};
      owner.close();
      return {ok:true,windowId:owner.id};
    }catch(err){
      return {error:String(err?.message||err)};
    }
  });
}

module.exports={install};
