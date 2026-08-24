/* ═══════════════════════════════════════════════════════════════════════════
   BREEZE — SHELL ADAPTER
   Binds the chrome UI to real Chromium tabs when running inside the Electron
   shell. Outside the shell this file does nothing at all, so the standalone
   prototype keeps working exactly as before.

   The design rule: the UI keeps ONE tab model (GROUPS). In the browser that
   model is mock data; in the shell it is a projection of real tab state
   pushed from the main process. Nothing in the rendering layer needs to know
   which it is looking at.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const S = (typeof window !== 'undefined') && window.__BREEZE_SHELL__;
  if (!S || !S.isShell) return;              // standalone prototype: do nothing

  root.dataset.shell = '1';

  /* ── real tab state ──────────────────────────────────────────────────────
     id is the main-process tab id. We keep the shape the UI already renders
     (f, mark, t, u, kind) so renderTabs/renderClassic need no changes.      */
  const live = new Map();                    // id -> ui tab object
  let activeId = null;

  const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); }
                          catch { return ''; } };
  const pathOf = url => { try { const u = new URL(url); return u.pathname + u.search; }
                          catch { return ''; } };

  /* Map a hostname onto the site registry so real tabs get real brand marks
     and tints, exactly like the mock ones do. */
  function markFor(host){
    const k = Object.keys(SITE).find(key => host === key + '.com' || host.endsWith(key + '.com')
                                          || host.startsWith(key + '.'));
    return k || null;
  }

  function toUiTab(st){
    const isPdf=st.kind==='pdf';
    const host = isPdf && st.fileName ? '' : hostOf(st.url);
    const mark = markFor(host);
    return {
      id: st.id,
      mark: mark || undefined,
      f: isPdf ? 'P' : (host[0] || '?').toUpperCase(),
      tint: isPdf ? '#DC2626' : (mark ? undefined : '#64748B'),
      t: st.title || st.fileName || host || 'New tab',
      u: isPdf && st.fileName ? st.fileName : host + pathOf(st.url),
      kind: isPdf ? 'pdf' : 'page',
      active: st.active,
      asleep: !!st.sleeping,
      _blocked: st.blocked,
      _canBack: st.canGoBack,
      _canFwd: st.canGoForward,
      _sealed: st.sealed,
      _private: !!st.private
    };
  }

  /* Rebuild GROUPS in place — the UI holds a reference to it, so replacing
     the binding would silently orphan every renderer. */
  function projectGroups(){
    const byHost = new Map();
    for (const t of live.values()){
      const host = t.u.split('/')[0] || 'new tab';
      if (!byHost.has(host)) byHost.set(host, []);
      byHost.get(host).push(t);
    }
    GROUPS.length = 0;
    for (const [domain, tabs] of byHost) GROUPS.push({ domain, open: true, tabs });
  }

  function repaint(){
    projectGroups();
    if (typeof renderTabs === 'function') renderTabs();
    if (typeof renderClassic === 'function') renderClassic();
    const a = live.get(activeId);
    root.dataset.private = a? (a._private ? '1' : '0') : '0';
    root.dataset.kind = a?.kind || 'page';
    if (a) paintAddress(a);
    if (typeof paintNav === 'function') paintNav();
    if (typeof updateBookmarkButton === 'function') updateBookmarkButton();
  }

  function paintAddress(t){
    const url = $('#urlText');
    if (url){
      const host = t.u.split('/')[0];
      const rest = t.u.slice(host.length);
      url.replaceChildren(
        Object.assign(document.createElement('em'), { textContent: host }),
        document.createTextNode(rest));
    }
    const shieldCount = document.querySelector('#shieldBtn');
    if (shieldCount) shieldCount.lastChild.textContent = ' ' + (t._blocked || 0);
    const b = $('#navBack'), f = $('#navFwd');
    if (b) b.disabled = !t._canBack;
    if (f) f.disabled = !t._canFwd;
  }

  /* ── events from the main process ───────────────────────────────────────── */
  S.on('tab:update', st => {
    if (!st) return;
    live.set(st.id, Object.assign(live.get(st.id) || {}, toUiTab(st)));
    if (st.active) activeId = st.id;
    for (const [id, t] of live) t.active = (id === activeId);
    repaint();
  });
  S.on('tab:closed', ({ id }) => { live.delete(id); repaint(); });
  S.on('tab:loading', ({ id, loading }) => {
    const t = live.get(id); if (t) t.badge = loading;
    if (typeof renderTabs === 'function') renderTabs();
  });
  S.on('tab:error', ({ desc }) => toast('Could not load: ' + desc));
  S.on('win:state', ({ maximized }) => {
    const btn = $('#winMax');
    if (btn) btn.title = maximized ? 'Restore' : 'Maximise';
  });

  /* Private browsing uses the familiar Cmd/Ctrl+Shift+N shortcut, but opens a
     memory-only Breeze tab inside the current desktop window. */
  document.addEventListener('keydown', e => {
    const mod=e.metaKey||e.ctrlKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 't'){
      e.preventDefault(); e.stopImmediatePropagation(); closeAll();
      S.newTab({}).then(() => { if (typeof setView === 'function') setView('home'); }); return;
    }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'o'){
      e.preventDefault(); e.stopImmediatePropagation(); closeAll();
      S.openPdf().then(r => { if(r?.error) toast(r.error); else if(r?.ok && typeof setView==='function') setView('browse'); }); return;
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'n'){
      e.preventDefault(); e.stopImmediatePropagation();
      closeAll();
      S.newPrivateTab({}).then(() => { if (typeof setView === 'function') setView('home'); }); return;
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 't'){
      e.preventDefault(); e.stopImmediatePropagation(); closeAll();
      S.reopenClosedTab().then(r => { if(r?.error) toast('No recently closed tab'); });
    }
  }, true);

  /* ── take over the UI's actions ─────────────────────────────────────────── */
  const _selectTab = window.selectTab;
  window.selectTab = function (t, fromHistory){
    if (t && t.id != null){ if(typeof setView==='function')setView('browse'); S.setInternalView(false); S.selectTab(t.id); return; }
    return _selectTab.apply(this, arguments);
  };

  window.closeTabById = id => S.closeTab(id);

  /* Omnibox: a real query goes to a real engine, a real host goes to the host.
     The main process makes that decision so the rule is enforced once. */
  const omni = $('#omniInput');
  if (omni){
    omni.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const q = e.target.value.trim();
      if (!q || q.startsWith('/')) return;
      e.preventDefault();
      e.stopImmediatePropagation();          // beat the prototype's own handler
      closeAll();
      if (activeId == null) S.newTab({ url: q });
      else S.navigate(activeId, q);
    }, true);
  }

  const nb = $('#navBack'), nf = $('#navFwd');
  if (nb) nb.onclick = () => activeId != null && S.back(activeId);
  if (nf) nf.onclick = () => activeId != null && S.forward(activeId);
  const reload = document.querySelector('.nav .iconbtn[title="Reload"]');
  if (reload) reload.onclick = () => activeId != null && S.reload(activeId);

  /* Find on page: use Chromium's own findInPage over real content rather than
     our DOM walker, which can only see the chrome's own markup. */
  const fi = $('#findInput');
  if (fi){
    fi.addEventListener('input', e => {
      if (activeId != null) S.find(activeId, e.target.value);
    }, true);
    fi.addEventListener('keydown', e => {
      if (e.key === 'Enter'){
        e.preventDefault(); e.stopImmediatePropagation();
        if (activeId != null) S.find(activeId, e.target.value, !e.shiftKey);
      }
    }, true);
  }
  const fc = $('#findClose');
  if (fc) fc.addEventListener('click', () => activeId != null && S.find(activeId, ''), true);

  /* Zoom applies to the real page, not our mock article. */
  if (typeof applyZoom === 'function'){
    const _applyZoom = window.applyZoom;
    window.applyZoom = function (){
      _applyZoom.apply(this, arguments);
      if (activeId != null) S.setZoom(activeId, (window.pageZoom || 100) / 100);
    };
  }

  /* Session repairs run against the real origin. */
  if (typeof runFix === 'function'){
    window.runFix = async kind => {
      if (activeId == null) return;
      const r = await S.repairSession(activeId, kind);
      toast(r?.ok || r?.error || 'Done');
      setStuck && setStuck(false);
    };
  }

  /* Clear browsing data actually clears it. */
  const clearAll = $('#clearAll');
  if (clearAll) clearAll.onclick = async () => {
    await S.clearData(['cache', 'cookies', 'storage', 'history']);
    await S.clearDownloadHistory();
    if (typeof renderRealHistory === 'function') renderRealHistory();
    toast('Browsing data cleared — saved bookmarks remain');
  };
  const clearSafe = $('#clearSafe');
  if (clearSafe) clearSafe.onclick = async () => {
    const selected=DATA_ROWS.filter(d => d.on); const picked=[]; let clearDownloads=false;
    selected.forEach(d=>{
      if(/Cached/.test(d.t))picked.push('cache');
      else if(/Browsing history/.test(d.t))picked.push('history');
      else if(/Download list/.test(d.t))clearDownloads=true;
      else if(/Cookies/.test(d.t))picked.push('cookies','storage');
    });
    if(picked.length) await S.clearData([...new Set(picked)]);
    if(clearDownloads) await S.clearDownloadHistory();
    if (typeof renderRealHistory === 'function') renderRealHistory();
    toast('Cleared ' + selected.length + ' selected categories');
  };

  /* Search engine choice is enforced in the main process. */
  if (typeof renderEngines === 'function'){
    S.listEngines().then(list => {
      if (Array.isArray(list) && list.length){ ENGINES.length = 0; ENGINES.push(...list); renderEngines(); }
    });
    document.addEventListener('click', e => {
      const b = e.target.closest('#engRow .engBtn');
      if (b) S.setEngine(b.textContent);
    });
  }

  /* ── real search ─────────────────────────────────────────────────────────
     runSearch() in the prototype paints a fixed set of demo results. Here it
     asks the main process, which either hands back a redirect URL (default,
     free, no key) or real rows from a provider the user configured.

     SR_DATA is mutated in place for the same reason GROUPS is: the renderer
     closed over the array, so rebinding it would orphan every reader. */
  let searchSeq = 0;

  function fillResults(rows){
    SR_DATA.length = 0;
    rows.forEach(r => SR_DATA.push({
      ...r,
      k: markFor(r.dom) || null          // brand mark, resolved renderer-side
    }));
  }

  function searchStatus(text){
    const c = $('#srCount');
    if (c) c.textContent = text;
  }

  if (typeof runSearch === 'function'){
    const _runSearch = window.runSearch;

    window.runSearch = async function (q){
      const query = String(q || '').trim();
      if (!query) return;
      const seq = ++searchSeq;

      // Paint the results view immediately with an empty list rather than
      // leaving the previous query's answers on screen while we wait.
      SR_DATA.length = 0;
      _runSearch.call(this, query);
      searchStatus('Searching…');

      let res;
      try { res = await S.runSearch(query); }
      catch (err){ res = { mode: 'error', message: String(err) }; }

      if (seq !== searchSeq) return;              // a newer query overtook us

      if (!res || res.mode === 'aborted') return;

      if (res.mode === 'redirect'){
        // Redirect mode is not a degraded state, it is the default: hand the
        // query to the engine's own page in a real tab.
        searchStatus('0');
        if (activeId != null) S.navigate(activeId, res.url);
        else S.newTab({ url: res.url });
        if (typeof setView === 'function') setView('browse');
        if (root) root.dataset.kind = 'page';
        return;
      }

      if (res.mode === 'needsSetup'){
        searchStatus('0');
        toast(res.engine + ' needs ' + (res.needs === 'key' ? 'an API key' : 'an instance URL') +
              ' — add it in Settings');
        return;
      }

      if (res.mode === 'error'){
        searchStatus('0');
        toast(res.message || 'Search failed');
        return;
      }

      fillResults(res.rows || []);
      renderSrFilters(); renderSearch();
      searchStatus(String(SR_DATA.length));
      if (res.cached) toast('From cache — no quota spent');
      measureVisible();
    };
  }

  /* Cost signals, measured rather than guessed. Off unless the user turned
     them on, because measuring means fetching pages they have not clicked.
     Sequential with a small gap: ten parallel fetches to ten strangers is a
     traffic pattern, and the results are already on screen either way. */
  async function measureVisible(){
    const cfg = await S.searchConfig().catch(() => null);
    if (!cfg || !cfg.signals) return;
    const seq = searchSeq;
    for (const r of SR_DATA.slice(0, 10)){
      if (seq !== searchSeq) return;
      if (!r.url || r.kb != null) continue;
      const m = await S.measureResult(r.url).catch(() => null);
      if (seq !== searchSeq) return;
      if (m && !m.error){ r.read = m.read; r.tr = m.tr; r.kb = m.kb; renderSearch(); }
    }
  }



  /* ── real downloads ─────────────────────────────────────────────────────
     The design promised provenance; the shell now supplies it from Chromium's
     DownloadItem rather than painting demo rows. Filesystem paths remain in
     main and actions address downloads only by opaque id. */
  const liveDownloads = new Map();
  const fmtBytes = n => {
    n=Number(n||0); if(!n) return '—';
    const u=['B','KB','MB','GB']; let i=0; while(n>=1024&&i<u.length-1){n/=1024;i++;}
    return (n>=10||i===0?n.toFixed(0):n.toFixed(1))+' '+u[i];
  };
  const dlHost = u => { try { return new URL(u).hostname.replace(/^www\./,''); } catch { return 'direct download'; } };
  function renderLiveDownloads(){
    const body=$('#downloadBody'); if(!body) return;
    const rows=[...liveDownloads.values()].sort((a,b)=>(b.startedAt||0)-(a.startedAt||0));
    const count=$('#downloadCount'); if(count) count.textContent=String(rows.length);
    const frag=document.createDocumentFragment();
    const stat=document.createElement('div'); stat.className='pStat';
    stat.textContent='Every file keeps its source and workspace'; frag.appendChild(stat);
    if(!rows.length){
      const empty=document.createElement('div'); empty.style.cssText='padding:28px 8px;text-align:center;color:var(--tx3);font-size:12px';
      empty.textContent='Downloads will appear here with the page they came from.'; frag.appendChild(empty);
    }
    rows.forEach(d=>{
      const item=document.createElement('div'); item.className='dItem'; item.dataset.downloadId=d.id;
      const icon=document.createElement('span'); icon.className='dIcon'; icon.textContent='↓';
      const main=document.createElement('div'); main.className='dMain';
      const h=document.createElement('h4'); h.textContent=d.filename||'download';
      const src=document.createElement('div'); src.className='src'; src.textContent=dlHost(d.source||d.url);
      const row=document.createElement('div'); row.className='row';
      const ws=document.createElement('span'); ws.className='chip'; ws.textContent=d.workspace||'default';
      const state=document.createElement('span'); state.className='chip n'; state.textContent=d.state==='progressing'?(fmtBytes(d.received)+' / '+fmtBytes(d.total)):d.state;
      row.append(ws,state); main.append(h,src,row);
      if(d.state==='progressing' && d.total>0){ const bar=document.createElement('div'); bar.className='dlBar'; const fill=document.createElement('i'); fill.style.width=Math.min(100,(d.received/d.total)*100)+'%'; bar.append(fill); main.append(bar); }
      const acts=document.createElement('div'); acts.className='dActions';
      if(d.state==='completed'){
        const open=document.createElement('button'); open.textContent='Open'; open.onclick=()=>S.openDownload(d.id);
        const show=document.createElement('button'); show.textContent='Show in folder'; show.onclick=()=>S.showDownload(d.id); acts.append(open,show);
      } else if(d.state==='progressing'){
        const pause=document.createElement('button'); pause.textContent=d.paused?'Resume':'Pause'; pause.onclick=()=>d.paused?S.resumeDownload(d.id):S.pauseDownload(d.id);
        const cancel=document.createElement('button'); cancel.textContent='Cancel'; cancel.onclick=()=>S.cancelDownload(d.id); acts.append(pause,cancel);
      }
      main.append(acts); item.append(icon,main); frag.append(item);
    });
    body.replaceChildren(frag);
  }
  S.listDownloads().then(list=>{ (list||[]).forEach(d=>liveDownloads.set(d.id,d)); renderLiveDownloads(); });
  S.on('download:update', d=>{ if(d?.id){ liveDownloads.set(d.id,d); renderLiveDownloads(); } });
  S.on('download:refresh', list=>{ liveDownloads.clear(); (list||[]).forEach(d=>liveDownloads.set(d.id,d)); renderLiveDownloads(); });

  /* ── extension compatibility tier ────────────────────────────────────────
     This is deliberately honest. Compatible unpacked extensions load through
     Electron today. A manifest that needs Chrome-level MV3 service workers is
     rejected and the UI explains why; that is the migration boundary for the
     planned Breeze Chromium core. */
  function extensionIcon(name){ const bits=String(name||'E').trim().split(/\s+/); return bits.length>1?(bits[0][0]+bits[1][0]).toUpperCase():bits[0].slice(0,2).toUpperCase(); }
  function toUiExt(e){
    return { id:e.localId, ic:extensionIcon(e.name), name:e.name, by:e.author||'Unpacked extension', desc:e.description||('Version '+e.version),
      on:e.enabled!==false, perms:(e.permissions||[]).slice(0,6).map(p=>({n:p,w:/<all_urls>|\*:|http/i.test(p)})), scopes:['All workspaces'],
      _compat:e.compatibility, _warnings:e.warnings||[], _reasons:e.reasons||[] };
  }
  function renderShellExtensions(){
    const list=$('#extList'); if(!list) return;
    const c=$('#extInstalledCount'); if(c) c.textContent=EXTS.length+' installed';
    if(!EXTS.length){ list.innerHTML='<div style="padding:26px 8px;text-align:center;color:var(--tx3);font-size:12px">No unpacked extensions installed yet.</div>'; renderShellExtPop(); return; }
    list.innerHTML=EXTS.map(e=>'<div class="extRow" data-off="'+(e.on?'0':'1')+'" data-id="'+esc(e.id)+'">'+
      '<span class="extIcon">'+esc(e.ic)+'</span><div class="extMain"><div class="extTitle"><h4>'+esc(e.name)+'</h4><span class="extBy">by '+esc(e.by)+'</span><span class="compat '+(e._compat==='compatible'?'good':'partial')+'">'+esc(e._compat)+'</span></div>'+
      '<div class="extDesc">'+esc(e.desc)+'</div><div class="extPerms">'+e.perms.map(permHTML).join('')+'</div></div>'+
      '<div class="extSide"><button class="switch" role="switch" aria-checked="'+(e.on?'true':'false')+'" data-real-tog="'+esc(e.id)+'"></button><span class="extScope">All <b>workspaces</b></span><button class="extRemove" data-real-remove="'+esc(e.id)+'">Remove</button></div></div>').join('');
    $$('#extList [data-real-tog]').forEach(b=>b.onclick=async ev=>{ ev.stopPropagation(); const e=EXTS.find(x=>x.id===b.dataset.realTog); if(!e)return; const r=await S.setExtensionEnabled(e.id,!e.on); if(r?.error)return toast(r.error); e.on=!e.on; renderShellExtensions(); toast(e.name+(e.on?' enabled':' disabled')); });
    $$('#extList [data-real-remove]').forEach(b=>b.onclick=async()=>{ const e=EXTS.find(x=>x.id===b.dataset.realRemove); if(!e)return; const r=await S.removeExtension(e.id); if(r?.error)return toast(r.error); const i=EXTS.indexOf(e); if(i>=0)EXTS.splice(i,1); renderShellExtensions(); toast(e.name+' removed'); });
    renderShellExtPop();
  }
  function renderShellExtPop(){
    const host=$('#epList'); if(!host) return;
    host.innerHTML=EXTS.length?EXTS.map(e=>'<div class="epRow"><span class="ic">'+esc(e.ic)+'</span><span class="nm">'+esc(e.name)+'</span><button class="switch sm" role="switch" aria-checked="'+(e.on?'true':'false')+'" data-real-ptog="'+esc(e.id)+'"></button></div>').join(''):'<div style="padding:18px 10px;text-align:center;color:var(--tx3);font-size:12px">No compatible extensions installed</div>';
    $$('#epList [data-real-ptog]').forEach(b=>b.onclick=async ev=>{ev.stopPropagation(); const e=EXTS.find(x=>x.id===b.dataset.realPtog); if(!e)return; await S.setExtensionEnabled(e.id,!e.on); e.on=!e.on; renderShellExtensions();});
  }
  async function refreshExtensions(){
    const rows=await S.listExtensions().catch(()=>[]); EXTS.length=0; (rows||[]).forEach(e=>EXTS.push(toUiExt(e))); renderShellExtensions();
  }
  window.renderExts=renderShellExtensions; window.renderExtPop=renderShellExtPop;
  const installExt=$('#installExtBtn');
  if(installExt) installExt.onclick=async()=>{
    const r=await S.installUnpacked();
    if(!r||r.canceled)return;
    if(r.error)return toast(r.error);
    if(r.installed===false){ const why=(r.reasons||[])[0]||'This extension needs Chrome APIs the current engine cannot provide.'; toast('Not installed · '+why); return; }
    await refreshExtensions(); toast((r.extension?.name||'Extension')+' installed locally');
  };
  refreshExtensions();


  /* ── real local history + bookmarks ─────────────────────────────────────
     Automatic history never includes private tabs because main.js refuses to
     record them. Bookmarks are explicit user intent and may be saved from any
     tab. */
  const ageLabel = ts => {
    const d=Math.max(0,Date.now()-Number(ts||0)), m=Math.floor(d/60000);
    if(m<1)return 'now'; if(m<60)return m+'m'; const h=Math.floor(m/60);
    if(h<24)return h+'h'; const days=Math.floor(h/24); return days<30?days+'d':new Date(ts).toLocaleDateString();
  };
  async function renderRealHistory(){
    const body=$('#histBody'); if(!body)return;
    const a=live.get(activeId);
    if(a?._private){
      const msg=document.createElement('div'); msg.style.cssText='padding:24px 12px;text-align:center;color:var(--tx3);font-size:12px;line-height:1.55';
      msg.textContent='History is off in Private browsing. Your regular Breeze history stays outside this session.'; body.replaceChildren(msg); const c=$('#hCount'); if(c)c.textContent='Private'; return;
    }
    const rows=await S.historyList().catch(()=>[]); const frag=document.createDocumentFragment();
    if(!rows.length){ const e=document.createElement('div'); e.style.cssText='padding:24px 12px;text-align:center;color:var(--tx3);font-size:12px'; e.textContent='Pages you visit will appear here. Private browsing never writes to this list.'; frag.append(e); }
    (rows||[]).forEach(r=>{
      const b=document.createElement('button'); b.className='hRow';
      const dot=document.createElement('span'); dot.className='dot';
      const mn=document.createElement('span'); mn.className='mn'; const t=document.createElement('span'); t.className='t'; t.textContent=r.title||dlHost(r.url); const u=document.createElement('span'); u.className='s'; u.textContent=dlHost(r.url); mn.append(t,u);
      const rt=document.createElement('span'); rt.className='rt'; rt.textContent=ageLabel(r.visitedAt); b.append(dot,mn,rt);
      b.onclick=()=>{ closePanels(); if(activeId!=null)S.navigate(activeId,r.url); else S.newTab({url:r.url}); };
      frag.append(b);
    });
    body.replaceChildren(frag); const c=$('#hCount'); if(c)c.textContent=String((rows||[]).length);
  }
  window.renderHistory=renderRealHistory;

  async function renderRealBookmarks(){
    const body=$('#bookmarkBody'); if(!body)return; const rows=await S.bookmarkList().catch(()=>[]); const frag=document.createDocumentFragment();
    const stat=document.createElement('div'); stat.className='pStat'; stat.textContent='Saved locally · available across normal and private browsing'; frag.append(stat);
    if(!rows.length){ const e=document.createElement('div'); e.style.cssText='padding:24px 12px;text-align:center;color:var(--tx3);font-size:12px'; e.textContent='No bookmarks yet. Save the current page with ⌘/Ctrl+D.'; frag.append(e); }
    const grid=document.createElement('div'); grid.className='bGrid';
    (rows||[]).forEach(r=>{
      const card=document.createElement('div'); card.className='bCard'; card.style.position='relative';
      const open=document.createElement('button'); open.style.cssText='all:unset;display:flex;gap:10px;align-items:center;cursor:pointer;width:calc(100% - 24px)';
      const thumb=document.createElement('div'); thumb.className='bThumb'; const f=document.createElement('span'); f.className='f'; f.textContent=(dlHost(r.url)[0]||'B').toUpperCase(); thumb.append(f);
      const meta=document.createElement('div'); meta.className='bMeta'; const h=document.createElement('h4'); h.textContent=r.title||dlHost(r.url); const u=document.createElement('div'); u.className='u'; u.textContent=dlHost(r.url); meta.append(h,u); open.append(thumb,meta);
      open.onclick=()=>{ closePanels(); if(activeId!=null)S.navigate(activeId,r.url); else S.newTab({url:r.url}); };
      const rm=document.createElement('button'); rm.className='iconbtn'; rm.title='Remove bookmark'; rm.textContent='×'; rm.style.cssText+='position:absolute;right:7px;top:7px'; rm.onclick=async e=>{e.stopPropagation(); await S.removeBookmark(r.id); renderRealBookmarks();};
      card.append(open,rm); grid.append(card);
    });
    frag.append(grid); body.replaceChildren(frag); const c=$('#bookmarkCount'); if(c)c.textContent=String((rows||[]).length);
  }
  async function updateBookmarkButton(){
    const b=$('#bookmarkActiveBtn'); if(!b||activeId==null)return; const on=await S.isBookmarked(activeId).catch(()=>false); b.textContent=on?'Saved':'Save page'; b.dataset.saved=on?'1':'0';
  }
  const saveBtn=$('#bookmarkActiveBtn'); if(saveBtn)saveBtn.onclick=async()=>{ if(activeId==null)return; const r=await S.toggleBookmark(activeId); if(r?.error)return toast(r.error); toast(r.saved?'Saved to bookmarks':'Bookmark removed'); await updateBookmarkButton(); await renderRealBookmarks(); };
  document.addEventListener('keydown',async e=>{ if((e.metaKey||e.ctrlKey)&&!e.shiftKey&&e.key.toLowerCase()==='d'){ e.preventDefault(); e.stopImmediatePropagation(); if(activeId!=null){ const r=await S.toggleBookmark(activeId); if(!r?.error)toast(r.saved?'Saved to bookmarks':'Bookmark removed'); updateBookmarkButton(); renderRealBookmarks(); } } },true);

  const _openPanel=window.openPanel;
  window.openPanel=function(name){ const r=_openPanel.apply(this,arguments); if(name==='history')renderRealHistory(); if(name==='bookmarks')renderRealBookmarks(); return r; };
  renderRealBookmarks(); updateBookmarkButton();



  /* ── per-site permissions ──────────────────────────────────────────────── */
  const permissionLabels={media:'camera and microphone',geolocation:'your location',notifications:'notifications','clipboard-read':'clipboard contents',midi:'MIDI devices',pointerLock:'pointer lock',keyboardLock:'keyboard lock','speaker-selection':'speaker selection','window-management':'screen information',fileSystem:'local file access',openExternal:'an external application'};
  const savedPermissions=[];
  function renderPermissionSettings(){
    const host=$('#sitePermRows'); if(!host) return;
    host.replaceChildren();
    if(!savedPermissions.length){ const e=document.createElement('div'); e.style.cssText='font-size:11px;color:var(--tx3);padding:8px 0'; e.textContent='Sites you allow or block will appear here.'; host.append(e); return; }
    savedPermissions.forEach(p=>{
      const r=document.createElement('div'); r.className='sitePermRow';
      const m=document.createElement('div'); m.className='spMain'; const b=document.createElement('b'); b.textContent=p.origin; const st=document.createElement('span'); st.textContent=(permissionLabels[p.permission]||p.permission)+' · '+p.decision; m.append(b,st);
      const reset=document.createElement('button'); reset.textContent='Reset'; reset.onclick=async()=>{await S.resetPermission(p.origin,p.permission); const i=savedPermissions.indexOf(p); if(i>=0)savedPermissions.splice(i,1); renderPermissionSettings();};
      r.append(m,reset); host.append(r);
    });
  }
  async function refreshPermissionSettings(){ const list=await S.listPermissions().catch(()=>[]); savedPermissions.length=0; savedPermissions.push(...(list||[])); renderPermissionSettings(); }
  function showPermissionPrompt(req){
    if(!req?.id||!req.origin) return;
    document.querySelectorAll('.permPrompt').forEach(x=>x.remove());
    const card=document.createElement('div'); card.className='permPrompt'; card.setAttribute('role','dialog'); card.setAttribute('aria-live','polite');
    const head=document.createElement('div'); head.className='ph'; const icon=document.createElement('div'); icon.className='pi'; icon.textContent='◉';
    const copy=document.createElement('div'); const h=document.createElement('h4'); h.textContent=req.host+' wants '+(permissionLabels[req.permission]||req.permission); const p=document.createElement('p');
    const media=req.details?.mediaTypes?.length?' ('+req.details.mediaTypes.join(' + ')+')':''; p.textContent=req.private?('Private browsing: Breeze will only grant this to '+req.origin+media+'. Nothing is remembered after the private session ends.'):('Breeze will only grant this to '+req.origin+media+'. You can allow it once, remember it, or block it.'); copy.append(h,p); head.append(icon,copy);
    const acts=document.createElement('div'); acts.className='pa';
    const respond=async decision=>{ await S.respondPermission(req.id,decision); card.remove(); await refreshPermissionSettings(); };
    const block=document.createElement('button'); block.textContent='Block'; block.onclick=()=>respond('block');
    const once=document.createElement('button'); once.textContent='Allow once'; once.onclick=()=>respond('once');
    const always=document.createElement('button'); always.className='allow'; always.textContent=req.private?'Allow this private session':'Always allow'; always.onclick=()=>respond('always');
    acts.append(block,once,always); card.append(head,acts); document.body.append(card);
  }
  S.on('permission:request',showPermissionPrompt); refreshPermissionSettings();


  /* Screen sharing gets its own chooser instead of borrowing camera/mic
     permission. Electron uses the OS picker where supported; this UI is the
     secure fallback for platforms that need Breeze to choose a source. */
  function showDisplayPrompt(req){
    if(!req?.id||!Array.isArray(req.sources))return;
    document.querySelectorAll('.sharePrompt').forEach(x=>x.remove());
    const card=document.createElement('div'); card.className='permPrompt sharePrompt'; card.setAttribute('role','dialog');
    card.style.cssText+='width:min(440px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 48px));overflow:hidden;display:flex;flex-direction:column';
    const head=document.createElement('div'); head.className='ph'; const icon=document.createElement('div'); icon.className='pi'; icon.textContent='▣';
    const copy=document.createElement('div'); const h=document.createElement('h4'); h.textContent='Share a screen with '+req.host; const p=document.createElement('p'); p.textContent='Choose exactly what this site may see. Breeze does not remember the choice.'; copy.append(h,p); head.append(icon,copy); card.append(head);
    const list=document.createElement('div'); list.style.cssText='overflow:auto;padding:4px 0 8px;display:grid;gap:6px';
    req.sources.slice(0,30).forEach(src=>{ const b=document.createElement('button'); b.className='row'; b.style.cssText='width:100%;text-align:left'; const i=document.createElement('span'); i.className='ic'; i.textContent=src.type==='screen'?'▣':'□'; const mn=document.createElement('span'); mn.className='mn'; const t=document.createElement('span'); t.className='t'; t.textContent=src.name; const st=document.createElement('span'); st.className='s'; st.textContent=src.type==='screen'?'Entire display':'Application window'; mn.append(t,st); b.append(i,mn); b.onclick=async()=>{await S.respondDisplayShare(req.id,src.id);card.remove();}; list.append(b); });
    const foot=document.createElement('div'); foot.className='pa'; const cancel=document.createElement('button'); cancel.textContent='Cancel'; cancel.onclick=async()=>{await S.cancelDisplayShare(req.id);card.remove();}; foot.append(cancel);
    card.append(list,foot); document.body.append(card);
  }
  S.on('display:request',showDisplayPrompt);

  /* ── geometry ────────────────────────────────────────────────────────────
     The renderer owns layout; the main process owns view bounds. We measure
     the real gap the chrome leaves and report it, so the page sits exactly
     where the design says it should — including when the sidebar collapses
     or a panel opens.                                                      */
  function reportGeometry(){
    const c = document.querySelector('#content');
    if (!c) return;
    const r = c.getBoundingClientRect();
    S.reportGeometry({
      top: Math.round(r.top),
      side: Math.round(r.left),
      panel: Math.round(Math.max(0, innerWidth - r.right))
    });
  }
  function syncChromeSurface(){
    S.setInternalView(root.dataset.view !== 'browse');
    reportGeometry();
  }
  const ro = new ResizeObserver(() => reportGeometry());
  const contentEl = document.querySelector('#content');
  if (contentEl) ro.observe(contentEl);
  addEventListener('resize', reportGeometry);
  new MutationObserver(syncChromeSurface).observe(root, { attributes: true,
    attributeFilter: ['data-rail', 'data-compact', 'data-density', 'data-view', 'data-tabs'] });

  /* ── boot ────────────────────────────────────────────────────────────────
     Drop the mock tabs. Switch to the browse layout immediately: real page
     content needs the browse chrome to exist, otherwise there is no gap to
     position the WebContentsView into and it would render at 0,0 under the
     toolbar. */
  GROUPS.length = 0;
  if (typeof setView === 'function') setView('browse');
  S.setInternalView(false);
  repaint();
  reportGeometry();

  S.version().then(v => {
    const el2 = $('#aboutVer');
    if (el2) el2.textContent = 'Version ' + VERSION.number + ' · Chromium ' + v.chrome;
    const chip = $('#aboutShell');
    if (chip){ chip.textContent = 'Breeze app'; chip.dataset.shell = '1'; }
  });

  // The main process restores the previous tab set after the chrome is ready.
  setTimeout(reportGeometry, 120);
})();
