/* Breeze packaged New Tab bindings.
   Replaces prototype quick links, weather and Continue cards with real local
   history, bookmarks, queue, downloads and snapshots. */
(function(){
  'use strict';
  const S=window.__BREEZE_SHELL__;
  if(!S||!S.isShell)return;
  const $=s=>document.querySelector(s);
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  let activeWorkspace='default';
  let activePrivate=false;
  let refreshTimer=null;

  const style=document.createElement('style');
  style.textContent=`
    [data-shell="1"] .homebar .wx{display:none!important}
    [data-private="1"] .links,[data-private="1"] .continue,[data-private="1"] #queueHome{display:none!important}
    .homeEmpty{grid-column:1/-1;padding:18px 16px;border:1px dashed var(--line);border-radius:var(--r-lg);font-size:12px;line-height:1.55;color:var(--tx3);text-align:center}
    .link .tile{overflow:hidden}.link .tile span{font-size:12px;font-weight:700}.card .kind{min-height:16px}.card .go{pointer-events:none}
  `;
  document.head.append(style);

  function host(url){try{return new URL(url).hostname.replace(/^www\./,'');}catch{return'';}}
  function age(ts){const d=Math.max(0,Date.now()-Number(ts||0)),m=Math.floor(d/60000);if(m<1)return'now';if(m<60)return`${m} min ago`;const h=Math.floor(m/60);if(h<24)return`${h} h ago`;const day=Math.floor(h/24);return day<14?`${day} d ago`:new Date(ts).toLocaleDateString();}
  function openUrl(url,workspace=activeWorkspace,sealed=false){
    if(!/^https?:\/\//i.test(String(url||'')))return;
    S.newTab({url,workspaceId:workspace,sealed:!!sealed}).then(()=>{try{if(typeof setView==='function')setView('browse');}catch{}});
  }
  function iconFor(url){const h=host(url);return(h[0]||'B').toUpperCase();}

  async function collect(){
    const [history,bookmarks,queue,downloads,snapshots]=await Promise.all([
      S.historyList('').catch(()=>[]),S.bookmarkList('').catch(()=>[]),S.listQueue(activeWorkspace).catch(()=>[]),S.listDownloads().catch(()=>[]),S.listSnapshots(activeWorkspace).catch(()=>[])
    ]);
    return {history:Array.isArray(history)?history:[],bookmarks:Array.isArray(bookmarks)?bookmarks:[],queue:Array.isArray(queue)?queue:[],downloads:Array.isArray(downloads)?downloads:[],snapshots:Array.isArray(snapshots)?snapshots:[]};
  }

  function renderLinks(data){
    const wrap=$('.stage .links');if(!wrap)return;
    const seen=new Set();const candidates=[];
    for(const r of [...data.bookmarks,...data.history]){
      const h=host(r.url);if(!h||seen.has(h))continue;seen.add(h);candidates.push(r);if(candidates.length>=7)break;
    }
    wrap.replaceChildren();
    for(const r of candidates){
      const b=el('button','link');b.title=r.title||host(r.url);
      const tile=el('span','tile');tile.append(el('span',null,iconFor(r.url)));
      b.append(tile,document.createTextNode((r.title||host(r.url)).slice(0,12)));
      b.onclick=()=>openUrl(r.url,r.workspace||activeWorkspace,false);wrap.append(b);
    }
    if(!candidates.length){
      const note=el('div','homeEmpty','Your saved and recently visited sites will become quick links here. Nothing is preloaded or sponsored.');
      note.style.width='min(520px,100%)';wrap.append(note);
    }
  }

  async function renderQueueHome(data){
    const wrap=$('#queueHome');if(!wrap)return;wrap.replaceChildren();
    if(!data.queue.length){wrap.append(el('div','homeEmpty','Your Reading Queue is empty. Save a page from the Queue panel instead of leaving another tab open.'));return;}
    data.queue.slice(0,8).forEach((q,i)=>{
      const b=el('button','qhRow');const n=el('span','n',String(i+1));const m=el('span','m');m.append(el('span','t',q.title||host(q.url)),el('span','s',`${host(q.url)} · ${age(q.addedAt)}`));const arrow=el('span',null,'›');arrow.style.color='var(--tx3)';b.append(n,m,arrow);b.onclick=()=>openUrl(q.url,q.workspace||activeWorkspace,false);wrap.append(b);
    });
  }

  function card(kind,title,detail,action,label='Open →'){
    const b=el('button','card');const k=el('span','kind eyebrow',kind);const h=el('h3',null,title);const p=el('p',null,detail);const go=el('span','go',label);b.append(k,h,p,go);b.onclick=action;return b;
  }
  function renderContinue(data){
    const section=$('.stage .continue'),wrap=section?.querySelector('.cards');if(!section||!wrap)return;
    const cards=[];
    const q=data.queue[0];if(q)cards.push(card('Reading queue',q.title||host(q.url),`${host(q.url)} · ${data.queue.length-1} more queued`,()=>openUrl(q.url,q.workspace||activeWorkspace,false),'Open page →'));
    const recent=data.history.find(r=>!r.workspace||r.workspace===activeWorkspace)||data.history[0];
    if(recent)cards.push(card('Recent page',recent.title||host(recent.url),`${host(recent.url)} · ${age(recent.visitedAt)}`,()=>openUrl(recent.url,recent.workspace||activeWorkspace,false),'Return →'));
    const dl=data.downloads.find(d=>d.state==='completed'&&(!d.workspace||d.workspace===activeWorkspace))||data.downloads.find(d=>d.state==='completed');
    if(dl)cards.push(card('Download',dl.filename||'Downloaded file',`${host(dl.source||dl.url)||'Local file'} · ${age(dl.completedAt||dl.startedAt)}`,()=>S.openDownload(dl.id),'Open file →'));
    const snap=data.snapshots[0];if(snap)cards.push(card('Workspace snapshot',new Date(snap.createdAt).toLocaleString(),`${snap.tabs?.length||0} restorable web tab${snap.tabs?.length===1?'':'s'}`,()=>{try{if(typeof setView==='function')setView('browse');if(typeof openPanel==='function')openPanel('snapshots');}catch{}},'Review →'));
    if(cards.length<4){
      const saved=data.bookmarks.find(b=>!cards.some(c=>c.dataset?.url===b.url));
      if(saved)cards.push(card('Bookmark',saved.title||host(saved.url),host(saved.url),()=>openUrl(saved.url,saved.workspace||activeWorkspace,false),'Open →'));
    }
    wrap.replaceChildren();cards.slice(0,4).forEach(c=>wrap.append(c));
    if(!cards.length)wrap.append(el('div','homeEmpty','Your real local activity will appear here as you use Breeze — recent pages, queue items, completed downloads and workspace snapshots.'));
    const head=section.querySelector('.contHead .eyebrow');if(head)head.textContent='Continue';
  }

  async function refresh(){
    if(activePrivate)return;
    const data=await collect();renderLinks(data);renderQueueHome(data);renderContinue(data);
  }
  function schedule(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,60);}

  S.listTabs().then(t=>{const a=(t||[]).find(x=>x.active);if(a){activePrivate=!!a.private;if(!a.private)activeWorkspace=String(a.workspace||'default');}schedule();}).catch(schedule);
  S.on('tab:update',st=>{if(!st?.active)return;activePrivate=!!st.private;if(!st.private)activeWorkspace=String(st.workspace||'default');schedule();});
  S.on('download:update',schedule);S.on('download:refresh',schedule);
  document.addEventListener('click',e=>{if(e.target.closest('[data-panel="queue"],[data-panel="bookmarks"],[data-panel="snapshots"],#bookmarkActiveBtn'))setTimeout(schedule,100);},true);

  // The prototype's weather string was never backed by a weather service.
  const weather=$('.homebar .wx');if(weather)weather.remove();
  schedule();
})();
