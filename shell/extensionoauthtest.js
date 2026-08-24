'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const runtime=require('./extensions-runtime');

let pass=0,fail=0;
function ok(name,cond,detail=''){console.log(`${cond?'PASS':'FAIL'}  ${name}${detail?`  [${detail}]`:''}`);cond?pass++:fail++;}
function write(dir,file,body){const full=path.join(dir,file);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,body);}
function oauthServer(){return new Promise(resolve=>{const srv=http.createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1');if(u.pathname==='/oauth'){const rid=String(u.searchParams.get('rid')||'');if(/^[a-p]{32}$/.test(rid)){res.writeHead(302,{location:`https://${rid}.chromiumapp.org/callback?code=breeze-ok&state=probe`});res.end();return;}}res.writeHead(200,{'content-type':'text/plain'});res.end('oauth probe');});srv.listen(0,'127.0.0.1',()=>resolve(srv));});}

(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-oauth-'));
  const userData=path.join(tmp,'user-data');
  const source=path.join(tmp,'source');
  let srv=null,actionWin=null,ses=null,localId='';
  try{
    srv=await oauthServer();
    const port=srv.address().port;
    write(source,'manifest.json',JSON.stringify({manifest_version:3,name:'Breeze OAuth Probe',version:'1.0.0',permissions:['identity','storage'],host_permissions:['http://127.0.0.1/*'],background:{service_worker:'worker.js'},action:{default_popup:'popup.html'}},null,2));
    write(source,'worker.js','chrome.runtime.onInstalled.addListener(()=>{});');
    write(source,'popup.html','<!doctype html><html><body><pre id="out">loading</pre><script src="popup.js"></script></body></html>');
    write(source,'popup.js',`(async()=>{try{const redirect=chrome.identity.getRedirectURL('callback');const url='http://127.0.0.1:${port}/oauth?rid='+encodeURIComponent(chrome.runtime.id);const result=await chrome.identity.launchWebAuthFlow({url,interactive:false});document.getElementById('out').textContent=JSON.stringify({ok:true,redirect,result});}catch(err){document.getElementById('out').textContent=JSON.stringify({ok:false,error:String(err&&err.message||err)});}})();`);

    runtime.setInternalInvoker(async(channel)=>{if(channel==='tab:list')return[];throw new Error('unexpected browser IPC '+channel);});
    await app.whenReady();
    runtime.init(userData);
    const installed=runtime.importDirectory(source); localId=installed.extension.localId;
    ses=session.fromPartition('persist:breeze-oauth-'+Date.now());
    const loaded=await runtime.loadIntoSession(ses,'default');
    const row=loaded.find(x=>x.localId===localId);
    ok('OAuth probe extension loads through production runtime',row?.ok===true&&!!row.runtimeId,JSON.stringify(row));

    const opened=await runtime.openAction(localId,{workspaceId:'default'});
    actionWin=opened?.windowId?BrowserWindow.fromId(opened.windowId):null;
    let raw='';
    if(actionWin){for(let i=0;i<120;i++){raw=await actionWin.webContents.executeJavaScript('document.getElementById("out")?.textContent||""');if(raw&&raw!=='loading')break;await new Promise(r=>setTimeout(r,100));}}
    let result={};try{result=JSON.parse(raw||'{}');}catch{}
    ok('extension page exposes identity compatibility API',result.ok===true,raw);
    ok('getRedirectURL uses the real loaded extension id',result.redirect===`https://${row.runtimeId}.chromiumapp.org/callback`,String(result.redirect||''));
    ok('launchWebAuthFlow intercepts chromiumapp callback before external DNS',result.result===`https://${row.runtimeId}.chromiumapp.org/callback?code=breeze-ok&state=probe`,String(result.result||''));
    ok('OAuth result preserves authorization code and state',result.result?.includes('code=breeze-ok')&&result.result?.includes('state=probe'));

    await runtime.remove(localId,[{ses,workspaceId:'default'}]);
  }catch(err){console.error(err);fail++;}
  finally{
    try{if(actionWin&&!actionWin.isDestroyed())actionWin.destroy();}catch{}
    try{if(srv)srv.close();}catch{}
    try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}
  }
  console.log(`\nBreeze extension OAuth: ${pass}/${pass+fail}`);
  app.exit(fail?1:0);
})();
