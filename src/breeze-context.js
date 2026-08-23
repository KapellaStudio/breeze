/* Breeze local context UI: real Reading Queue, Notes and workspace Snapshots. */
(function(){
  'use strict';
  const S=window.__BREEZE_SHELL__;
  if(!S||!S.isShell||typeof S.listQueue!=='function')return;
  const $=s=>document.querySelector(s);
  const root=document.documentElement;
  let activeTab=null;
  let activeWorkspace='default';

  const style=document.createElement('style');
  style.textContent=`
    .ctxTop{display:flex;gap:7px;margin:0 0 12px}.ctxTop .btn{flex:1}.ctxEmpty{padding:28px 10px;text-align:center;color:var(--tx3);font-size:12px;line-height:1.55}.ctxMeta{font-size:10.5px;color:var(--tx3);margin-top:4px}.ctxActions{display:flex;gap:5px;margin-top:8px}.ctxActions button{padding:4px 7px;border:1px solid var(--line);border-radius:7px;font-size:10px;color:var(--tx2)}.ctxActions button:hover{background:var(--bg3);color:var(--tx1)}.ctxDanger:hover{color:var(--bad)!important}.noteText{white-space:pre-wrap;word-break:break-word}.snapReal{display:block;width:100%;text-align:left}.snapReal h4{display:flex;gap:6px;align-items:center}.snapReal h4 .auto{font-size:9px;color:var(--tx3);font-weight:500}.ctxPrivate{color:var(--warn)}
  `;
  document.head.append(style);

  function host(url){try{return new URL(url).hostname.replace(/^www\./,'');}catch{return 'page';}}
  function ago(ts){const d=Math.max(0,Date.now()-Number(ts||0)),m=Math.floor(d/60000);if(m<1)return'now';if(m<60)return m+'m ago';const h=Math.floor(m/60);if(h<24)return h+'h ago';const days=Math.floor(h/24);return days<14?days+'d ago':new Date(ts).toLocaleDateString();}
  function safeActive(){return activeTab&&/^https?:\/\//i.test(activeTab.url||'');}
  async function privateIntent(kind){
    if(!activeTab?.private)return true;
    return confirm(`${kind} is an explicit save. It will remain after this Private session closes. Continue?`);
  }

  S.listTabs().then(tabs=>{activeTab=(tabs||[]).find(t=>t.active)||null;if(activeTab&&!activeTab.private)activeWorkspace=String(activeTab.workspace||'default');renderAll();}).catch(()=>renderAll());
  S.on('tab:update',st=>{
    if(!st?.active)return;
    activeTab=st;
    if(!st.private)activeWorkspace=String(st.workspace||'default');
    renderAll();
  });

  /* ── Reading Queue ──────────────────────────────────────────────────── */
  async function addCurrentToQueue(){
    if(!safeActive()){if(typeof toast==='function')toast('Open a web page before adding it to the queue');return;}
    if(!(await privateIntent('Adding this page to the Reading Queue')))return;
    const r=await S.addQueue({url:activeTab.url,title:activeTab.title||host(activeTab.url),source:host(activeTab.url),workspace:activeWorkspace});
    if(r?.error){if(typeof toast==='function')toast(r.error);return;}
    if(typeof toast==='function')toast(r.existing?'Moved to the top of your queue':'Added to Reading Queue');
    renderQueue();
  }
  async function openQueueItem(item){
    const ws=await S.getWorkspace(item.workspace).catch(()=>null);
    await S.newTab({url:item.url,workspaceId:item.workspace,sealed:!!ws?.sealed});
  }
  async function renderQueue(){
    const panel=$('aside[data-p="queue"]');if(!panel)return;
    const body=panel.querySelector('.pBody');const count=panel.querySelector('.pHead .n');if(!body)return;
    const rows=await S.listQueue(activeWorkspace).catch(()=>[]);if(count)count.textContent=String(rows.length);
    const frag=document.createDocumentFragment();
    const top=document.createElement('div');top.className='ctxTop';
    const add=document.createElement('button');add.className='btn';add.textContent='+ Add current page';add.onclick=addCurrentToQueue;
    const clear=document.createElement('button');clear.className='btn ghost';clear.textContent='Clear queue';clear.disabled=!rows.length;clear.onclick=async()=>{if(rows.length&&confirm('Clear this workspace’s Reading Queue?')){await S.clearQueue(activeWorkspace);renderQueue();}};
    top.append(add,clear);frag.append(top);
    const stat=document.createElement('div');stat.className='pStat';stat.textContent=rows.length?`${rows.length} page${rows.length===1?'':'s'} saved locally in this workspace`:'Save pages here instead of keeping them open as tabs';frag.append(stat);
    if(!rows.length){const empty=document.createElement('div');empty.className='ctxEmpty';empty.textContent='Your queue is empty. Add the page you are on, then close the tab without losing what you meant to read.';frag.append(empty);}
    rows.forEach((q,i)=>{
      const item=document.createElement('div');item.className='qItem'+(i===0?' up':'');
      const h=document.createElement('h4');h.textContent=q.title||host(q.url);
      const meta=document.createElement('div');meta.className='m';meta.textContent=host(q.url)+' · '+ago(q.addedAt);
      const actions=document.createElement('div');actions.className='ctxActions';
      const open=document.createElement('button');open.textContent='Open';open.onclick=()=>openQueueItem(q);
      const topb=document.createElement('button');topb.textContent='Move to top';topb.disabled=i===0;topb.onclick=async()=>{await S.moveQueueTop(q.id);renderQueue();};
      const rm=document.createElement('button');rm.className='ctxDanger';rm.textContent='Remove';rm.onclick=async()=>{await S.removeQueue(q.id);renderQueue();};
      actions.append(open,topb,rm);item.append(h,meta,actions);frag.append(item);
    });
    body.replaceChildren(frag);
  }

  /* ── Notes ───────────────────────────────────────────────────────────── */
  async function addCurrentNote(){
    if(!(await privateIntent('Saving a note')))return;
    const value=prompt('Add a note for this page');if(!value||!value.trim())return;
    const r=await S.addNote({url:safeActive()?activeTab.url:'',title:activeTab?.title||'Breeze',workspace:activeWorkspace,body:value.trim(),kind:'note'});
    if(r?.error){if(typeof toast==='function')toast(r.error);return;}if(typeof toast==='function')toast('Note saved locally');renderNotes();
  }
  async function renderNotes(){
    const panel=$('aside[data-p="notes"]');if(!panel)return;
    const body=$('#notesBody')||panel.querySelector('.pBody');if(!body)return;
    const rows=await S.listNotes(activeWorkspace).catch(()=>[]);
    const frag=document.createDocumentFragment();
    const top=document.createElement('div');top.className='ctxTop';const add=document.createElement('button');add.className='btn';add.textContent='+ Add note for current page';add.onclick=addCurrentNote;top.append(add);frag.append(top);
    if(!rows.length){const empty=document.createElement('div');empty.className='ctxEmpty';empty.textContent='No notes in this workspace yet. Notes are local and stay attached to the page title and URL you saved them from.';frag.append(empty);}
    rows.forEach(n=>{
      const card=document.createElement('div');card.className='note';card.style.marginBottom='8px';
      const ctx=document.createElement('div');ctx.className='ctx';ctx.textContent=(n.kind==='highlight'?'Highlight on ':'On ')+(n.title||host(n.url));
      const p=document.createElement('p');p.className='noteText';p.textContent=n.body;
      const meta=document.createElement('div');meta.className='ctxMeta';meta.textContent=(n.url?host(n.url)+' · ':'')+ago(n.updatedAt||n.createdAt);
      const acts=document.createElement('div');acts.className='ctxActions';
      if(n.url){const open=document.createElement('button');open.textContent='Open page';open.onclick=async()=>{const ws=await S.getWorkspace(n.workspace).catch(()=>null);S.newTab({url:n.url,workspaceId:n.workspace,sealed:!!ws?.sealed});};acts.append(open);}
      const edit=document.createElement('button');edit.textContent='Edit';edit.onclick=async()=>{const value=prompt('Edit note',n.body);if(value&&value.trim()){await S.updateNote(n.id,value.trim());renderNotes();}};
      const rm=document.createElement('button');rm.className='ctxDanger';rm.textContent='Delete';rm.onclick=async()=>{if(confirm('Delete this note?')){await S.removeNote(n.id);renderNotes();}};acts.append(edit,rm);
      card.append(ctx,p,meta,acts);frag.append(card);
    });
    body.replaceChildren(frag);
  }

  /* ── Workspace snapshots ─────────────────────────────────────────────── */
  async function saveCurrentSnapshot(label='',automatic=false){
    const tabs=await S.listTabs().catch(()=>[]);
    const scoped=(tabs||[]).filter(t=>!t.private&&String(t.workspace||'default')===activeWorkspace);
    const r=await S.saveSnapshot({workspace:activeWorkspace,label,tabs:scoped});
    if(r?.error){if(!automatic&&typeof toast==='function')toast(r.error);return r;}
    if(!automatic&&typeof toast==='function')toast(r.unchanged?'Snapshot already current':'Workspace snapshot saved');
    if(!automatic)renderSnapshots();return r;
  }
  async function restoreSnapshot(snap){
    if(!snap?.tabs?.length)return;
    if(!confirm(`Open ${snap.tabs.length} saved tab${snap.tabs.length===1?'':'s'} from this snapshot? Existing tabs will stay open.`))return;
    for(const t of snap.tabs)await S.newTab({url:t.url,workspaceId:t.workspace,sealed:!!t.sealed});
    if(typeof toast==='function')toast('Snapshot restored as new tabs');
  }
  async function renderSnapshots(){
    const panel=$('aside[data-p="snapshots"]');if(!panel)return;
    const body=panel.querySelector('.pBody');const badge=panel.querySelector('.pHead .n');if(!body)return;
    const rows=await S.listSnapshots(activeWorkspace).catch(()=>[]);if(badge)badge.textContent=String(rows.length);
    const frag=document.createDocumentFragment();
    const top=document.createElement('div');top.className='ctxTop';const save=document.createElement('button');save.className='btn';save.textContent='Save snapshot now';save.onclick=()=>saveCurrentSnapshot('Manual snapshot',false);top.append(save);frag.append(top);
    const stat=document.createElement('div');stat.className='pStat';stat.textContent='Private tabs and local-file paths are never included in automatic snapshots';frag.append(stat);
    if(!rows.length){const empty=document.createElement('div');empty.className='ctxEmpty';empty.textContent='No snapshots yet. Breeze will capture restorable web tabs in this workspace every five minutes while the app is open.';frag.append(empty);}
    const wrap=document.createElement('div');wrap.className='snap';
    rows.forEach(s=>{
      const card=document.createElement('div');card.className='snapItem snapReal';
      const h=document.createElement('h4');h.textContent=new Date(s.createdAt).toLocaleString();
      if(s.label){const label=document.createElement('span');label.className='auto';label.textContent=s.label;h.append(label);}
      const m=document.createElement('div');m.className='m';m.textContent=`${s.tabs.length} restorable web tab${s.tabs.length===1?'':'s'}`;
      const acts=document.createElement('div');acts.className='ctxActions';const restore=document.createElement('button');restore.textContent='Restore';restore.onclick=()=>restoreSnapshot(s);const rm=document.createElement('button');rm.className='ctxDanger';rm.textContent='Delete';rm.onclick=async()=>{await S.removeSnapshot(s.id);renderSnapshots();};acts.append(restore,rm);card.append(h,m,acts);wrap.append(card);
    });
    frag.append(wrap);body.replaceChildren(frag);
  }

  function renderAll(){renderQueue();renderNotes();renderSnapshots();}
  const previousOpen=window.openPanel;
  if(typeof previousOpen==='function')window.openPanel=function(name){const result=previousOpen.apply(this,arguments);if(name==='queue')renderQueue();if(name==='notes')renderNotes();if(name==='snapshots')renderSnapshots();return result;};
  document.addEventListener('click',e=>{const b=e.target.closest('[data-panel]');if(!b)return;setTimeout(()=>{if(b.dataset.panel==='queue')renderQueue();if(b.dataset.panel==='notes')renderNotes();if(b.dataset.panel==='snapshots')renderSnapshots();},0);},true);

  // Real five-minute snapshots replace the prototype claim. The storage layer
  // deduplicates unchanged tab sets, so an idle workspace does not grow forever.
  setInterval(()=>{if(!activeTab?.private)saveCurrentSnapshot('Automatic snapshot',true);},5*60*1000);
})();
