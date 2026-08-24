'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bridge = require('./extensionbridge');

let pass=0, fail=0;
function ok(name,cond,detail=''){ console.log(`${cond?'PASS':'FAIL'}  ${name}${detail?`  [${detail}]`:''}`); cond?pass++:fail++; }
function write(dir,file,body){ const full=path.join(dir,file); fs.mkdirSync(path.dirname(full),{recursive:true}); fs.writeFileSync(full,body); }

(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-extbridge-'));
  const extDir=path.join(tmp,'extension');
  let win=null, loaded=null, ses=null;
  const seen=[];
  try{
    await app.whenReady();
    await bridge.init(async (ctx,method,args)=>{
      seen.push({ctx,method,args});
      if(method==='tabs.create') return {id:91,url:args?.url||'',active:true,windowId:7};
      if(method==='tabs.query') return [{id:91,url:'https://example.com/',active:true,windowId:7}];
      if(method==='windows.create') return {id:7,focused:true,type:'popup'};
      if(method==='windows.getAll') return [{id:7,focused:true,type:'normal'}];
      if(method==='notifications.create') return args?.id||'generated';
      if(method==='cookies.getAll') return [{name:'session',value:'ok',domain:'example.com',path:'/'}];
      if(method==='identity.launchWebAuthFlow') return 'https://probe.chromiumapp.org/callback?code=ok';
      return true;
    });
    const issued=bridge.issueContext({localId:'probe',workspaceId:'default'});
    const original='original-worker.js';
    write(extDir,'manifest.json',JSON.stringify({
      manifest_version:3,name:'Breeze Host Bridge Probe',version:'1.0.0',
      permissions:['storage'],host_permissions:['http://127.0.0.1/*'],
      background:{service_worker:'breeze-worker.js'},action:{default_popup:'popup.html'},
      commands:{'_execute_action':{description:'Open probe',suggested_key:{default:'Alt+Shift+B'}}}
    },null,2));
    write(extDir,'breeze-worker.js',bridge.workerBootstrap({endpoint:issued.endpoint,token:issued.token,originalWorker:original}));
    write(extDir,original,`(async()=>{\n  const tab=await chrome.tabs.create({url:'https://example.com/'});\n  const tabs=await chrome.tabs.query({active:true});\n  const popup=await chrome.windows.create({url:'popup.html',type:'popup'});\n  const windows=await chrome.windows.getAll({});\n  const notification=await chrome.notifications.create('wallet-ready',{type:'basic',title:'Ready',message:'Ready',iconUrl:'icon.png'});\n  const cookies=await chrome.cookies.getAll({domain:'example.com'});\n  const redirect=chrome.identity.getRedirectURL('callback');\n  const auth=await chrome.identity.launchWebAuthFlow({url:'https://login.example.com/',interactive:true});\n  const commands=await chrome.commands.getAll();\n  await chrome.storage.local.set({probe:{tab,tabs,popup,windows,notification,cookies,redirect,auth,commands}});\n})();`);
    write(extDir,'popup.html','<!doctype html><html><body><pre id="out"></pre><script src="popup.js"></script></body></html>');
    write(extDir,'popup.js',`chrome.storage.local.get('probe',r=>{document.getElementById('out').textContent=JSON.stringify(r.probe||{});});`);
    write(extDir,'icon.png','x');

    ses=session.fromPartition('persist:breeze-extbridge-'+Date.now());
    loaded=await ses.extensions.loadExtension(extDir,{allowFileAccess:false});
    ok('bridged MV3 extension loads',!!loaded,loaded?.id||'');

    win=new BrowserWindow({show:false,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    await win.loadURL(loaded.url+'popup.html');
    let probe={};
    for(let i=0;i<80;i++){
      const raw=await win.webContents.executeJavaScript(`document.getElementById('out')?.textContent||''`);
      if(raw){ try{ probe=JSON.parse(raw); }catch{} }
      if(probe.auth) break;
      await new Promise(r=>setTimeout(r,100));
    }
    ok('chrome.tabs.create bridged to Breeze host',probe.tab?.id===91,JSON.stringify(probe.tab||{}));
    ok('chrome.tabs.query bridged to Breeze host',Array.isArray(probe.tabs)&&probe.tabs[0]?.id===91);
    ok('chrome.windows.create bridged to Breeze host',probe.popup?.id===7);
    ok('chrome.windows.getAll bridged to Breeze host',Array.isArray(probe.windows)&&probe.windows[0]?.id===7);
    ok('notification bridge returns host id',probe.notification==='wallet-ready');
    ok('cookie bridge returns host session cookies',probe.cookies?.[0]?.value==='ok');
    ok('identity redirect URL is generated for extension id',typeof probe.redirect==='string'&&probe.redirect.includes('.chromiumapp.org/callback'),probe.redirect||'');
    ok('identity web-auth call crosses authenticated bridge',typeof probe.auth==='string'&&probe.auth.includes('code=ok'),probe.auth||'');
    ok('commands compatibility stays promise-capable',Array.isArray(probe.commands)&&probe.commands[0]?.name==='_execute_action');
    ok('host receives only allowlisted bridge methods',seen.length>=7&&seen.every(x=>bridge.ALLOWED.has(x.method)),seen.map(x=>x.method).join(','));

    const bad=await fetch(issued.endpoint,{method:'POST',headers:{'content-type':'text/plain'},body:JSON.stringify({token:'0'.repeat(64),method:'tabs.create',args:{}})});
    ok('invalid bridge token is rejected',bad.status===403,String(bad.status));
    const denied=await fetch(issued.endpoint,{method:'POST',headers:{'content-type':'text/plain'},body:JSON.stringify({token:issued.token,method:'runtime.eval',args:{}})});
    ok('non-allowlisted host method is rejected',denied.status===403,String(denied.status));
  }catch(err){ console.error(err); fail++; }
  finally{
    try{ if(win&&!win.isDestroyed()) win.destroy(); }catch{}
    try{ if(loaded&&ses) ses.extensions.removeExtension(loaded.id); }catch{}
    try{ await bridge.close(); }catch{}
    try{ fs.rmSync(tmp,{recursive:true,force:true}); }catch{}
  }
  console.log(`\nBreeze authenticated extension bridge: ${pass}/${pass+fail}`);
  app.exit(fail?1:0);
})();
