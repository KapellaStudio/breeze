'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const compat = require('./extension-compat');

let pass=0, fail=0;
function ok(name,cond,detail=''){ console.log(`${cond?'PASS':'FAIL'}  ${name}${detail?`  [${detail}]`:''}`); cond?pass++:fail++; }
function write(dir,file,body){ const full=path.join(dir,file); fs.mkdirSync(path.dirname(full),{recursive:true}); fs.writeFileSync(full,body); }
function serve(){ return new Promise(resolve=>{ const srv=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><body>compat target</body></html>');});srv.listen(0,'127.0.0.1',()=>resolve(srv));}); }

(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-extension-compat-'));
  const source=path.join(tmp,'source');
  const root=path.join(tmp,'managed');
  const localId='wallet-probe';
  const managed=path.join(root,localId);
  fs.mkdirSync(source,{recursive:true});
  const manifest={
    manifest_version:3,name:'Breeze Managed Compat Probe',version:'1.0.0',
    permissions:['storage','cookies'],host_permissions:['http://127.0.0.1/*'],
    background:{service_worker:'worker.js'},
    content_scripts:[{matches:['http://127.0.0.1/*'],js:['content.js'],run_at:'document_idle'}]
  };
  const originalWorker=`chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{\n  if(msg?.kind!=='exercise')return;\n  Promise.all([\n    chrome.tabs.create({url:'https://example.com/from-compat'}),\n    chrome.windows.create({url:'https://example.org/wallet'}),\n    chrome.cookies.getAll({domain:'example.com'})\n  ]).then(([tab,win,cookies])=>sendResponse({ok:true,tab,win,cookies})).catch(err=>sendResponse({ok:false,error:String(err&&err.message||err)}));\n  return true;\n});`;
  write(source,'manifest.json',JSON.stringify(manifest,null,2));
  write(source,'worker.js',originalWorker);
  write(source,'content.js',`setTimeout(()=>chrome.runtime.sendMessage({kind:'exercise'},response=>{document.documentElement.dataset.breezeCompat=JSON.stringify(response||{});}),200);`);
  fs.cpSync(source,managed,{recursive:true});

  const calls=[];
  compat.init({rootDir:root,handlers:{
    'tabs.create':async(ctx,params)=>{calls.push({method:'tabs.create',ctx,params});return{id:301,url:params.url,active:true};},
    'windows.create':async(ctx,params)=>{calls.push({method:'windows.create',ctx,params});return{id:401,focused:true,tabs:[{id:302,url:params.url}]};},
    'cookies.getAll':async(ctx,params)=>{calls.push({method:'cookies.getAll',ctx,params});return[{name:'probe',value:'ok',domain:params.domain,path:'/'}];}
  }});

  let srv,win,loaded;
  try{
    const sourceWorkerBefore=fs.readFileSync(path.join(source,'worker.js'),'utf8');
    const sourceManifestBefore=fs.readFileSync(path.join(source,'manifest.json'),'utf8');
    const prepared=await compat.prepareManagedCopy({localId,managedDir:managed});
    ok('managed MV3 copy is prepared for compatibility',prepared.prepared===true,JSON.stringify(prepared));
    ok('compatibility surface contains tabs, windows and declared cookies',prepared.methods.includes('tabs.create')&&prepared.methods.includes('windows.create')&&prepared.methods.includes('cookies.getAll'),JSON.stringify(prepared.methods));
    ok('user source worker remains untouched',fs.readFileSync(path.join(source,'worker.js'),'utf8')===sourceWorkerBefore);
    ok('user source manifest remains untouched',fs.readFileSync(path.join(source,'manifest.json'),'utf8')===sourceManifestBefore);

    const managedWorker=fs.readFileSync(path.join(managed,'worker.js'),'utf8');
    const managedManifest=JSON.parse(fs.readFileSync(path.join(managed,'manifest.json'),'utf8'));
    ok('managed worker receives one Breeze bootstrap',managedWorker.split(compat.PATCH_MARKER).length===2);
    ok('managed manifest carries loopback host permission',managedManifest.host_permissions.includes(compat.LOOPBACK_PERMISSION));
    const backupWorker=path.join(root,'.compat-originals',localId,'worker.js');
    ok('pristine worker backup lives outside loadable extension tree',fs.existsSync(backupWorker)&&fs.readFileSync(backupWorker,'utf8')===originalWorker&&!backupWorker.startsWith(managed+path.sep));

    const again=await compat.prepareManagedCopy({localId,managedDir:managed});
    ok('re-preparing in one process does not stack bootstraps',again.prepared===true&&fs.readFileSync(path.join(managed,'worker.js'),'utf8').split(compat.PATCH_MARKER).length===2);
    const privateRegistration=compat.registerRuntime(localId,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',{private:true,workspaceId:'private'});
    ok('Private Browsing runtime registration fails closed',privateRegistration.registered===false&&/Private Browsing/.test(privateRegistration.reason));

    await app.whenReady();
    srv=await serve(); const port=srv.address().port;
    const ses=session.fromPartition('persist:breeze-managed-compat-'+Date.now());
    loaded=await ses.extensions.loadExtension(managed,{allowFileAccess:false});
    ok('patched managed extension loads in Electron',!!loaded,loaded?.id||'');
    const registered=compat.registerRuntime(localId,loaded.id,{ses,workspaceId:'default',sealed:false,private:false});
    ok('loaded runtime is registered without exposing bridge secret',registered.registered===true&&!('token' in registered),JSON.stringify(registered));

    win=new BrowserWindow({show:false,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    await win.loadURL(`http://127.0.0.1:${port}/`);
    let raw='';
    for(let i=0;i<80;i++){raw=await win.webContents.executeJavaScript('document.documentElement.dataset.breezeCompat||""');if(raw)break;await new Promise(r=>setTimeout(r,100));}
    let result={};try{result=JSON.parse(raw||'{}');}catch{}
    ok('patched MV3 worker reaches Breeze compatibility bridge',result.ok===true,JSON.stringify(result));
    ok('tabs.create resolves through narrow host handler',result.tab?.id===301&&calls.some(x=>x.method==='tabs.create'),JSON.stringify(result.tab));
    ok('windows.create resolves through narrow host handler',result.win?.id===401&&calls.some(x=>x.method==='windows.create'),JSON.stringify(result.win));
    ok('cookies.getAll resolves against registered session context',result.cookies?.[0]?.name==='probe'&&calls.some(x=>x.method==='cookies.getAll'&&x.ctx.ses===ses),JSON.stringify(result.cookies));
    ok('only expected compatibility calls crossed bridge',calls.length===3,JSON.stringify(calls.map(x=>x.method)));
    const publicStatus=compat.status(localId);
    ok('public compatibility status contains no bearer token or endpoint',publicStatus.prepared===true&&!('token' in publicStatus)&&!('endpoint' in publicStatus),JSON.stringify(publicStatus));

    try{ses.extensions.removeExtension(loaded.id);}catch{}
  }catch(err){console.error(err);fail++;}
  finally{
    try{if(win&&!win.isDestroyed())win.destroy();}catch{}
    try{if(srv)srv.close();}catch{}
    try{await compat.close();}catch{}
    try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}
  }
  console.log(`\nManaged extension compatibility: ${pass}/${pass+fail}`);
  app.exit(fail?1:0);
})();
