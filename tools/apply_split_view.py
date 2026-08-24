#!/usr/bin/env python3
from pathlib import Path
import json

ROOT=Path(__file__).resolve().parents[1]

def must_replace(path,old,new,count=1):
    p=ROOT/path
    s=p.read_text(encoding='utf-8')
    found=s.count(old)
    if found!=count:
        raise SystemExit(f'{path}: expected {count} copies, found {found}: {old[:90]!r}')
    p.write_text(s.replace(old,new),encoding='utf-8',newline='\n')

# ── main process: two real native views, stable pane positions, focused target
must_replace('shell/main.js',
"const documents = require('./documents');\n",
"const documents = require('./documents');\nconst { SplitState } = require('./split');\n")
must_replace('shell/main.js',
"let tabSleepTimer = null;\n",
"let tabSleepTimer = null;\nconst splitView = new SplitState();\nconst SPLIT_GAP = 10;\n")
must_replace('shell/main.js',
"  const wc=view.webContents;\n\n  wc.setWindowOpenHandler",
"  const wc=view.webContents;\n  wc.on('focus', () => {\n    if(tabs.has(id) && splitView.active && splitView.has(id) && activeTabId!==id) setActiveTab(id,{fromPane:true});\n  });\n\n  wc.setWindowOpenHandler")
must_replace('shell/main.js',
"  if(id===activeTabId)return'active tab';\n",
"  if(id===activeTabId)return'active tab';\n  if(splitView.active&&splitView.has(id))return'split pane';\n")
must_replace('shell/main.js',
"    if(id===activeTabId||t.sleeping||t.waking)continue;\n",
"    if(id===activeTabId||splitView.has(id)||t.sleeping||t.waking)continue;\n")
must_replace('shell/main.js',
"    sleeping:!!t.sleeping, waking:!!t.waking, lastActiveAt:Number(t.lastActiveAt||0),\n    active:id===activeTabId\n",
"    sleeping:!!t.sleeping, waking:!!t.waking, lastActiveAt:Number(t.lastActiveAt||0),\n    splitRole:splitView.active?(id===splitView.leftTabId?'left':id===splitView.rightTabId?'right':null):null,\n    splitFocused:splitView.active&&id===splitView.focusedTabId,\n    active:id===activeTabId\n")

old_set="""function setActiveTab(id){
  if (!tabs.has(id)) return;
  const previous=tabs.get(activeTabId);
  if(previous && activeTabId!==id)previous.lastActiveAt=Date.now();
  activeTabId=id;
  const target=tabs.get(id);target.lastActiveAt=Date.now();
  if(target.sleeping)wakeTab(id).catch(()=>{});
  for (const [tid, t] of tabs){
    if(t.view)t.view.setVisible(!internalView && tid===id);
  }
  layout();
  send('tab:update',tabState(id));
  scheduleStateSave();
}
"""
new_set="""function splitEligible(id){
  const t=tabs.get(Number(id));
  return !!t && !t.private && t.kind==='page' && !t.localPdfPath;
}
function splitSnapshot(){return splitView.snapshot();}
function sendSplitState(){
  send('split:update',splitSnapshot());
  const ids=new Set([activeTabId,splitView.leftTabId,splitView.rightTabId]);
  for(const id of ids)if(id&&tabs.has(id))send('tab:update',tabState(id));
}

function setActiveTab(id,{fromPane=false}={}){
  id=Number(id);
  if (!tabs.has(id)) return;
  const previous=tabs.get(activeTabId);
  if(previous && activeTabId!==id)previous.lastActiveAt=Date.now();
  if(splitView.active){
    if(splitView.has(id)) splitView.focus(id);
    else if(splitEligible(id)) splitView.replaceFocused(id,splitEligible);
    else splitView.close();
  }
  activeTabId=id;
  const target=tabs.get(id);target.lastActiveAt=Date.now();
  if(target.sleeping)wakeTab(id).catch(()=>{});
  layout();
  send('tab:update',tabState(id));
  sendSplitState();
  scheduleStateSave();
}
"""
must_replace('shell/main.js',old_set,new_set)

old_close="""function closeTab(id){
  const t = tabs.get(id); if (!t) return;
  t.closing=true;
  if (!t.private){
    const url=cleanUrl(currentTabUrl(t));
    if (url){
      recentlyClosed.push({url,workspaceId:t.workspace,sealed:!!t.sealed,closedAt:Date.now()});
      if (recentlyClosed.length > 20) recentlyClosed.shift();
    }
  }
  const wc=liveWebContents(t);
  if(t.view){try{win.contentView.removeChildView(t.view);}catch{}}
  if(wc){try{wc.close();}catch{}}
  t.view=null;
  tabs.delete(id);
  if (activeTabId === id){
    const next = [...tabs.keys()].pop();
    if (next) setActiveTab(next); else activeTabId = null;
  }
  send('tab:closed', { id });
  scheduleStateSave();
  if (t.private && ![...tabs.values()].some(x => x.private)) purgePrivateSessions().catch(()=>{});
}
"""
new_close="""function closeTab(id){
  id=Number(id);
  const t = tabs.get(id); if (!t) return;
  t.closing=true;
  const splitResult=splitView.tabClosed(id);
  if (!t.private){
    const url=cleanUrl(currentTabUrl(t));
    if (url){
      recentlyClosed.push({url,workspaceId:t.workspace,sealed:!!t.sealed,closedAt:Date.now()});
      if (recentlyClosed.length > 20) recentlyClosed.shift();
    }
  }
  const wc=liveWebContents(t);
  if(t.view){try{win.contentView.removeChildView(t.view);}catch{}}
  if(wc){try{wc.close();}catch{}}
  t.view=null;
  tabs.delete(id);
  if (activeTabId === id){
    const preferred=splitResult.collapsed&&tabs.has(splitResult.survivorTabId)?splitResult.survivorTabId:null;
    const next = preferred || [...tabs.keys()].pop();
    if (next) setActiveTab(next); else {activeTabId = null;splitView.close();layout();sendSplitState();}
  } else {
    layout();sendSplitState();
  }
  send('tab:closed', { id });
  scheduleStateSave();
  if (t.private && ![...tabs.values()].some(x => x.private)) purgePrivateSessions().catch(()=>{});
}
"""
must_replace('shell/main.js',old_close,new_close)

old_layout="""function layout(){
  if (!win) return;
  const [w, h] = win.getContentSize();
  const x = CHROME.side, y = CHROME.top;
  const width  = Math.max(0, w - CHROME.side - CHROME.panel);
  const height = Math.max(0, h - CHROME.top);
  for (const [id, t] of tabs){
    if(!t.view)continue;
    const live = !internalView && id === activeTabId;
    t.view.setVisible(live);
    t.view.setBounds(live ? { x, y, width, height } : { x: 0, y: 0, width: 0, height: 0 });
  }
}
"""
new_layout="""function layout(){
  if (!win) return;
  const [w, h] = win.getContentSize();
  const x = CHROME.side, y = CHROME.top;
  const width  = Math.max(0, w - CHROME.side - CHROME.panel);
  const height = Math.max(0, h - CHROME.top);
  const split=splitView.snapshot();
  const splitLive=!internalView&&split.active&&tabs.has(split.leftTabId)&&tabs.has(split.rightTabId);
  const usable=Math.max(0,width-(splitLive?SPLIT_GAP:0));
  const leftWidth=splitLive?Math.floor(usable*split.ratio):width;
  const rightWidth=splitLive?Math.max(0,usable-leftWidth):0;
  for (const [id, t] of tabs){
    if(!t.view)continue;
    let live=false,bounds={x:0,y:0,width:0,height:0};
    if(splitLive&&id===split.leftTabId){live=true;bounds={x,y,width:leftWidth,height};}
    else if(splitLive&&id===split.rightTabId){live=true;bounds={x:x+leftWidth+SPLIT_GAP,y,width:rightWidth,height};}
    else if(!splitLive&&!internalView&&id===activeTabId){live=true;bounds={x,y,width,height};}
    t.view.setVisible(live);
    t.view.setBounds(bounds);
  }
}
"""
must_replace('shell/main.js',old_layout,new_layout)

old_snapshot="""function stateSnapshot(){
  return {
    version:1, activeTabId, savedAt:Date.now(),
    tabs:[...tabs.entries()].filter(([,t]) => !t.private).map(([id,t]) => ({
      id, url:cleanUrl(currentTabUrl(t)), workspaceId:t.workspace, sealed:!!t.sealed,
      active:id===activeTabId
    })).filter(t => t.url)
  };
}
"""
new_snapshot="""function stateSnapshot(){
  const persistable=[...tabs.entries()].filter(([,t])=>!t.private).map(([id,t])=>({
    id,url:cleanUrl(currentTabUrl(t)),workspaceId:t.workspace,sealed:!!t.sealed,active:id===activeTabId
  })).filter(t=>t.url);
  const ids=persistable.map(t=>t.id);
  return {
    version:2, activeTabId, savedAt:Date.now(), split:splitView.persisted(ids),
    tabs:persistable
  };
}
"""
must_replace('shell/main.js',old_snapshot,new_snapshot)

old_restore="""function restoreSavedTabs(){
  const st = browserState.read();
  const saved = Array.isArray(st?.tabs) ? st.tabs.filter(t => cleanUrl(t.url)) : [];
  if (!saved.length){ createTab({}); return; }
  let active = null;
  for (const t of saved){
    const id=createTab({ url:t.url, workspaceId:String(t.workspaceId||'default'), sealed:!!t.sealed });
    if (t.active) active=id;
  }
  if (active != null) setActiveTab(active);
}
"""
new_restore="""function restoreSavedTabs(){
  const st = browserState.read();
  const saved = Array.isArray(st?.tabs) ? st.tabs.filter(t => cleanUrl(t.url)) : [];
  if (!saved.length){ createTab({}); return; }
  let active = null;const created=[];
  for (const t of saved){
    const id=createTab({ url:t.url, workspaceId:String(t.workspaceId||'default'), sealed:!!t.sealed });
    created.push(id);if (t.active) active=id;
  }
  const restored=splitView.restore(st?.split,created,splitEligible);
  const focus=restored.active?restored.focusedTabId:(active||restored.focusedTabId);
  if (focus != null) setActiveTab(focus);
  else if(active!=null)setActiveTab(active);
  layout();sendSplitState();
}
"""
must_replace('shell/main.js',old_restore,new_restore)

must_replace('shell/main.js',
"reg('tab:wake',  id => wakeTab(Number(id)));\n",
"reg('tab:wake',  id => wakeTab(Number(id)));\nreg('split:state', () => splitSnapshot());\nreg('split:open', async secondaryId => {\n  const primary=activeTabId,secondary=Number(secondaryId);\n  if(!splitEligible(primary)||!splitEligible(secondary))return{error:'Split View works with regular web tabs'};\n  if(primary===secondary)return{error:'choose a different tab'};\n  const pt=tabs.get(primary),st=tabs.get(secondary);\n  if(pt.sleeping||pt.waking)await wakeTab(primary);\n  if(st.sleeping||st.waking)await wakeTab(secondary);\n  const result=splitView.open(primary,secondary,splitEligible);\n  if(result.error)return result;\n  activeTabId=primary;layout();sendSplitState();scheduleStateSave();return splitSnapshot();\n});\nreg('split:close', () => {const r=splitView.close();layout();sendSplitState();scheduleStateSave();return r;});\nreg('split:swap', () => {const r=splitView.swap();if(!r.error){layout();sendSplitState();scheduleStateSave();}return r;});\nreg('split:ratio', value => {const r=splitView.setRatio(value);layout();sendSplitState();scheduleStateSave();return r;});\n")

# ── trusted bridge
must_replace('shell/preload.js',
"const EVENTS = ['tab:update','tab:loading','tab:closed','tab:favicon','tab:error','win:state','download:update','download:refresh','permission:request','display:request'];",
"const EVENTS = ['tab:update','tab:loading','tab:closed','tab:favicon','tab:error','split:update','win:state','download:update','download:refresh','permission:request','display:request'];")
must_replace('shell/preload.js',
"  wakeTab: id => call('tab:wake', id),\n",
"  wakeTab: id => call('tab:wake', id),\n  splitState: () => call('split:state'),\n  openSplit: secondaryId => call('split:open', secondaryId),\n  closeSplit: () => call('split:close'),\n  swapSplit: () => call('split:swap'),\n  setSplitRatio: value => call('split:ratio', value),\n")

# ── package state test
pkg_path=ROOT/'shell/package.json'
pkg=json.loads(pkg_path.read_text(encoding='utf-8'))
pkg['scripts']['splittest']='node splittest.js'
pkg_path.write_text(json.dumps(pkg,indent=2,ensure_ascii=False)+'\n',encoding='utf-8',newline='\n')

# ── packaging includes the state engine
for file in ['shell/electron-builder.yml','shell/electron-builder.production.yml']:
    must_replace(file,"  - omnibox.js\n  - main.js\n","  - omnibox.js\n  - split.js\n  - main.js\n")

# ── browser-core packaging contract
must_replace('shell/browsercoretest.js',
"&&/documents\\.js/.test(pack)&&/pdf-preload\\.js/.test(pack)&&/pdf-viewer\\.js/.test(pack));",
"&&/documents\\.js/.test(pack)&&/split\\.js/.test(pack)&&/pdf-preload\\.js/.test(pack)&&/pdf-viewer\\.js/.test(pack));")

# ── integration: prove two independent native views, stable focus and sleep guard
must_replace('shell/integration.js',
"    ok('unsupported split control is hidden', await exec(`getComputedStyle(document.querySelector('#splitBtn')).display === 'none'`));\n",
"    ok('real Split View bridge is present', await exec(`typeof window.__BREEZE_SHELL__.openSplit==='function'&&typeof window.__BREEZE_SHELL__.setSplitRatio==='function'`));\n    ok('Split View control is live', await exec(`getComputedStyle(document.querySelector('#splitBtn')).display !== 'none' && document.querySelector('#splitBtn').dataset.realSplit==='1'`));\n")
needle="""    await exec(`window.__BREEZE_SHELL__.back(${id})`);
    await wait(1000);
    ok('back returns to previous real page', /Alpha Site/.test(await titles()));

"""
insert=needle+"""    /* Split View must be two native Chromium views, not cloned browser chrome. */
    const splitId=await exec(`window.__BREEZE_SHELL__.newTab({url:${JSON.stringify(site('beta'))}})`);
    await wait(850);
    await exec(`window.__BREEZE_SHELL__.selectTab(${id})`);await wait(180);
    const openedSplit=await exec(`window.__BREEZE_SHELL__.openSplit(${splitId})`);await wait(260);
    ok('Split View opens two stable pane ids', openedSplit?.active===true&&openedSplit?.leftTabId===id&&openedSplit?.rightTabId===splitId);
    let paneBounds=win.contentView.children.map(v=>v.getBounds()).filter(b=>b.width>0&&b.height>0).sort((a,b)=>a.x-b.x);
    ok('Split View renders two genuine native WebContentsViews', paneBounds.length===2&&paneBounds[0].x+paneBounds[0].width<paneBounds[1].x, JSON.stringify(paneBounds));
    const blockedSleep=await exec(`window.__BREEZE_SHELL__.sleepTab(${splitId})`);
    ok('visible split pane cannot be put to sleep', blockedSleep?.error==='split pane', blockedSleep?.error||'');
    const resized=await exec(`window.__BREEZE_SHELL__.setSplitRatio(.64)`);await wait(180);
    paneBounds=win.contentView.children.map(v=>v.getBounds()).filter(b=>b.width>0&&b.height>0).sort((a,b)=>a.x-b.x);
    const measuredRatio=paneBounds.length===2?paneBounds[0].width/(paneBounds[0].width+paneBounds[1].width):0;
    ok('Split divider resizes real renderer bounds', resized?.ratio===.64&&measuredRatio>.62&&measuredRatio<.66, measuredRatio.toFixed(3));
    await exec(`window.__BREEZE_SHELL__.selectTab(${splitId})`);await wait(160);
    const focusedSplit=await exec(`window.__BREEZE_SHELL__.splitState()`);
    ok('focus moves to right pane without swapping sides', focusedSplit?.leftTabId===id&&focusedSplit?.rightTabId===splitId&&focusedSplit?.focusedTabId===splitId);
    await exec(`window.__BREEZE_SHELL__.closeSplit()`);await wait(180);
    paneBounds=win.contentView.children.map(v=>v.getBounds()).filter(b=>b.width>0&&b.height>0);
    ok('closing Split View returns to one native page', paneBounds.length===1);
    await exec(`window.__BREEZE_SHELL__.closeTab(${splitId});window.__BREEZE_SHELL__.selectTab(${id})`);await wait(220);

"""
must_replace('shell/integration.js',needle,insert)

# ── verification includes unit policy and Split View source syntax
must_replace('.github/workflows/verify.yml',
"            src/breeze-omni.js; do node --check \"$f\"; done\n",
"            src/breeze-omni.js src/breeze-split-ui.js; do node --check \"$f\"; done\n")
must_replace('.github/workflows/verify.yml',
"          npm run omniboxtest\n",
"          npm run omniboxtest\n          npm run splittest\n")

print('Applied native Split View integration refactor.')
