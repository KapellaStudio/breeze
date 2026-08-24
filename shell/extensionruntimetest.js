'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const runtime = require('./extensions-runtime');

let pass=0, fail=0;
function ok(name,cond,detail=''){ console.log(`${cond?'PASS':'FAIL'}  ${name}${detail?`  [${detail}]`:''}`); cond?pass++:fail++; }
function write(dir,file,body){const full=path.join(dir,file);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,body);}
function serve(){return new Promise(resolve=>{const srv=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><body>runtime target</body></html>');});srv.listen(0,'127.0.0.1',()=>resolve(srv));});}

(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-runtime-compat-'));
  const source=path.join(tmp,'source');
  const userData=path.join(tmp,'user-data');
  fs.mkdirSync(source,{recursive:true});
  const manifest={
    manifest_version:3,name:'Breeze Runtime Wallet Probe',version:'1.0.0',
    permissions:['storage','cookies'],host_permissions:['http://127.0.0.1/*','https://*/*'],
    background:{service_worker:'worker.js'},
    content_scripts:[{matches:['http://127.0.0.1/*'],js:['content.js'],run_at:'document_idle'}]
  };
  write(source,'manifest.json',JSON.stringify(manifest,null,2));
  write(source,'worker.js',`chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{\n if(msg?.kind!=='exercise')return;\n (async()=>{\n  const tab=await chrome.tabs.create({url:'https://example.com/from-wallet'});\n  const popup=await chrome.windows.create({url:'https://example.org/wallet-popup',type:'popup',focused:false,width:420,height:500});\n  await chrome.cookies.set({url:'https://example.com/',name:'walletprobe',value:'ok'});\n  const cookies=await chrome.cookies.getAll({domain:'example.com'});\n  return {ok:true,tab,popup,cookies};\n })().then(sendResponse).catch(err=>sendResponse({ok:false,error:String(err?.message||err)}));\n return true;\n});`);
  write(source,'content.js',`setTimeout(()=>chrome.runtime.sendMessage({kind:'exercise'},r=>{document.documentElement.dataset.breezeRuntimeCompat=JSON.stringify(r||{});}),150);`);

  const internal=[];
  runtime.setInternalInvoker(async(channel,...args)=>{
    internal.push({channel,args});
    if(channel==='tab:create') return 701;
    if(channel==='tab:list') return [{id:701,url:'https://example.com/from-wallet',title:'Wallet tab',active:true,private:false,sleeping:false,loading:false}];
    throw new Error('unexpected internal channel '+channel);
  });

  let srv,win,ses,installed;
  try{
    await app.whenReady();
    runtime.init(userData);
    installed=runtime.importDirectory(source);
    ok('runtime imports managed MV3 extension',installed?.installed===true,JSON.stringify(installed));
    const localId=installed.extension.localId;
    ses=session.fromPartition('persist:breeze-runtime-probe-'+Date.now());
    const loaded=await runtime.loadIntoSession(ses,'default');
    const row=loaded.find(x=>x.localId===localId);
    ok('runtime loads extension after managed compatibility preparation',row?.ok===true&&!!row.runtimeId,JSON.stringify(row));
    const status=runtime.list().find(x=>x.localId===localId)?.compatibilityBridge;
    ok('runtime reports active loopback compatibility tier',status?.prepared===true&&status?.bridge==='loopback-v1'&&status?.runtimeCount===1,JSON.stringify(status));

    srv=await serve(); const port=srv.address().port;
    win=new BrowserWindow({show:false,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    await win.loadURL(`http://127.0.0.1:${port}/`);
    let raw='';
    for(let i=0;i<100;i++){raw=await win.webContents.executeJavaScript('document.documentElement.dataset.breezeRuntimeCompat||""');if(raw)break;await new Promise(r=>setTimeout(r,100));}
    let result={};try{result=JSON.parse(raw||'{}');}catch{}
    ok('production runtime bridge completes wallet-style host calls',result.ok===true,JSON.stringify(result));
    ok('chrome.tabs.create becomes a normal Breeze tab request',result.tab?.id===701&&internal.some(x=>x.channel==='tab:create'),JSON.stringify(result.tab));
    ok('chrome.windows.create opens an extension-owned sandboxed window',Number.isInteger(result.popup?.id)&&result.popup?.type==='popup',JSON.stringify(result.popup));
    ok('chrome.cookies is scoped to the registered Breeze session',result.cookies?.some(c=>c.name==='walletprobe'&&c.value==='ok'),JSON.stringify(result.cookies));
    ok('bridge uses only narrow captured browser IPC channels',internal.every(x=>x.channel==='tab:create'||x.channel==='tab:list'),JSON.stringify(internal.map(x=>x.channel)));

    await runtime.remove(localId,[{ses,workspaceId:'default'}]);
    ok('removing extension clears runtime registry and managed copy',!runtime.list().some(x=>x.localId===localId));
  }catch(err){console.error(err);fail++;}
  finally{
    try{if(win&&!win.isDestroyed())win.destroy();}catch{}
    try{if(srv)srv.close();}catch{}
    try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}
  }
  console.log(`\nBreeze production extension runtime: ${pass}/${pass+fail}`);
  app.exit(fail?1:0);
})();
