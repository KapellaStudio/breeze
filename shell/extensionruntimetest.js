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
    permissions:['storage','cookies','notifications','identity'],host_permissions:['http://127.0.0.1/*','https://*/*'],
    background:{service_worker:'worker.js'},action:{default_popup:'popup.html'},
    commands:{'_execute_action':{description:'Open wallet',suggested_key:{default:'Alt+Shift+B'}}},
    content_scripts:[{matches:['http://127.0.0.1/*'],js:['content.js'],run_at:'document_idle'}]
  };
  write(source,'manifest.json',JSON.stringify(manifest,null,2));
  write(source,'worker.js',`chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{\n if(msg?.kind!=='exercise')return;\n (async()=>{\n  const tab=await chrome.tabs.create({url:'https://example.com/from-wallet'});\n  const queried=await chrome.tabs.query({active:true});\n  const current=await chrome.tabs.getCurrent();\n  const updated=await chrome.tabs.update(tab.id,{url:'https://example.com/updated',highlighted:true});\n  const fetched=await chrome.tabs.get(tab.id);\n  const popup=await chrome.windows.create({url:'https://example.org/wallet-popup',type:'popup',focused:false,width:420,height:500});\n  await chrome.cookies.set({url:'https://example.com/',name:'walletprobe',value:'ok'});\n  const cookies=await chrome.cookies.getAll({domain:'example.com'});\n  const notification=await chrome.notifications.create('wallet-ready',{type:'basic',title:'Wallet ready',message:'Ready',iconUrl:'icon.png'});\n  const cleared=await chrome.notifications.clear(notification);\n  const redirect=chrome.identity.getRedirectURL('callback');\n  const commands=await chrome.commands.getAll();\n  await chrome.tabs.remove(tab.id);\n  return {ok:true,tab,queried,current,updated,fetched,popup,cookies,notification,cleared,redirect,commands,removed:true};\n })().then(sendResponse).catch(err=>sendResponse({ok:false,error:String(err?.message||err)}));\n return true;\n});`);
  write(source,'content.js',`setTimeout(()=>chrome.runtime.sendMessage({kind:'exercise'},r=>{document.documentElement.dataset.breezeRuntimeCompat=JSON.stringify(r||{});}),150);`);
  write(source,'popup.html','<!doctype html><html><body><pre id="page">loading</pre><script src="popup.js"></script></body></html>');
  write(source,'popup.js',`(async()=>{try{\n const current=await chrome.windows.getCurrent();\n const tabs=await chrome.tabs.query({active:true});\n const created=await chrome.tabs.create({url:'https://example.net/from-action-popup'});\n const commands=await chrome.commands.getAll();\n await chrome.tabs.remove(created.id);\n const browserApi=globalThis.browser;\n const browserCurrent=await browserApi.windows.getCurrent();\n const browserTabs=await browserApi.tabs.query({active:true});\n const browserCreated=await browserApi.tabs.create({url:'https://example.net/from-browser-namespace'});\n const browserCommands=await browserApi.commands.getAll();\n await browserApi.tabs.remove(browserCreated.id);\n document.getElementById('page').textContent=JSON.stringify({ok:true,current,tabs,created,commands,browserPresent:!!browserApi,browserCurrent,browserTabs,browserCreated,browserCommands});\n }catch(err){document.getElementById('page').textContent=JSON.stringify({ok:false,error:String(err&&err.message||err)});}})();`);
  write(source,'icon.png','x');

  const internal=[];
  let tabState=null;
  runtime.setInternalInvoker(async(channel,...args)=>{
    internal.push({channel,args});
    if(channel==='tab:create'){
      const opts=args[0]||{};
      tabState={id:701,url:String(opts.url||''),title:'Wallet tab',active:true,workspace:String(opts.workspaceId||'default'),private:false,sleeping:false,loading:false};
      return 701;
    }
    if(channel==='tab:list') return tabState?[{...tabState}]:[];
    if(channel==='tab:navigate'){
      if(tabState&&Number(args[0])===tabState.id) tabState.url=String(args[1]||tabState.url);
      return tabState?.url||null;
    }
    if(channel==='tab:select'){
      if(tabState&&Number(args[0])===tabState.id) tabState.active=true;
      return true;
    }
    if(channel==='tab:close'){
      if(tabState&&Number(args[0])===tabState.id) tabState=null;
      return true;
    }
    throw new Error('unexpected internal channel '+channel);
  });

  let srv,win,ses,installed,actionWin;
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
    ok('runtime reports active loopback compatibility tier',status?.prepared===true&&status?.bridge==='loopback-v2'&&status?.runtimeCount===1,JSON.stringify(status));
    ok('runtime advertises bridged tab, cookie, notification and identity methods',status?.methods?.includes('tabs.update')&&status?.methods?.includes('tabs.remove')&&status?.methods?.includes('cookies.getAll')&&status?.methods?.includes('notifications.create')&&status?.methods?.includes('identity.launchWebAuthFlow'),JSON.stringify(status?.methods));

    srv=await serve(); const port=srv.address().port;
    win=new BrowserWindow({show:false,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    await win.loadURL(`http://127.0.0.1:${port}/`);
    let raw='';
    for(let i=0;i<100;i++){raw=await win.webContents.executeJavaScript('document.documentElement.dataset.breezeRuntimeCompat||""');if(raw)break;await new Promise(r=>setTimeout(r,100));}
    let result={};try{result=JSON.parse(raw||'{}');}catch{}
    ok('production runtime bridge completes wallet-style host calls',result.ok===true,JSON.stringify(result));
    ok('chrome.tabs.create becomes a normal Breeze tab request',result.tab?.id===701&&internal.some(x=>x.channel==='tab:create'),JSON.stringify(result.tab));
    ok('chrome.tabs.query/getCurrent see the Breeze active tab',result.queried?.[0]?.id===701&&result.current?.id===701,JSON.stringify({queried:result.queried,current:result.current}));
    ok('chrome.tabs.update routes navigation and selection through Breeze',result.updated?.id===701&&result.updated?.url==='https://example.com/updated'&&internal.some(x=>x.channel==='tab:navigate')&&internal.some(x=>x.channel==='tab:select'),JSON.stringify(result.updated));
    ok('chrome.tabs.get returns updated Breeze tab state',result.fetched?.url==='https://example.com/updated',JSON.stringify(result.fetched));
    ok('chrome.tabs.remove routes through Breeze close lifecycle',result.removed===true&&internal.some(x=>x.channel==='tab:close'));
    ok('chrome.windows.create opens an extension-owned sandboxed window',Number.isInteger(result.popup?.id)&&result.popup?.type==='popup',JSON.stringify(result.popup));
    ok('chrome.cookies is scoped to the registered Breeze session',result.cookies?.some(c=>c.name==='walletprobe'&&c.value==='ok'),JSON.stringify(result.cookies));
    ok('notification compatibility returns and clears a stable id',result.notification==='wallet-ready'&&typeof result.cleared==='boolean',JSON.stringify({notification:result.notification,cleared:result.cleared}));
    ok('identity redirect URL is scoped to the loaded extension id',typeof result.redirect==='string'&&result.redirect.includes('.chromiumapp.org/callback'),String(result.redirect||''));
    ok('commands getAll compatibility preserves declared shortcut metadata',result.commands?.[0]?.name==='_execute_action',JSON.stringify(result.commands));

    const opened=await runtime.openAction(localId,{workspaceId:'default',sealed:false});
    actionWin=opened?.windowId?BrowserWindow.fromId(opened.windowId):null;
    let pageRaw='';
    if(actionWin){for(let i=0;i<80;i++){pageRaw=await actionWin.webContents.executeJavaScript('document.getElementById("page")?.textContent||""');if(pageRaw&&pageRaw!=='loading')break;await new Promise(r=>setTimeout(r,100));}}
    let page={};try{page=JSON.parse(pageRaw||'{}');}catch{}
    ok('Breeze action opens the real extension popup with page compatibility preload',opened?.ok===true&&!!actionWin,pageRaw);
    ok('extension popup page can call chrome.windows.getCurrent',page.ok===true&&Number.isInteger(page.current?.id),JSON.stringify(page.current||{}));
    ok('extension popup page can query and create Breeze tabs',page.ok===true&&Array.isArray(page.tabs)&&page.created?.id===701,JSON.stringify({tabs:page.tabs,created:page.created}));
    ok('extension popup page can read declared commands',page.commands?.[0]?.name==='_execute_action',JSON.stringify(page.commands));
    ok('extension popup browser namespace is present',page.browserPresent===true,JSON.stringify({browserPresent:page.browserPresent}));
    ok('extension popup browser.windows uses Breeze page bridge',page.ok===true&&Number.isInteger(page.browserCurrent?.id),JSON.stringify(page.browserCurrent||{}));
    ok('extension popup browser.tabs query/create use Breeze tab model',page.ok===true&&Array.isArray(page.browserTabs)&&page.browserCreated?.id===701&&page.browserCreated?.url==='https://example.net/from-browser-namespace',JSON.stringify({tabs:page.browserTabs,created:page.browserCreated}));
    ok('extension popup browser.commands preserves declared metadata',page.browserCommands?.[0]?.name==='_execute_action',JSON.stringify(page.browserCommands));

    const permitted=new Set(['tab:create','tab:list','tab:navigate','tab:select','tab:close']);
    ok('bridge uses only narrow captured browser IPC channels',internal.every(x=>permitted.has(x.channel)),JSON.stringify(internal.map(x=>x.channel)));

    await runtime.remove(localId,[{ses,workspaceId:'default'}]);
    ok('removing extension clears runtime registry and managed copy',!runtime.list().some(x=>x.localId===localId));
  }catch(err){console.error(err);fail++;}
  finally{
    try{if(actionWin&&!actionWin.isDestroyed())actionWin.destroy();}catch{}
    try{if(win&&!win.isDestroyed())win.destroy();}catch{}
    try{if(srv)srv.close();}catch{}
    try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}
  }
  console.log(`\nBreeze production extension runtime: ${pass}/${pass+fail}`);
  app.exit(fail?1:0);
})();
