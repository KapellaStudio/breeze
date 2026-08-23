/* Breeze PDF renderer preload — intentionally tiny. No generic invoke and no
   filesystem path access. The renderer may operate only on its own token. */
'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const call=(ch,...args)=>ipcRenderer.invoke(ch,...args);
contextBridge.exposeInMainWorld('__BREEZE_PDF__',{
  load: token=>call('pdf:load',String(token||'')),
  info: token=>call('pdf:info',String(token||'')),
  extract:(token,pages)=>call('pdf:extract',String(token||''),String(pages||'')),
  rotate:(token,pages,angle)=>call('pdf:rotate',String(token||''),String(pages||''),Number(angle)),
  split:(token,ranges)=>call('pdf:split',String(token||''),String(ranges||'')),
  merge: token=>call('pdf:merge',String(token||''))
});
