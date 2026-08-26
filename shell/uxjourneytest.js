/* Native-input daily-driver journey.
   This is intentionally not a unit test. It drives a real WebContentsView with
   mouse/keyboard events and checks what a person would perceive: immediate
   navigation feedback, stable tab behavior and a quiet familiar chrome. */
'use strict';
const { app, BrowserWindow } = require('electron');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const profile=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-ux-journey-'));
app.setPath('userData',profile);

const results=[];
const ok=(name,cond,extra='')=>results.push([cond?'PASS':'FAIL',name,extra]);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,timeout=6000,step=60){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    try{const value=await fn();if(value)return value;}catch{}
    await wait(step);
  }
  return null;
}
let server,port=0;
function url(p){return `http://127.0.0.1:${port}${p}`;}
function startServer(){
  server=http.createServer((req,res)=>{
    if(req.url==='/slow')return setTimeout(()=>{res.writeHead(200,{'content-type':'text/html'});res.end('<title>Slow Target</title><h1>Loaded</h1>');},1800);
    res.writeHead(200,{'content-type':'text/html'});
    res.end(`<title>Journey Start</title><style>body{font:16px sans-serif;padding:60px}a{display:block;margin:30px;padding:18px}</style><a id="same" href="${url('/slow')}">Open slow result</a><a id="blank" target="_blank" href="${url('/slow')}">Open in new tab</a>`);
  });
  return new Promise(r=>server.listen(0,'127.0.0.1',()=>{port=server.address().port;r();}));
}
function chromeWin(){return BrowserWindow.getAllWindows()[0]||null;}
async function chrome(js){const w=chromeWin();return w?await w.webContents.executeJavaScript(js):null;}
function pageViews(){const w=chromeWin();return (w?.contentView?.children||[]).filter(v=>v?.webContents&&!v.webContents.isDestroyed());}
function pageFor(fragment){return pageViews().find(v=>String(v.webContents.getURL()).includes(fragment));}
async function clickElement(view,selector){
  const rect=await view.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
  if(!rect)return false;
  view.webContents.focus();
  view.webContents.sendInputEvent({type:'mouseMove',x:rect.x,y:rect.y});
  view.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:rect.x,y:rect.y});
  view.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:rect.x,y:rect.y});
  return true;
}
async function finish(){
  try{server?.close();}catch{}
  try{fs.rmSync(profile,{recursive:true,force:true});}catch{}
  const failed=results.filter(r=>r[0]==='FAIL');
  console.log('\n── BREEZE NATIVE DAILY-DRIVER JOURNEY ──');
  results.forEach(([s,n,x])=>console.log(`  ${s}  ${n}${x?'  ['+x+']':''}`));
  console.log(`\n  ${results.length-failed.length}/${results.length} passed\n`);
  app.exit(failed.length?1:0);
}

require('./entry');
app.whenReady().then(async()=>{
  try{
    await startServer();
    await wait(1500);
    const win=chromeWin();ok('browser window exists',!!win);if(!win)return finish();

    await chrome(`document.querySelector('[data-launch-later]')?.click()`);
    await wait(180);

    ok('New Tab keeps the normal browser toolbar visible',await chrome(`getComputedStyle(document.querySelector('.chrome')).display==='flex'`));
    ok('prototype fake signed-in identity is gone',await chrome(`!document.querySelector('.sideId')`));
    ok('tab rail has a familiar New tab button',await chrome(`!!document.querySelector('#breezeSideNewTab')`));
    const visibleTools=await chrome(`[...document.querySelectorAll('.tools>button')].filter(b=>{const s=getComputedStyle(b);return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0}).length`);
    ok('default toolbar is quiet rather than feature-wall chrome',visibleTools<=6,'visible='+visibleTools);
    ok('advanced Breeze features remain behind one Tools control',await chrome(`!!document.querySelector('#breezeToolsBtn')`));

    const id=await chrome(`window.__BREEZE_SHELL__.newTab({url:${JSON.stringify(url('/start'))}})`);
    await chrome(`setView('browse');window.__BREEZE_SHELL__.setInternalView(false)`);
    const viewReady=await waitFor(()=>pageFor('/start'),3000);
    let view=viewReady;ok('real test page is visible in Chromium',!!view);if(!view)return finish();

    let navAt=0;view.webContents.once('will-navigate',()=>{navAt=Date.now();});
    const clickAt=Date.now();ok('native mouse can hit an ordinary result link',await clickElement(view,'#same'));
    await wait(120);
    ok('link activation reaches navigation without a dead-click pause',navAt>0&&navAt-clickAt<250,navAt?`${navAt-clickAt}ms`:'no navigation');
    const busy=await waitFor(()=>chrome(`document.documentElement.dataset.navbusy==='1'`),500,30);
    ok('Breeze shows navigation activity before slow content arrives',!!busy);
    const slowLoaded=await waitFor(()=>/\/slow$/.test(view.webContents.getURL())&&/Slow Target/.test(view.webContents.getTitle()),6500,80);
    ok('slow clicked page eventually finishes in the same real tab',!!slowLoaded,`${view.webContents.getURL()} / ${view.webContents.getTitle()}`);

    if(!slowLoaded)return finish();
    await view.webContents.loadURL(url('/start'));
    await waitFor(()=>/Journey Start/.test(view.webContents.getTitle()),2500);
    const beforeTabs=(await chrome(`window.__BREEZE_SHELL__.listTabs()`)).length;
    ok('native mouse can hit target=_blank link',await clickElement(view,'#blank'));
    const afterTabs=await waitFor(async()=>{const n=(await chrome(`window.__BREEZE_SHELL__.listTabs()`)).length;return n===beforeTabs+1?n:0;},2500,60);
    ok('ordinary new-tab link opens one Breeze tab',!!afterTabs,`${beforeTabs}->${afterTabs||'timeout'}`);

    await chrome(`window.__BREEZE_SHELL__.selectTab(${id});setView('browse');window.__BREEZE_SHELL__.setInternalView(false)`);await wait(160);view=pageFor('/start');
    if(view){
      const mod=process.platform==='darwin'?'meta':'control';
      view.webContents.focus();
      view.webContents.sendInputEvent({type:'keyDown',keyCode:'L',modifiers:[mod]});view.webContents.sendInputEvent({type:'keyUp',keyCode:'L',modifiers:[mod]});
      const focused=await waitFor(()=>chrome(`document.documentElement.dataset.omni==='1'&&document.activeElement?.id==='omniInput'`),1000,40);
      ok('Cmd/Ctrl+L still works while focus is inside the webpage',!!focused);
      await chrome(`if(typeof closeAll==='function')closeAll()`);
    }

    const homeId=await chrome(`window.__BREEZE_SHELL__.newTab({})`);await chrome(`setView('home');window.__BREEZE_SHELL__.setInternalView(true)`);await wait(150);
    const transitionAt=Date.now();
    await chrome(`(()=>{const i=document.querySelector('.bigsearch input');i.value=${JSON.stringify(url('/slow'))};i.focus();i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));})()`);
    const browsed=await waitFor(()=>chrome(`document.documentElement.dataset.view==='browse'`),600,30);
    ok('Home search reveals the browser before the network finishes',!!browsed,`${Date.now()-transitionAt}ms`);
    const homeBusy=await waitFor(()=>chrome(`document.documentElement.dataset.navbusy==='1'`),600,30);
    ok('Home search gives immediate loading feedback',!!homeBusy);
    const homeLanded=await waitFor(async()=>{const tabs=await chrome(`window.__BREEZE_SHELL__.listTabs()`);const t=(tabs||[]).find(x=>x.id===${homeId});return /\/slow$/.test(t?.url||'')?t.url:null;},6500,80);
    ok('Home search lands on the requested page',!!homeLanded,homeLanded||'not committed');
  }catch(err){results.push(['FAIL','journey threw',String(err?.stack||err).slice(0,300)]);}
  finish();
});
