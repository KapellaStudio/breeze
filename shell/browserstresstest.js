/* BREEZE — MULTI-TAB + BACKGROUND MEDIA STRESS
   Verifies the behavior users notice immediately: many tabs remain usable,
   rapid switching does not corrupt active state, and audible media keeps
   playing when its tab is in the background instead of being slept/destroyed. */
'use strict';
const { app, BrowserWindow } = require('electron');
const http = require('http');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const wait = ms => new Promise(r => setTimeout(r, ms));
const rows = [];
const ok = (name, cond, detail='') => rows.push([cond ? 'PASS' : 'FAIL', name, detail]);

const PAGE = name => `<!doctype html><html><head><title>${name}</title></head><body><h1>${name}</h1></body></html>`;
const MEDIA = `<!doctype html><html><head><title>Background Media</title></head><body>
<script>
(async()=>{
  try{
    const C=window.AudioContext||window.webkitAudioContext;
    const c=new C();
    const o=c.createOscillator();
    const g=c.createGain();
    g.gain.value=.04;
    o.connect(g);g.connect(c.destination);o.start();
    await c.resume();
    window.__breezeMedia={context:c,osc:o,started:c.state==='running'};
    document.title='Background Media Playing';
  }catch(e){window.__breezeMedia={started:false,error:String(e)}}
})();
</script><h1>Background media test</h1></body></html>`;

let port=0;
const server=http.createServer((req,res)=>{
  const p=(req.url||'/').split('?')[0];
  const body=p==='/media.html' ? MEDIA : PAGE('Stress '+p.replace(/\W+/g,' '));
  res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
  res.end(body);
});

require('./bootstrap.js');

app.whenReady().then(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',()=>{port=server.address().port;r()}));
  await wait(1900);
  const win=BrowserWindow.getAllWindows()[0];
  if(!win){ok('browser window exists',false);return finish();}
  const exec=js=>win.webContents.executeJavaScript(js);
  const base=`http://127.0.0.1:${port}`;
  try{
    const initial=await exec(`window.__BREEZE_SHELL__.listTabs()`);
    const initialCount=initial.length;

    const ids=[];
    for(let i=0;i<16;i++) ids.push(await exec(`window.__BREEZE_SHELL__.newTab({url:${JSON.stringify(base)}+'/t${i}.html'})`));
    await wait(1800);
    let tabs=await exec(`window.__BREEZE_SHELL__.listTabs()`);
    ok('opens 16 additional tabs without losing entries',tabs.length===initialCount+16,`${initialCount}->${tabs.length}`);
    ok('stress tabs all keep distinct ids',new Set(ids).size===16);

    for(const id of ids) await exec(`window.__BREEZE_SHELL__.selectTab(${id})`);
    await wait(250);
    tabs=await exec(`window.__BREEZE_SHELL__.listTabs()`);
    ok('rapid tab switching leaves exactly one active tab',tabs.filter(t=>t.active).length===1);
    ok('final rapid-switch target becomes active',tabs.find(t=>t.active)?.id===ids[ids.length-1]);

    for(const id of ids.slice(0,8)) await exec(`window.__BREEZE_SHELL__.closeTab(${id})`);
    await wait(300);
    tabs=await exec(`window.__BREEZE_SHELL__.listTabs()`);
    ok('rapid close removes the intended first half',ids.slice(0,8).every(id=>!tabs.some(t=>t.id===id)));
    ok('remaining stress tabs stay registered',ids.slice(8).every(id=>tabs.some(t=>t.id===id)));

    const mediaId=await exec(`window.__BREEZE_SHELL__.newTab({url:${JSON.stringify(base+'/media.html')}})`);
    await wait(1200);
    const mediaView=()=>win.contentView.children.find(v=>{
      try{return v.webContents.getURL()===base+'/media.html'}catch{return false}
    });
    let mv=mediaView();
    const started=mv ? await mv.webContents.executeJavaScript(`!!window.__breezeMedia?.started`) : false;
    ok('test media starts in its real page renderer',!!mv&&started);
    const audibleBefore=!!mv && mv.webContents.isCurrentlyAudible();
    ok('media renderer reports audible before tab switch',audibleBefore);

    const foreground=ids[ids.length-1];
    await exec(`window.__BREEZE_SHELL__.selectTab(${foreground})`);
    await wait(1200);
    mv=mediaView();
    ok('background media renderer is not destroyed on tab switch',!!mv&&!mv.webContents.isDestroyed());
    const audibleAfter=!!mv && mv.webContents.isCurrentlyAudible();
    ok('background media stays audible after switching tabs',audibleAfter);
    const mediaState=await exec(`window.__BREEZE_SHELL__.listTabs().then(x=>x.find(t=>t.id===${mediaId}))`);
    ok('audible background tab is not put to sleep',mediaState && !mediaState.sleeping && !mediaState.waking);

    await exec(`window.__BREEZE_SHELL__.selectTab(${mediaId})`);
    await wait(250);
    mv=mediaView();
    ok('returning to media tab keeps the same playing renderer',!!mv&&mv.webContents.isCurrentlyAudible());
    await exec(`window.__BREEZE_SHELL__.closeTab(${mediaId})`);
    await wait(300);
    ok('closing media tab tears down its renderer',!mediaView());

    for(const id of ids.slice(8)) await exec(`window.__BREEZE_SHELL__.closeTab(${id})`);
    await wait(300);
    tabs=await exec(`window.__BREEZE_SHELL__.listTabs()`);
    ok('stress cleanup returns to original tab count',tabs.length===initialCount,`${tabs.length}/${initialCount}`);
  }catch(err){
    rows.push(['FAIL','stress suite threw',String(err?.message||err).slice(0,180)]);
  }
  finish();
});

function finish(){
  try{server.close()}catch{}
  const failed=rows.filter(r=>r[0]==='FAIL');
  console.log('\n── BREEZE MULTI-TAB + MEDIA STRESS ──');
  rows.forEach(([s,n,d])=>console.log(`  ${s}  ${n}${d?'  ['+d+']':''}`));
  console.log(`\n  ${rows.length-failed.length}/${rows.length} passed\n`);
  app.exit(failed.length?1:0);
}
