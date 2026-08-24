/* Breeze native-search action bindings.
   Search data is real in breeze-shell-adapter.js; this module makes the result
   interactions real too and replaces the prototype library/related sidebar. */
(function(){
  'use strict';
  const S=window.__BREEZE_SHELL__;
  if(!S||!S.isShell)return;
  const $=s=>document.querySelector(s);
  const $$=s=>[...document.querySelectorAll(s)];
  let processing=false;

  function host(url){try{return new URL(url).hostname.replace(/^www\./,'');}catch{return'';}}
  async function activeContext(){
    const tabs=await S.listTabs().catch(()=>[]);const active=(tabs||[]).find(t=>t.active);
    return {id:active?.id??null,workspace:active&&!active.private?String(active.workspace||'default'):'default',private:!!active?.private};
  }
  async function openResult(r){
    if(!r?.url)return;const ctx=await activeContext();
    try{if(typeof closeAll==='function')closeAll();}catch{}
    if(ctx.id!=null)await S.navigate(ctx.id,r.url);else await S.newTab({url:r.url,workspaceId:ctx.workspace});
    await S.setInternalView(false).catch(()=>{});
    try{if(typeof setView==='function')setView('browse');document.documentElement.dataset.kind='page';}catch{}
  }
  async function queueResult(r){
    if(!r?.url)return;const ctx=await activeContext();
    if(ctx.private&&!confirm('Saving this search result will remain in your Reading Queue after Private browsing closes. Continue?'))return;
    const x=await S.addQueue({url:r.url,title:r.title||host(r.url),source:host(r.url),workspace:ctx.workspace});
    if(typeof toast==='function')toast(x?.error|| (x?.existing?'Moved to the top of your queue':'Added to Reading Queue'));
    if(!x?.error){r.queued=true;postProcessResults();}
  }
  function matchingRow(node,index){
    try{
      const title=node.querySelector('.srTitle')?.textContent||'';const dom=node.querySelector('.srDom b')?.textContent||'';
      return (typeof SR_DATA!=='undefined'&&SR_DATA.find(r=>r.title===title&&(!dom||r.dom===dom))) || (typeof SR_DATA!=='undefined'?SR_DATA[index]:null);
    }catch{return null;}
  }
  function postProcessResults(){
    if(processing)return;processing=true;
    try{
      $$('#srList .sr').forEach((node,index)=>{
        const r=matchingRow(node,index);if(!r?.url)return;
        node.onclick=e=>{if(e.target.closest('.srAct'))return;openResult(r);};
        const acts=[...node.querySelectorAll('.srAct')];
        acts.forEach(btn=>{
          const label=btn.textContent.trim();
          if(label==='Glance'||label==='Split'){btn.remove();return;}
          if(label==='Queue'){btn.onclick=e=>{e.preventDefault();e.stopPropagation();queueResult(r);};btn.textContent=r.queued?'Queued':'Queue';btn.disabled=!!r.queued;}
        });
      });
    }finally{processing=false;}
  }

  async function renderLibraryMatches(){
    const hostEl=$('#srMine');if(!hostEl)return;
    const query=String($('#srQ')?.textContent||'').trim().toLowerCase();
    const ctx=await activeContext();
    const [bookmarks,queue,notes]=await Promise.all([S.bookmarkList('').catch(()=>[]),S.listQueue(ctx.workspace).catch(()=>[]),S.listNotes(ctx.workspace).catch(()=>[])]);
    const rows=[];const seen=new Set();
    const add=(type,title,url,sub)=>{const key=type+'|'+url+'|'+title;if(seen.has(key))return;const hay=(title+' '+url+' '+sub).toLowerCase();if(query&&!hay.includes(query))return;seen.add(key);rows.push({type,title,url,sub});};
    (bookmarks||[]).forEach(x=>add('Bookmark',x.title||host(x.url),x.url,host(x.url)));
    (queue||[]).forEach(x=>add('Queue',x.title||host(x.url),x.url,host(x.url)));
    (notes||[]).forEach(x=>add('Note',x.title||'Saved note',x.url||'',String(x.body||'').slice(0,90)));
    hostEl.replaceChildren();
    if(!rows.length){const empty=document.createElement('div');empty.style.cssText='font-size:11px;color:var(--tx3);line-height:1.5';empty.textContent='No matching bookmarks, queue items or notes.';hostEl.append(empty);return;}
    rows.slice(0,8).forEach(x=>{const b=document.createElement('button');b.className='srMineRow';const t=document.createElement('span');t.className='t';t.textContent=x.title;const s=document.createElement('span');s.className='s';s.textContent=x.type+' · '+(x.sub||host(x.url));b.append(t,s);b.disabled=!x.url;b.onclick=()=>openResult({url:x.url,title:x.title});hostEl.append(b);});
  }
  function correctSearchCopy(){
    const boxes=$$('.srAside .srBox');if(boxes[1])boxes[1].style.display='none';
    const foot=$('.srFoot');if(foot)foot.textContent='Results come from your chosen search provider. Tracking parameters are stripped when Breeze navigates. If Page Signals are enabled, destination measurements are fetched separately. A Breeze account is not required.';
    const clean=$('.srClean');if(clean)clean.textContent='No sponsored Breeze slots';
  }
  function refresh(){postProcessResults();renderLibraryMatches();correctSearchCopy();}

  const list=$('#srList');if(list)new MutationObserver(()=>setTimeout(refresh,0)).observe(list,{childList:true,subtree:true});
  const original=window.runSearch;
  if(typeof original==='function')window.runSearch=function(){const r=original.apply(this,arguments);Promise.resolve(r).finally(()=>setTimeout(refresh,0));return r;};
  refresh();
})();
