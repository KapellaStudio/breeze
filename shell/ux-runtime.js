/* Browser-grade desktop interaction layer.
   Keeps expected browser behaviors available while focus is inside a real
   WebContentsView instead of the Breeze chrome renderer. */
'use strict';
const { app, BrowserWindow, Menu, clipboard } = require('electron');

let installed=false;
function chromeWindow(){
  return BrowserWindow.getAllWindows().find(w=>{
    try{
      if(!w||w.isDestroyed())return false;
      const u=w.webContents.getURL();
      return u.startsWith('file://') && /\/ui\/breeze-(desktop|mobile)\.html(?:$|[?#])/i.test(new URL(u).pathname.replace(/\\/g,'/'));
    }catch{return false;}
  })||null;
}
function pageLike(wc){
  try{return /^https?:/i.test(wc.getURL())||/^data:/i.test(wc.getURL());}catch{return false;}
}
function runChrome(js){
  const win=chromeWindow();if(!win)return Promise.resolve(null);
  try{return win.webContents.executeJavaScript(js,true).catch(()=>null);}catch{return Promise.resolve(null);}
}
function forwardToChrome(input){
  const win=chromeWindow();if(!win)return;
  const mods=[];
  if(input.control)mods.push('control');
  if(input.meta)mods.push('meta');
  if(input.shift)mods.push('shift');
  if(input.alt)mods.push('alt');
  try{win.webContents.focus();win.webContents.sendInputEvent({type:'keyDown',keyCode:input.key,modifiers:mods});win.webContents.sendInputEvent({type:'keyUp',keyCode:input.key,modifiers:mods});}catch{}
}
function newTab(privateMode=false){
  return runChrome(`(async()=>{const S=window.__BREEZE_SHELL__;if(!S)return;await ${privateMode?'S.newPrivateTab({})':'S.newTab({})'};try{if(typeof closeAll==='function')closeAll();if(typeof setView==='function')setView('home');document.documentElement.dataset.kind=${privateMode?"'private'":"'page'"};}catch{}await S.setInternalView(true);document.querySelector('.bigsearch input')?.focus();})()`);
}
function closeActiveTab(){
  return runChrome(`(async()=>{const S=window.__BREEZE_SHELL__;const tabs=await S.listTabs();const a=(tabs||[]).find(t=>t.active);if(a)await S.closeTab(a.id);})()`);
}
function reopenClosedTab(){
  return runChrome(`(async()=>{const S=window.__BREEZE_SHELL__;const r=await S.reopenClosedTab();if(r?.ok||r?.id){try{if(typeof setView==='function')setView('browse');}catch{}await S.setInternalView(false);}})()`);
}
function cycleTab(delta){
  return runChrome(`(async()=>{const S=window.__BREEZE_SHELL__;const tabs=(await S.listTabs())||[];if(tabs.length<2)return;const i=Math.max(0,tabs.findIndex(t=>t.active));const n=(i+(${Number(delta)})+tabs.length)%tabs.length;await S.selectTab(tabs[n].id);try{if(typeof setView==='function')setView('browse');}catch{}await S.setInternalView(false);})()`);
}
function selectTabIndex(index,last=false){
  return runChrome(`(async()=>{const S=window.__BREEZE_SHELL__;const tabs=(await S.listTabs())||[];if(!tabs.length)return;const t=${last?'tabs[tabs.length-1]':`tabs[Math.min(${Number(index)},tabs.length-1)]`};if(t){await S.selectTab(t.id);try{if(typeof setView==='function')setView(t.url?'browse':'home');}catch{}await S.setInternalView(!t.url);}})()`);
}
function openLinkInNewTab(url){
  const safe=JSON.stringify(String(url||''));
  return runChrome(`window.__BREEZE_SHELL__?.newTab({url:${safe}})`);
}
function wireShortcuts(wc){
  wc.on('before-input-event',(event,input)=>{
    if(!pageLike(wc)||input.type!=='keyDown')return;
    const mod=process.platform==='darwin'?input.meta:input.control;
    const key=String(input.key||'').toLowerCase();
    const nav=wc.navigationHistory;
    if(mod&&key==='l'){event.preventDefault();forwardToChrome(input);return;}
    if(mod&&!input.shift&&key==='t'){event.preventDefault();newTab(false);return;}
    if(mod&&input.shift&&key==='n'){event.preventDefault();newTab(true);return;}
    if(mod&&input.shift&&key==='t'){event.preventDefault();reopenClosedTab();return;}
    if(mod&&key==='w'){event.preventDefault();closeActiveTab();return;}
    if(mod&&key==='tab'){event.preventDefault();cycleTab(input.shift?-1:1);return;}
    if(mod&&/^[1-8]$/.test(key)){event.preventDefault();selectTabIndex(Number(key)-1,false);return;}
    if(mod&&key==='9'){event.preventDefault();selectTabIndex(0,true);return;}
    if(mod&&key==='o'){event.preventDefault();runChrome(`window.__BREEZE_SHELL__?.openPdf()`);return;}
    if(mod&&key==='f'){event.preventDefault();forwardToChrome(input);return;}
    if((mod&&key==='r')||key==='f5'){
      event.preventDefault();
      try{input.shift&&mod?wc.reloadIgnoringCache():wc.reload();}catch{}
      return;
    }
    if(input.alt&&key==='arrowleft'){event.preventDefault();try{if(nav.canGoBack())nav.goBack();}catch{};return;}
    if(input.alt&&key==='arrowright'){event.preventDefault();try{if(nav.canGoForward())nav.goForward();}catch{};return;}
    if(mod&&key==='p'){event.preventDefault();try{wc.print();}catch{};return;}
    if(mod&&(key==='0'||key==='+'||key==='='||key==='-')){
      event.preventDefault();
      try{
        const z=wc.getZoomFactor();
        wc.setZoomFactor(key==='0'?1:Math.max(.5,Math.min(2,key==='-'?z-.1:z+.1)));
      }catch{}
    }
  });
}
function wireContextMenu(wc){
  wc.on('context-menu',(_event,p)=>{
    if(!pageLike(wc))return;
    const template=[];
    if(p.linkURL){
      template.push({label:'Open link in new tab',click:()=>openLinkInNewTab(p.linkURL)});
      template.push({label:'Copy link address',click:()=>clipboard.writeText(String(p.linkURL||''))});
      template.push({type:'separator'});
    }
    if(p.isEditable){
      template.push({role:'cut'},{role:'copy'},{role:'paste'},{type:'separator'},{role:'selectAll'});
    }else if(p.selectionText){
      template.push({role:'copy'});
      const selected=String(p.selectionText).trim().slice(0,500);
      if(selected)template.push({label:`Search for “${selected.slice(0,48)}${selected.length>48?'…':''}”`,click:()=>runChrome(`(async()=>{const S=window.__BREEZE_SHELL__;const r=await S.resolveOmnibox(${JSON.stringify(selected)});if(r?.url)await S.newTab({url:r.url});})()`)});
      template.push({type:'separator'});
    }
    const nav=wc.navigationHistory;
    template.push(
      {label:'Back',enabled:!!nav?.canGoBack(),click:()=>{try{nav.goBack();}catch{}}},
      {label:'Forward',enabled:!!nav?.canGoForward(),click:()=>{try{nav.goForward();}catch{}}},
      {label:'Reload',click:()=>{try{wc.reload();}catch{}}}
    );
    Menu.buildFromTemplate(template).popup({window:chromeWindow()||undefined});
  });
}
function install(){
  if(installed)return;installed=true;
  app.on('web-contents-created',(_e,wc)=>{wireShortcuts(wc);wireContextMenu(wc);});
}
module.exports={install};
