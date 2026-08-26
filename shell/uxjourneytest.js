/* Native-input daily-driver journey.
   This is intentionally not a unit test. It drives a real WebContentsView with
   mouse/keyboard events and checks what a person would perceive: immediate
   navigation feedback, stable tab behavior and a quiet familiar chrome. */
'use strict';
process.argv.push('--smoke-test');
const { app, BrowserWindow } = require('electron');
const http=require('node:http');

const results=[];
const ok=(name,cond,extra='')=>results.push([cond?'PASS':'FAIL',name,extra]);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let server,port=0;
function url(path){return `http://127.0.0.1:${port}${path}`;}
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
  view.webContents.sendInputEvent({type:'mouseMove',x:rect.x,y:rect.y});
  view.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:rect.x,y:rect.y});
  view.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:rect.x,y:rect.y});
  return true;
}
async function finish(){
  try{server?.close();}catch{}
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
    await wait(1800);
    const win=chromeWin();ok('browser window exists',!!win);if(!win)return finish();

    ok('New Tab keeps the normal browser toolbar visible',await chrome(`getComputedStyle(document.querySelector('.chrome')).display==='flex'`));
    ok('prototype fake signed-in identity is gone',await chrome(`!document.querySelector('.sideId')`));
    ok('tab rail has a familiar New tab button',await chrome(`!!document.querySelector('#breezeSideNewTab')`));
    const visibleTools=await chrome(`[...document.querySelectorAll('.tools>button')].filter(b=>getComputedStyle(b).display!=='none').length`);
    ok('default toolbar is quiet rather than feature-wall chrome',visibleTools<=6,'visible='+visibleTools);
    ok('advanced Breeze features remain behind one Tools control',await chrome(`!!document.querySelector('#breezeToolsBtn')`));

    const id=await chrome(`window.__BREEZE_SHELL__.newTab({url:${JSON.stringify(url('/start'))}})`);await chrome(`setView('browse');window.__BREEZE_SHELL__.setInternalView(false)`);await wait(700);
    let view=pageFor('/start');ok('real test page is visible in Chromium',!!view);if(!view)return finish();

    let navAt=0;view.webContents.once('will-navigate',()=>{navAt=Date.now();});
    const clickAt=Date.now();ok('native mouse can hit an ordinary result link',await clickElement(view,'#same'));
    await wait(260);
    ok('link activation reaches navigation without a dead-click pause',navAt>0&&navAt-clickAt<250,navAt?`${navAt-clickAt}ms`:'no navigation');
    ok('Breeze shows navigation activity before slow content arrives',await chrome(`document.documentElement.dataset.navbusy==='1'`));
    await wait(1900);
    ok('slow clicked page eventually finishes in the same real tab',/Slow Target/.test(view.webContents.getTitle()),view.webContents.getTitle());

    await view.webContents.loadURL(url('/start'));await wait(350);
    const beforeTabs=(await chrome(`window.__BREEZE_SHELL__.listTabs()`)).length;
    ok('native mouse can hit target=_blank link',await clickElement(view,'#blank'));await wait(450);
    const afterTabs=(await chrome(`window.__BREEZE_SHELL__.listTabs()`)).length;
    ok('ordinary new-tab link opens one Breeze tab',afterTabs===beforeTabs+1,`${beforeTabs}->${afterTabs}`);

    await chrome(`window.__BREEZE_SHELL__.selectTab(${id});setView('browse');window.__BREEZE_SHELL__.setInternalView(false)`);await wait(200);view=pageFor('/start');
    if(view){
      const mod=process.platform==='darwin'?'meta':'control';
      view.webContents.sendInputEvent({type:'keyDown',keyCode:'L',modifiers:[mod]});view.webContents.sendInputEvent({type:'keyUp',keyCode:'L',modifiers:[mod]});await wait(220);
      ok('Cmd/Ctrl+L still works while focus is inside the webpage',await chrome(`document.documentElement.dataset.omni==='1'&&document.activeElement?.id==='omniInput'`));
      await chrome(`if(typeof closeAll==='function')closeAll()`);
    }

    const homeId=await chrome(`window.__BREEZE_SHELL__.newTab({})`);await chrome(`setView('home');window.__BREEZE_SHELL__.setInternalView(true)`);await wait(150);
    const transitionAt=Date.now();
    await chrome(`(()=>{const i=document.querySelector('.bigsearch input');i.value=${JSON.stringify(url('/slow'))};i.focus();i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));})()`);
    await wait(150);
    const viewMode=await chrome(`document.documentElement.dataset.view`);
    ok('Home search reveals the browser before the network finishes',viewMode==='browse',`${Date.now()-transitionAt}ms / ${viewMode}`);
    ok('Home search gives immediate loading feedback',await chrome(`document.documentElement.dataset.navbusy==='1'`));
    await wait(1900);
    const tabs=await chrome(`window.__BREEZE_SHELL__.listTabs()`);const homeTab=tabs.find(t=>t.id===homeId);
    ok('Home search lands on the requested page',/\/slow$/.test(homeTab?.url||''),homeTab?.url||'');
  }catch(err){results.push(['FAIL','journey threw',String(err?.stack||err).slice(0,260)]);}
  finish();
});
