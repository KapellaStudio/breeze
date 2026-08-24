/* Breeze packaged New Tab bindings.
   Replaces prototype quick links and Continue cards with real local activity,
   and upgrades the weather chip into opt-in live local weather. */
(function(){
  'use strict';
  const S=window.__BREEZE_SHELL__;
  if(!S||!S.isShell)return;
  const $=s=>document.querySelector(s);
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  let activeWorkspace='default';
  let activePrivate=false;
  let refreshTimer=null;
  let weatherEnabled=false;
  let weatherValue=null;
  let weatherTimer=null;

  const style=document.createElement('style');
  style.textContent=`
    [data-private="1"] .links,[data-private="1"] .continue,[data-private="1"] #queueHome{display:none!important}
    .homeEmpty{grid-column:1/-1;padding:18px 16px;border:1px dashed var(--line);border-radius:var(--r-lg);font-size:12px;line-height:1.55;color:var(--tx3);text-align:center}
    .link .tile{overflow:hidden}.link .tile span{font-size:12px;font-weight:700}.card .kind{min-height:16px}.card .go{pointer-events:none}
    .homebar .wx{height:30px;padding:0 9px;border-radius:999px;border:1px solid transparent;color:var(--tx2);font-size:12px;white-space:nowrap;transition:background .15s var(--ease),border-color .15s var(--ease),color .15s var(--ease)}
    .homebar .wx:hover,.homebar .wx[aria-expanded="true"]{background:var(--bg1);border-color:var(--line);color:var(--tx1)}
    .wxDot{width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px var(--accentSoft);flex:0 0 auto}.wxDot.off{background:var(--tx3);box-shadow:none}.wxDot.warn{background:var(--warn);box-shadow:none}
    .weatherPop{position:fixed;z-index:90;width:292px;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--card);box-shadow:var(--sh4);display:none}.weatherPop[data-on="1"]{display:block}
    .weatherHead{display:flex;align-items:flex-start;gap:10px}.weatherHead .temp{font-size:30px;line-height:1;font-weight:600;letter-spacing:-1px}.weatherHead .main{flex:1;min-width:0}.weatherHead .cond{font-size:12.5px;font-weight:600}.weatherHead .sub{font-size:10.5px;color:var(--tx3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .weatherGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin-top:13px}.weatherMetric{padding:9px;border:1px solid var(--line2);border-radius:9px;background:var(--bg2)}.weatherMetric .k{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3)}.weatherMetric .v{font-size:12px;font-weight:600;margin-top:2px}
    .weatherNote{font-size:10px;line-height:1.5;color:var(--tx3);margin-top:11px}.weatherSource{font-size:9.5px;color:var(--tx3);margin-top:7px}.weatherActions{display:flex;gap:7px;margin-top:11px}.weatherActions button{flex:1}
  `;
  document.head.append(style);

  function host(url){try{return new URL(url).hostname.replace(/^www\./,'');}catch{return'';}}
  function age(ts){const d=Math.max(0,Date.now()-Number(ts||0)),m=Math.floor(d/60000);if(m<1)return'now';if(m<60)return`${m} min ago`;const h=Math.floor(m/60);if(h<24)return`${h} h ago`;const day=Math.floor(h/24);return day<14?`${day} d ago`:new Date(ts).toLocaleDateString();}
  function openUrl(url,workspace=activeWorkspace,sealed=false){if(!/^https?:\/\//i.test(String(url||'')))return;S.newTab({url,workspaceId:workspace,sealed:!!sealed}).then(()=>{try{if(typeof setView==='function')setView('browse');}catch{}});}
  function iconFor(url){const h=host(url);return(h[0]||'B').toUpperCase();}

  async function collect(){
    const [history,bookmarks,queue,downloads,snapshots]=await Promise.all([
      S.historyList('').catch(()=>[]),S.bookmarkList('').catch(()=>[]),S.listQueue(activeWorkspace).catch(()=>[]),S.listDownloads().catch(()=>[]),S.listSnapshots(activeWorkspace).catch(()=>[])
    ]);
    return {history:Array.isArray(history)?history:[],bookmarks:Array.isArray(bookmarks)?bookmarks:[],queue:Array.isArray(queue)?queue:[],downloads:Array.isArray(downloads)?downloads:[],snapshots:Array.isArray(snapshots)?snapshots:[]};
  }

  function renderLinks(data){
    const wrap=$('.stage .links');if(!wrap)return;const seen=new Set();const candidates=[];
    for(const r of [...data.bookmarks,...data.history]){const h=host(r.url);if(!h||seen.has(h))continue;seen.add(h);candidates.push(r);if(candidates.length>=7)break;}
    wrap.replaceChildren();
    for(const r of candidates){const b=el('button','link');b.title=r.title||host(r.url);const tile=el('span','tile');tile.append(el('span',null,iconFor(r.url)));b.append(tile,document.createTextNode((r.title||host(r.url)).slice(0,12)));b.onclick=()=>openUrl(r.url,activeWorkspace,false);wrap.append(b);}
    if(!candidates.length){const note=el('div','homeEmpty','Your saved and recently visited sites will become quick links here. Nothing is preloaded or sponsored.');note.style.width='min(520px,100%)';wrap.append(note);}
  }

  function renderQueueHome(data){
    const wrap=$('#queueHome');if(!wrap)return;wrap.replaceChildren();
    if(!data.queue.length){wrap.append(el('div','homeEmpty','Your Reading Queue is empty. Save a page from the Queue panel instead of leaving another tab open.'));return;}
    data.queue.slice(0,8).forEach((q,i)=>{const b=el('button','qhRow');const n=el('span','n',String(i+1));const m=el('span','m');m.append(el('span','t',q.title||host(q.url)),el('span','s',`${host(q.url)} · ${age(q.addedAt)}`));const arrow=el('span',null,'›');arrow.style.color='var(--tx3)';b.append(n,m,arrow);b.onclick=async()=>{const ws=await S.getWorkspace(q.workspace).catch(()=>null);openUrl(q.url,q.workspace||activeWorkspace,!!ws?.sealed);};wrap.append(b);});
  }

  function card(kind,title,detail,action,label='Open →'){const b=el('button','card');b.append(el('span','kind eyebrow',kind),el('h3',null,title),el('p',null,detail),el('span','go',label));b.onclick=action;return b;}
  function renderContinue(data){
    const section=$('.stage .continue'),wrap=section?.querySelector('.cards');if(!section||!wrap)return;const cards=[];
    const q=data.queue[0];if(q)cards.push(card('Reading queue',q.title||host(q.url),`${host(q.url)} · ${Math.max(0,data.queue.length-1)} more queued`,async()=>{const ws=await S.getWorkspace(q.workspace).catch(()=>null);openUrl(q.url,q.workspace||activeWorkspace,!!ws?.sealed);},'Open page →'));
    const recent=data.history.find(r=>!r.workspace||r.workspace===activeWorkspace)||data.history[0];if(recent)cards.push(card('Recent page',recent.title||host(recent.url),`${host(recent.url)} · ${age(recent.visitedAt)}`,()=>openUrl(recent.url,activeWorkspace,false),'Return →'));
    const dl=data.downloads.find(d=>d.state==='completed'&&(!d.workspace||d.workspace===activeWorkspace))||data.downloads.find(d=>d.state==='completed');if(dl)cards.push(card('Download',dl.filename||'Downloaded file',`${host(dl.source||dl.url)||'Local file'} · ${age(dl.completedAt||dl.startedAt)}`,()=>S.openDownload(dl.id),'Open file →'));
    const snap=data.snapshots[0];if(snap)cards.push(card('Workspace snapshot',new Date(snap.createdAt).toLocaleString(),`${snap.tabs?.length||0} restorable web tab${snap.tabs?.length===1?'':'s'}`,()=>{try{if(typeof setView==='function')setView('browse');if(typeof openPanel==='function')openPanel('snapshots');}catch{}},'Review →'));
    if(cards.length<4){const saved=data.bookmarks[0];if(saved)cards.push(card('Bookmark',saved.title||host(saved.url),host(saved.url),()=>openUrl(saved.url,activeWorkspace,false),'Open →'));}
    wrap.replaceChildren();cards.slice(0,4).forEach(c=>wrap.append(c));if(!cards.length)wrap.append(el('div','homeEmpty','Your real local activity will appear here as you use Breeze — recent pages, queue items, completed downloads and workspace snapshots.'));const head=section.querySelector('.contHead .eyebrow');if(head)head.textContent='Continue';
  }

  /* ── live local weather ───────────────────────────────────────────────
     Weather is deliberately network-location based. That makes the privacy
     boundary visible: Breeze uses the same approximate location the public
     internet already sees, follows VPN egress, and never asks an OS or Google
     geolocation service for a more precise position. */
  const originalWeather=$('.homebar .wx');
  const weatherButton=originalWeather?el('button','wx'):null;
  const weatherPop=originalWeather?el('div','weatherPop'):null;
  if(originalWeather&&weatherButton&&weatherPop){
    weatherButton.type='button';weatherButton.setAttribute('aria-label','Local weather');weatherButton.setAttribute('aria-expanded','false');originalWeather.replaceWith(weatherButton);document.body.append(weatherPop);
  }
  function setWeatherChip(text,state='off'){
    if(!weatherButton)return;const dot=el('span','wxDot'+(state==='off'?' off':state==='warn'?' warn':''));weatherButton.replaceChildren(dot,document.createTextNode(text));
  }
  function localUnit(){
    try{const region=new Intl.Locale(navigator.language||'en').region;return['US','LR','MM'].includes(region)?'fahrenheit':'celsius';}catch{return /(^|-)US\b/i.test(navigator.language||'')?'fahrenheit':'celsius';}
  }
  function closeWeather(){if(weatherPop)weatherPop.dataset.on='0';if(weatherButton)weatherButton.setAttribute('aria-expanded','false');}
  function placeWeather(){if(!weatherButton||!weatherPop)return;const r=weatherButton.getBoundingClientRect(),w=weatherPop.offsetWidth||292;weatherPop.style.left=Math.max(10,Math.min(r.right-w,innerWidth-w-10))+'px';weatherPop.style.top=(r.bottom+7)+'px';}
  function metric(k,v){const n=el('div','weatherMetric');n.append(el('div','k',k),el('div','v',v==null?'—':String(v)));return n;}
  function renderWeatherPop(){
    if(!weatherPop||!weatherValue)return;const w=weatherValue,sym='°'+w.unit;weatherPop.replaceChildren();
    const head=el('div','weatherHead'),main=el('div','main');main.append(el('div','cond',w.condition),el('div','sub',`${w.location||'Current network'} · updated ${age(w.updatedAt)}`));head.append(el('div','temp',w.temperature+sym),main);weatherPop.append(head);
    const grid=el('div','weatherGrid');grid.append(metric('Feels like',w.feelsLike==null?'—':w.feelsLike+sym),metric('High / low',w.high==null||w.low==null?'—':w.high+sym+' / '+w.low+sym),metric('Rain chance',w.precipitation==null?'—':w.precipitation+'%'),metric('Wind',w.wind==null?'—':w.wind+' '+w.windUnit));weatherPop.append(grid);
    weatherPop.append(el('div','weatherNote','Breeze estimates location from the network address you already expose to the internet. It does not request precise OS location or save coordinates. If you use a VPN, weather follows the VPN location. Weather is paused in Private browsing.'));
    weatherPop.append(el('div','weatherSource','Weather: MET Norway · Location estimate: ipwho.is'));
    const actions=el('div','weatherActions');const refresh=el('button','btn ghost','Refresh');const off=el('button','btn ghost','Turn off');refresh.onclick=e=>{e.stopPropagation();closeWeather();refreshWeather();};off.onclick=async e=>{e.stopPropagation();weatherEnabled=false;weatherValue=null;clearTimeout(weatherTimer);await S.setPreference('weatherEnabled',false).catch(()=>{});closeWeather();setWeatherChip('Weather · Use network location','off');};actions.append(refresh,off);weatherPop.append(actions);
  }
  async function refreshWeather(){
    clearTimeout(weatherTimer);closeWeather();
    if(!weatherButton)return;
    if(activePrivate){setWeatherChip('Weather paused in Private','off');return;}
    if(!weatherEnabled){setWeatherChip('Weather · Use network location','off');return;}
    setWeatherChip('Weather · Locating…');
    try{
      const result=await S.currentWeather(localUnit());
      if(activePrivate)return setWeatherChip('Weather paused in Private','off');
      if(result?.error)throw new Error(result.error);weatherValue=result;
      setWeatherChip(`${result.temperature}° · ${result.condition}`);renderWeatherPop();
      weatherButton.title=`${result.location||'Local weather'} · ${result.source||'live weather'}`;
      weatherTimer=setTimeout(refreshWeather,20*60*1000);
    }catch(err){setWeatherChip('Weather · Retry','warn');weatherButton.title=String(err?.message||'Weather unavailable');}
  }
  if(weatherButton){
    weatherButton.onclick=async e=>{e.stopPropagation();
      if(activePrivate)return;
      if(!weatherEnabled){weatherEnabled=true;await S.setPreference('weatherEnabled',true).catch(()=>{});return refreshWeather();}
      if(!weatherValue)return refreshWeather();
      const on=weatherPop.dataset.on==='1';closeWeather();if(!on){renderWeatherPop();weatherPop.dataset.on='1';weatherButton.setAttribute('aria-expanded','true');requestAnimationFrame(placeWeather);}
    };
    document.addEventListener('click',e=>{if(!e.target.closest('.weatherPop,.wx'))closeWeather();});
    addEventListener('resize',closeWeather);
    S.getPreferences().then(p=>{weatherEnabled=!!p?.weatherEnabled;refreshWeather();}).catch(()=>setWeatherChip('Weather · Use network location','off'));
  }

  async function refresh(){if(activePrivate)return;const data=await collect();renderLinks(data);renderQueueHome(data);renderContinue(data);}
  function schedule(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,60);}
  S.listTabs().then(t=>{const a=(t||[]).find(x=>x.active);if(a){activePrivate=!!a.private;if(!a.private)activeWorkspace=String(a.workspace||'default');}schedule();if(activePrivate)refreshWeather();}).catch(schedule);
  S.on('tab:update',st=>{if(!st?.active)return;const wasPrivate=activePrivate;activePrivate=!!st.private;if(!st.private)activeWorkspace=String(st.workspace||'default');schedule();if(wasPrivate!==activePrivate)refreshWeather();});
  S.on('download:update',schedule);S.on('download:refresh',schedule);
  document.addEventListener('click',e=>{if(e.target.closest('[data-panel="queue"],[data-panel="bookmarks"],[data-panel="snapshots"],#bookmarkActiveBtn'))setTimeout(schedule,100);},true);
  schedule();
})();
