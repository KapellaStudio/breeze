'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

let pass=0, fail=0;
function ok(name,cond,detail=''){ console.log(`${cond?'PASS':'FAIL'}  ${name}${detail?`  [${detail}]`:''}`); cond?pass++:fail++; }
function write(dir,file,body){ const full=path.join(dir,file); fs.mkdirSync(path.dirname(full),{recursive:true}); fs.writeFileSync(full,body); }
function listen(handler){ return new Promise(resolve=>{ const srv=http.createServer(handler); srv.listen(0,'127.0.0.1',()=>resolve(srv)); }); }

(async()=>{
  const token=crypto.randomBytes(32).toString('hex');
  const calls=[];
  let bridge,target,win;
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-ext-bridge-'));
  try{
    bridge=await listen(async(req,res)=>{
      if(req.url!=='/rpc' || req.method!=='POST'){ res.writeHead(404); res.end(); return; }
      if(req.headers.authorization!==`Bearer ${token}`){ res.writeHead(401,{'content-type':'application/json'}); res.end(JSON.stringify({error:'unauthorized'})); return; }
      let raw=''; for await (const chunk of req) raw+=chunk;
      let body={}; try{body=JSON.parse(raw||'{}');}catch{}
      calls.push({method:body.method,params:body.params,origin:req.headers.origin||''});
      let result=null;
      if(body.method==='tabs.create') result={id:41,url:body.params?.url||'',active:true};
      else if(body.method==='windows.create') result={id:7,focused:true,tabs:[{id:42,url:body.params?.url||''}]};
      else if(body.method==='cookies.getAll') result=[{name:'probe',value:'ok',domain:'example.com',path:'/'}];
      else { res.writeHead(400,{'content-type':'application/json'}); res.end(JSON.stringify({error:'unknown method'})); return; }
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({result}));
    });
    target=await listen((_req,res)=>{ res.writeHead(200,{'content-type':'text/html'}); res.end('<!doctype html><html><body>bridge target</body></html>'); });
    const bridgePort=bridge.address().port;
    const targetPort=target.address().port;

    const extDir=path.join(tmp,'extension'); fs.mkdirSync(extDir,{recursive:true});
    const manifest={
      manifest_version:3,name:'Breeze Compatibility Bridge Probe',version:'1.0.0',
      permissions:['storage'],host_permissions:['http://127.0.0.1/*'],
      background:{service_worker:'worker.js'},
      content_scripts:[{matches:['http://127.0.0.1/*'],js:['content.js'],run_at:'document_idle'}]
    };
    write(extDir,'manifest.json',JSON.stringify(manifest,null,2));
    write(extDir,'worker.js',`const BASE='http://127.0.0.1:${bridgePort}';\nconst TOKEN='${token}';\nasync function rpc(method,params){const r=await fetch(BASE+'/rpc',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+TOKEN},body:JSON.stringify({method,params})});const j=await r.json();if(!r.ok)throw new Error(j.error||('bridge '+r.status));return j.result;}\nif(!chrome.tabs)chrome.tabs={};if(typeof chrome.tabs.create!=='function')chrome.tabs.create=details=>rpc('tabs.create',details||{});\nif(!chrome.windows)chrome.windows={};if(typeof chrome.windows.create!=='function')chrome.windows.create=details=>rpc('windows.create',details||{});\nif(!chrome.cookies)chrome.cookies={};if(typeof chrome.cookies.getAll!=='function')chrome.cookies.getAll=details=>rpc('cookies.getAll',details||{});\nchrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{if(msg?.kind!=='exercise')return;Promise.all([chrome.tabs.create({url:'https://example.com/a'}),chrome.windows.create({url:'https://example.org/b'}),chrome.cookies.getAll({domain:'example.com'})]).then(([tab,window,cookies])=>sendResponse({ok:true,tab,window,cookies})).catch(err=>sendResponse({ok:false,error:String(err)}));return true;});`);
    write(extDir,'content.js',`chrome.runtime.sendMessage({kind:'exercise'},response=>{document.documentElement.dataset.breezeBridge=JSON.stringify(response||{});});`);

    await app.whenReady();
    const ses=session.fromPartition('persist:breeze-bridge-probe-'+Date.now());
    let loaded=null,loadError='';
    try{loaded=await ses.extensions.loadExtension(extDir,{allowFileAccess:false});}catch(err){loadError=String(err?.stack||err);}
    ok('bridge probe extension loads',!!loaded,loadError||loaded?.id||'');
    if(!loaded)throw new Error(loadError||'extension failed to load');
    win=new BrowserWindow({show:false,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    await win.loadURL(`http://127.0.0.1:${targetPort}/`);
    let raw='';
    for(let i=0;i<60;i++){ raw=await win.webContents.executeJavaScript('document.documentElement.dataset.breezeBridge||""'); if(raw)break; await new Promise(r=>setTimeout(r,100)); }
    let response={}; try{response=JSON.parse(raw||'{}');}catch{}
    ok('MV3 worker can call the authenticated Breeze loopback bridge',response.ok===true,JSON.stringify(response));
    ok('bridge returns tab creation result',response.tab?.id===41 && response.tab?.url==='https://example.com/a',JSON.stringify(response.tab));
    ok('bridge returns window creation result',response.window?.id===7 && response.window?.tabs?.[0]?.url==='https://example.org/b',JSON.stringify(response.window));
    ok('bridge returns cookie result',response.cookies?.[0]?.name==='probe',JSON.stringify(response.cookies));
    ok('all bridge calls require the injected bearer token',calls.length===3 && calls.every(c=>c.method),JSON.stringify(calls));
    ok('bridge receives requests from extension context rather than page JS',calls.every(c=>!c.origin || c.origin.startsWith('chrome-extension://')),JSON.stringify(calls.map(c=>c.origin)));
    try{ses.extensions.removeExtension(loaded.id);}catch{}
  }catch(err){ console.error(err); fail++; }
  finally{
    try{if(win&&!win.isDestroyed())win.destroy();}catch{}
    try{if(bridge)bridge.close();}catch{}
    try{if(target)target.close();}catch{}
    try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}
  }
  console.log(`\nBreeze extension bridge: ${pass}/${pass+fail}`);
  app.exit(fail?1:0);
})();
