/* Breeze browser-grade omnibox.
   One field handles URLs, web search, local browser data, engine shortcuts and
   keyboard navigation. Remote provider suggestions are optional and are
   suppressed by the trusted preload while Private browsing is active. */
(function(){
  'use strict';
  const S=window.__BREEZE_SHELL__;
  if(!S||!S.isShell)return;
  const input=document.querySelector('#omniInput');
  const list=document.querySelector('#omniList');
  const links=document.querySelector('#ovLinks');
  if(!input||!list||!links)return;

  let seq=0,selected=0,provider='Search';
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  const host=url=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return'';}};
  const looksLikeAddress=q=>/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q)||/^https?:\/\//i.test(q);
  const normalize=s=>String(s||'').trim().toLowerCase();
  async function active(){const tabs=await S.listTabs().catch(()=>[]);return (tabs||[]).find(t=>t.active)||null;}
  async function finishBrowse(){await S.setInternalView(false).catch(()=>{});try{if(typeof closeAll==='function')closeAll();if(typeof setView==='function')setView('browse');document.documentElement.dataset.kind='page';}catch{}}
  async function go(value){
    const a=await active();
    const resolved=await S.resolveOmnibox(value).catch(()=>null);
    const target=resolved&&['engine','direct'].includes(resolved.kind)?resolved.url:value;
    await finishBrowse();
    document.documentElement.dataset.navbusy='1';
    const done=()=>{document.documentElement.dataset.navbusy='0';};
    if(a?.id!=null) S.navigate(a.id,target).catch(done);
    else S.newTab({url:target}).catch(done);
  }
  async function selectOpenTab(id){await S.selectTab(id);await finishBrowse();}

  function row(icon,title,sub,onClick,side=''){
    const b=el('button','ovRow');const ic=el('span','ic',icon);const main=el('span','main');main.append(el('span','t',title),el('span','u',sub));b.append(ic,main);if(side)b.append(el('span','side',side));b._breezeAction=onClick;b.onclick=e=>{e.preventDefault();onClick();};return b;
  }
  function section(name){return el('div','ovSec eyebrow',name);}
  function actionable(){return [...list.querySelectorAll('.ovRow')];}
  function paintSelection(index){const rows=actionable();if(!rows.length){selected=0;return;}selected=(index+rows.length)%rows.length;rows.forEach((r,i)=>r.classList.toggle('sel',i===selected));rows[selected].scrollIntoView({block:'nearest'});}
  function installFragment(frag){list.replaceChildren(frag);paintSelection(0);}

  async function localData(a){
    const tabs=await S.listTabs().catch(()=>[]);
    if(a?.private)return {tabs:Array.isArray(tabs)?tabs:[],bookmarks:[],history:[],queue:[]};
    const workspace=String(a?.workspace||'default');const prefs=await S.getPreferences().catch(()=>({searchLibrary:true}));
    if(prefs.searchLibrary===false)return {tabs:Array.isArray(tabs)?tabs:[],bookmarks:[],history:[],queue:[]};
    const [bookmarks,history,queue]=await Promise.all([S.bookmarkList('').catch(()=>[]),S.historyList('').catch(()=>[]),S.listQueue(workspace).catch(()=>[])]);
    return {tabs:Array.isArray(tabs)?tabs:[],bookmarks:Array.isArray(bookmarks)?bookmarks:[],history:Array.isArray(history)?history:[],queue:Array.isArray(queue)?queue:[]};
  }
  function uniqueLibrary(data){
    const seen=new Set(),out=[];
    for(const [kind,rows] of [['Bookmark',data.bookmarks],['Queue',data.queue],['History',data.history]])for(const r of rows){
      const url=String(r.url||'');if(!/^https?:\/\//i.test(url)||seen.has(url))continue;seen.add(url);out.push({kind,url,title:r.title||host(url),sub:host(url),visitedAt:r.visitedAt||r.addedAt||0});if(out.length>=30)return out;
    }
    return out;
  }
  function score(item,needle){
    const title=normalize(item.title),url=normalize(item.url),h=normalize(host(item.url));
    if(title===needle||h===needle)return 100;if(title.startsWith(needle)||h.startsWith(needle))return 80;if(url.includes(needle))return 55;if(title.includes(needle))return 45;return 0;
  }

  async function renderQuick(currentSeq){
    const a=await active(),data=await localData(a);if(currentSeq!==seq||input.value.trim())return;
    const rows=uniqueLibrary(data).slice(0,7);links.replaceChildren();
    if(!rows.length){const note=el('div',null,a?.private?'Private browsing keeps your regular history, bookmarks and queue out of suggestions.':'Your bookmarks and recent sites will appear here as you use Breeze.');note.style.cssText='grid-column:1/-1;padding:12px;color:var(--tx3);font-size:11.5px;line-height:1.5;text-align:center';links.append(note);return;}
    rows.forEach(r=>{const b=el('button','ovLink');const tile=el('span','tile',(host(r.url)[0]||'B').toUpperCase());b.append(tile,el('span',null,(r.title||r.sub).slice(0,15)));b.title=r.title;b.onclick=()=>go(r.url);links.append(b);});
  }

  async function renderScope(q,currentSeq){
    const m=q.match(/^@(tabs|history|bookmarks|queue)(?:\s+(.*))?$/i);if(!m)return false;
    const scope=m[1].toLowerCase(),needle=normalize(m[2]||''),a=await active(),data=await localData(a);if(currentSeq!==seq||input.value.trim()!==q)return true;
    let items=[];
    if(scope==='tabs')items=data.tabs.filter(t=>!needle||(normalize(t.title)+' '+normalize(t.url)).includes(needle)).map(t=>({title:t.title||host(t.url)||'New tab',url:t.url,id:t.id,kind:t.private?'Private tab':'Open tab'}));
    else {const source=scope==='history'?data.history:scope==='bookmarks'?data.bookmarks:data.queue;items=source.filter(x=>!needle||(normalize(x.title)+' '+normalize(x.url)).includes(needle)).map(x=>({title:x.title||host(x.url),url:x.url,kind:scope[0].toUpperCase()+scope.slice(1)}));}
    const frag=document.createDocumentFragment();frag.append(section('@'+scope));
    if(!items.length)frag.append(row('⌕',`No ${scope} matches`,a?.private&&scope!=='tabs'?'Regular activity is hidden in Private browsing':'Keep typing to narrow the list',()=>{}));
    else items.slice(0,10).forEach(x=>frag.append(row((host(x.url)[0]||'B').toUpperCase(),x.title,`${x.kind} · ${host(x.url)||x.url}`,()=>x.id!=null?selectOpenTab(x.id):go(x.url))));
    installFragment(frag);return true;
  }

  async function renderShortcut(q,currentSeq){
    if(!q.startsWith('!'))return false;const resolved=await S.resolveOmnibox(q).catch(()=>null);if(currentSeq!==seq||input.value.trim()!==q)return true;
    const frag=document.createDocumentFragment();frag.append(section('Search shortcut'));
    if(resolved?.url){frag.append(row('⌕',`${resolved.engine} · ${resolved.query}`,resolved.url,()=>go(q),'Search'));}
    else {
      const all=await S.omniboxShortcuts().catch(()=>[]);const needle=q.slice(1).toLowerCase();
      (all||[]).filter(x=>x.token.startsWith('!')&&(!needle||x.token.slice(1).startsWith(needle))).slice(0,9).forEach(x=>frag.append(row('!',x.token,x.label,()=>{input.value=x.token+' ';input.focus();schedule();},'Shortcut')));
    }
    installFragment(frag);return true;
  }

  async function renderQuery(q,currentSeq){
    if(await renderScope(q,currentSeq))return;if(await renderShortcut(q,currentSeq))return;
    const a=await active(),data=await localData(a);if(currentSeq!==seq||input.value.trim()!==q)return;
    const needle=normalize(q);
    const tabs=data.tabs.filter(t=>(normalize(t.title)+' '+normalize(t.url)).includes(needle)).slice(0,3).map(t=>({title:t.title||host(t.url),url:t.url,id:t.id,kind:t.private?'Private tab':'Open tab'}));
    const local=uniqueLibrary(data).map(x=>({...x,_score:score(x,needle)})).filter(x=>x._score>0).sort((x,y)=>y._score-x._score||Number(y.visitedAt||0)-Number(x.visitedAt||0)).slice(0,5);
    const [cfg,remote]=await Promise.all([S.searchConfig().catch(()=>null),S.omniboxSuggestions(q).catch(()=>({suggestions:[]}))]);if(currentSeq!==seq||input.value.trim()!==q)return;
    provider=cfg?.provider||provider;
    const frag=document.createDocumentFragment();frag.append(section(looksLikeAddress(q)?'Open':'Search'));
    frag.append(row(looksLikeAddress(q)?'↗':'⌕',looksLikeAddress(q)?q:`Search ${provider} for “${q}”`,looksLikeAddress(q)?'Open this address':'Enter',()=>go(q),looksLikeAddress(q)?'Open':'Search'));
    if(tabs.length){frag.append(section('Open tabs'));tabs.forEach(t=>frag.append(row((host(t.url)[0]||'B').toUpperCase(),t.title,`${t.kind} · ${host(t.url)}`,()=>selectOpenTab(t.id),'Switch')));}
    if(local.length){frag.append(section('Your Breeze library'));local.forEach(r=>frag.append(row((host(r.url)[0]||'B').toUpperCase(),r.title,`${r.kind} · ${r.sub}`,()=>go(r.url))));}
    const suggestions=Array.isArray(remote?.suggestions)?remote.suggestions:[];
    if(suggestions.length){frag.append(section(`${remote.provider} suggestions`));suggestions.slice(0,6).forEach(s=>frag.append(row('⌕',s,'Search suggestion',()=>go(s))));}
    installFragment(frag);
  }

  function schedule(){
    const currentSeq=++seq,q=input.value.trim();selected=0;
    if(q.startsWith('/'))return;
    clearTimeout(schedule.timer);schedule.timer=setTimeout(()=>{
      if(currentSeq!==seq)return;
      if(!q){list.replaceChildren();links.dataset.on='1';renderQuick(currentSeq);}else{links.dataset.on='0';renderQuery(q,currentSeq);}
    },q?120:0);
  }

  window.addEventListener('keydown',e=>{
    if(e.target!==input||input.value.trim().startsWith('/'))return;
    const rows=actionable();
    if(e.key==='ArrowDown'&&rows.length){e.preventDefault();e.stopImmediatePropagation();paintSelection(selected+1);}
    else if(e.key==='ArrowUp'&&rows.length){e.preventDefault();e.stopImmediatePropagation();paintSelection(selected-1);}
    else if(e.key==='Enter'){
      e.preventDefault();e.stopImmediatePropagation();const chosen=rows[selected]||rows[0];if(chosen?._breezeAction)chosen._breezeAction();else if(input.value.trim())go(input.value.trim());
    }
  },true);
  input.addEventListener('input',schedule);input.addEventListener('focus',schedule);
  S.on('tab:update',st=>{if(st?.active&&document.documentElement.dataset.omni==='1')schedule();});

  async function wireSearchSettings(){
    const pane=document.querySelector('[data-pane="search"]');if(!pane)return;const prefs=await S.getPreferences().catch(()=>({}));const cfg=await S.searchConfig().catch(()=>({signals:false}));
    const rows=[...pane.querySelectorAll('.setRow')];
    const libraryRow=rows.find(r=>r.querySelector('.t')?.textContent?.trim()==='Show items from your library');
    if(libraryRow){const sw=libraryRow.querySelector('.switch');if(sw){sw.setAttribute('aria-checked',String(prefs.searchLibrary!==false));sw.onclick=()=>setTimeout(()=>S.setPreference('searchLibrary',sw.getAttribute('aria-checked')==='true'),0);}}
    const signalRow=rows.find(r=>r.querySelector('.t')?.textContent?.trim()==='Show page signals');
    if(signalRow){const sw=signalRow.querySelector('.switch');if(sw){sw.setAttribute('aria-checked',String(!!cfg.signals));sw.onclick=()=>setTimeout(()=>S.setSearchSignals(sw.getAttribute('aria-checked')==='true'),0);}}
    const group=signalRow?.closest('.setGrp')||pane.querySelector('.setGrp:last-child');
    if(group&&!group.querySelector('[data-real-search-suggestions]')){
      const r=el('div','setRow');r.dataset.realSearchSuggestions='1';const lab=el('span','lab');lab.append(el('span','t','Search suggestions'),el('span','d','Send partial queries to the selected engine when it offers a keyless suggestion endpoint. Always off in Private browsing.'));const sw=el('button','switch');sw.setAttribute('role','switch');sw.setAttribute('aria-checked',String(prefs.searchSuggestions!==false));sw.onclick=()=>{const next=sw.getAttribute('aria-checked')!=='true';sw.setAttribute('aria-checked',String(next));S.setPreference('searchSuggestions',next);};r.append(lab,sw);group.append(r);
      const hint=el('div','setRow');const hl=el('span','lab');hl.append(el('span','t','Fast search shortcuts'),el('span','d','Use !g, !ddg, !b, !sp, !k, !yt, !w or !gh. Use @tabs, @history, @bookmarks and @queue to search Breeze itself.'));hint.append(hl);group.append(hint);
    }
  }
  wireSearchSettings();S.searchConfig().then(c=>{provider=c?.provider||provider;}).catch(()=>{});schedule();
})();
