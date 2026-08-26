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
function forwardToChrome(input){
  const win=chromeWindow();if(!win)return;
  const mods=[];
  if(input.control)mods.push('control');
  if(input.meta)mods.push('meta');
  if(input.shift)mods.push('shift');
  if(input.alt)mods.push('alt');
  try{win.webContents.focus();win.webContents.sendInputEvent({type:'keyDown',keyCode:input.key,modifiers:mods});win.webContents.sendInputEvent({type:'keyUp',keyCode:input.key,modifiers:mods});}catch{}
}
function wireShortcuts(wc){
  wc.on('before-input-event',(event,input)=>{
    if(!pageLike(wc)||input.type!=='keyDown')return;
    const mod=process.platform==='darwin'?input.meta:input.control;
    const key=String(input.key||'').toLowerCase();
    const nav=wc.navigationHistory;
    if(mod&&key==='l'){event.preventDefault();forwardToChrome(input);return;}
    if(mod&&key==='t'){event.preventDefault();forwardToChrome(input);return;}
    if(mod&&input.shift&&key==='n'){event.preventDefault();forwardToChrome(input);return;}
    if(mod&&input.shift&&key==='t'){event.preventDefault();forwardToChrome(input);return;}
    if(mod&&key==='o'){event.preventDefault();forwardToChrome(input);return;}
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
      template.push({label:'Open link in new tab',click:()=>{try{wc.executeJavaScript(`window.open(${JSON.stringify(p.linkURL)}, '_blank')`);}catch{}}});
      template.push({label:'Copy link address',click:()=>clipboard.writeText(String(p.linkURL||''))});
      template.push({type:'separator'});
    }
    if(p.isEditable){
      template.push({role:'cut'},{role:'copy'},{role:'paste'},{type:'separator'},{role:'selectAll'});
    }else if(p.selectionText){
      template.push({role:'copy'},{type:'separator'});
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
