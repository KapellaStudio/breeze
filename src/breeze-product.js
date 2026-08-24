/* Breeze packaged-product bindings.
   Removes prototype-only state and binds persistent preferences/workspaces to
   the trusted desktop shell. */
(function(){
  'use strict';
  const S=window.__BREEZE_SHELL__;
  if(!S||!S.isShell)return;
  const root=document.documentElement;
  const $=s=>document.querySelector(s);
  const $$=s=>[...document.querySelectorAll(s)];

  const style=document.createElement('style');
  style.textContent=`
    .wsRealRow{cursor:pointer}.wsManage,.wsRemove{width:25px;height:25px;display:grid;place-items:center;border-radius:7px;color:var(--tx3);flex:0 0 auto}.wsManage:hover{background:var(--bg3);color:var(--tx1)}.wsRemove:hover{background:color-mix(in srgb,var(--bad) 12%,transparent);color:var(--bad)}
    .wsRealNote{padding:9px 11px 5px;font-size:10.5px;line-height:1.45;color:var(--tx3)}
    [data-shell-disabled="1"]{opacity:.45!important;pointer-events:none!important}
    [data-sidebar="off"] .side{display:none!important}
    [data-tint="0"] .tab{--site:100 116 139!important}
    [data-group="0"] .grpHead{display:none!important}
    [data-group="0"] .group{margin-bottom:0!important}
    [data-group="0"] .grpTabs{height:auto!important}
  `;
  document.head.append(style);

  /* ── persistent chrome preferences ──────────────────────────────────── */
  const ATTR_TO_PREF={theme:'theme',accent:'accent',density:'density',tabs:'tabs',newtab:'newtab',comfort:'comfort',compact:'compact'};
  const SWITCH_TO_PREF={sleep:'sleep',tint:'tint',group:'group',askwhere:'askwhere',prov:'provenance',ver:'versionDetection'};
  let restoring=true;
  let prefTimer=null;
  let cachedPreferences=null;

  function effectiveTheme(v){return v==='auto'?window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light':v;}
  function paintSegment(group,value){const g=document.querySelector(`[data-seg="${group}"]`);if(g)[...g.children].forEach(c=>c.setAttribute('aria-pressed',String(c.dataset.v===value)));}
  function applySidebar(value){
    const v=['on','auto','off'].includes(value)?value:'on';
    root.dataset.sidebar=v;
    root.dataset.rail=v==='auto'?'1':'0';
    paintSegment('rail',v);
    const g=document.querySelector('[data-seg="rail"]');
    if(g){
      const auto=g.querySelector('[data-v="auto"]');if(auto)auto.textContent='Rail';
      const row=g.closest('.setRow');const d=row?.querySelector('.d');if(d)d.textContent='Full sidebar, a compact favicon rail, or completely hidden.';
    }
  }
  function applyPreferences(p){
    if(!p||p.error)return;
    cachedPreferences={...p};
    root.dataset.theme=effectiveTheme(p.theme);
    root.dataset.accent=p.accent;
    root.dataset.density=p.density;
    root.dataset.tabs=p.tabs;
    root.dataset.newtab=p.newtab;
    root.dataset.comfort=p.comfort;
    root.dataset.compact=p.compact?'1':'0';
    root.dataset.tint=p.tint?'1':'0';
    root.dataset.group=p.group?'1':'0';
    applySidebar(p.sidebar);
    ['theme','density','tabs','newtab','comfort'].forEach(k=>paintSegment(k,p[k]));
    $$('[data-accents] button[data-a]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.a===p.accent)));
    const accentName=$('#accName');if(accentName){const names={blue:'Breeze Blue',cyan:'Sky Cyan',teal:'Ocean Teal',mint:'Aqua Mint'};accentName.textContent=names[p.accent]||p.accent;}
    $$('[data-pref]').forEach(sw=>{const key=SWITCH_TO_PREF[sw.dataset.pref];if(key&&typeof p[key]==='boolean')sw.setAttribute('aria-checked',String(p[key]));});
    const compact=$('#compactBtn');if(compact)compact.setAttribute('aria-pressed',String(!!p.compact));
  }
  function persistRoot(){
    if(restoring)return;
    clearTimeout(prefTimer);
    prefTimer=setTimeout(()=>{
      const patch={};
      for(const [attr,key] of Object.entries(ATTR_TO_PREF)){
        let v=root.dataset[attr];
        if(attr==='compact')v=v==='1';
        if(attr==='theme')v=document.querySelector('[data-seg="theme"] [aria-pressed="true"]')?.dataset.v||cachedPreferences?.theme||v;
        patch[key]=v;
      }
      S.setPreferences(patch).then(r=>{if(r?.preferences)cachedPreferences=r.preferences;}).catch(()=>{});
    },80);
  }
  S.getPreferences().then(p=>{applyPreferences(p);restoring=false;persistRoot();}).catch(()=>{restoring=false;});
  new MutationObserver(persistRoot).observe(root,{attributes:true,attributeFilter:Object.keys(ATTR_TO_PREF).map(k=>'data-'+k)});

  document.addEventListener('click',e=>{
    const rail=e.target.closest('[data-seg="rail"] [data-v]');
    if(rail){
      const value=rail.dataset.v;setTimeout(()=>{applySidebar(value);S.setPreference('sidebar',value).then(r=>{if(r?.preferences)cachedPreferences=r.preferences;}).catch(()=>{});},0);return;
    }
    const sw=e.target.closest('[data-pref]');if(!sw)return;
    const key=SWITCH_TO_PREF[sw.dataset.pref];if(!key)return;
    setTimeout(()=>{
      const value=sw.getAttribute('aria-checked')==='true';
      if(key==='tint')root.dataset.tint=value?'1':'0';
      if(key==='group')root.dataset.group=value?'1':'0';
      S.setPreference(key,value).then(r=>{if(r?.preferences)cachedPreferences=r.preferences;}).catch(()=>{});
    },0);
  },true);

  /* ── real persistent workspaces ──────────────────────────────────────── */
  const workspaceMap=new Map();
  let activeWorkspace='default';
  let accentCursor=0;
  const accents=['blue','cyan','teal','mint'];
  function workspaceLabel(ws){return ws?.name||'Personal';}
  function applyWorkspaceIdentity(ws){
    if(!ws)return;
    $$('.wsName').forEach(n=>n.textContent=workspaceLabel(ws));
    const id=$('#sideId');
    if(id){
      const chip=id.querySelector('.wsId');const txt=id.querySelector('span:last-child');
      if(chip){chip.className='wsId'+(ws.sealed?' sealed':'');chip.textContent=ws.sealed?'🔒':'B';}
      if(txt)txt.textContent=ws.sealed?'Sealed workspace · isolated session':'Local workspace';
      id.title=ws.sealed?'Separate cookies, storage and cache':'Uses the main Breeze browser session';
    }
    root.dataset.sealed=ws.sealed?'1':'0';
  }
  async function switchWorkspace(id){
    const ws=workspaceMap.get(id);if(!ws)return;
    const tabs=await S.listTabs().catch(()=>[]);const hit=(tabs||[]).find(t=>!t.private&&t.workspace===id);
    if(hit)await S.selectTab(hit.id);else await S.newTab({workspaceId:id,sealed:!!ws.sealed});
    activeWorkspace=id;applyWorkspaceIdentity(ws);renderWorkspaceMenu();const menu=$('#wsMenu');if(menu)menu.dataset.on='0';
  }
  async function createWorkspace(sealed){
    const name=prompt(sealed?'Name this sealed workspace':'Name this workspace',sealed?'Separate account':'New workspace');if(!name||!name.trim())return;
    const accent=accents[++accentCursor%accents.length];const r=await S.createWorkspace({name:name.trim(),sealed:!!sealed,accent});
    if(r?.error){if(typeof toast==='function')toast(r.error);return;}await refreshWorkspaces();await switchWorkspace(r.workspace.id);if(typeof toast==='function')toast((sealed?'Sealed workspace ':'Workspace ')+r.workspace.name+' created');
  }
  async function renameWorkspace(id){
    const ws=workspaceMap.get(id);if(!ws)return;const renamed=prompt('Rename workspace',ws.name);if(!renamed||!renamed.trim()||renamed.trim()===ws.name)return;
    const r=await S.updateWorkspace(id,{name:renamed.trim()});if(r?.error){if(typeof toast==='function')toast(r.error);return;}await refreshWorkspaces();if(id===activeWorkspace)applyWorkspaceIdentity(workspaceMap.get(id));
  }
  async function removeWorkspace(id){
    if(id==='default')return;const ws=workspaceMap.get(id);if(!ws)return;const tabs=await S.listTabs().catch(()=>[]);
    if((tabs||[]).some(t=>t.workspace===id)){if(typeof toast==='function')toast('Close this workspace’s tabs before deleting it');return;}
    if(!confirm(`Delete “${ws.name}” from Breeze? This does not delete website accounts or downloaded files.`))return;
    const r=await S.removeWorkspace(id);if(r?.error){if(typeof toast==='function')toast(r.error);return;}await refreshWorkspaces();
  }
  function renderWorkspaceMenu(){
    const menu=$('#wsMenu');if(!menu)return;const frag=document.createDocumentFragment();
    for(const ws of workspaceMap.values()){
      const row=document.createElement('div');row.className='wsRow wsRealRow';row.dataset.realWorkspace=ws.id;row.setAttribute('aria-selected',String(ws.id===activeWorkspace));row.setAttribute('role','button');row.tabIndex=0;
      const dot=document.createElement('span');dot.className='d';dot.style.background={blue:'#2563EB',cyan:'#22D3EE',teal:'#0891B2',mint:'#7EF3D6'}[ws.accent]||'#2563EB';
      const main=document.createElement('span');main.className='main';const t=document.createElement('span');t.className='t';t.textContent=ws.name;const s=document.createElement('span');s.className='s';s.textContent=ws.sealed?'Sealed · separate cookies, storage and cache':'Local workspace';main.append(t,s);
      const badge=document.createElement('span');badge.className='wsId'+(ws.sealed?' sealed':'');badge.textContent=ws.sealed?'🔒':'B';
      const rename=document.createElement('button');rename.className='wsManage';rename.type='button';rename.dataset.renameWorkspace=ws.id;rename.title='Rename workspace';rename.textContent='✎';row.append(dot,main,badge,rename);
      if(ws.id!=='default'){const remove=document.createElement('button');remove.className='wsRemove';remove.type='button';remove.dataset.removeWorkspace=ws.id;remove.title='Delete workspace';remove.textContent='×';row.append(remove);}frag.append(row);
    }
    frag.append(document.createElement('hr'));
    const add=document.createElement('button');add.className='wsNew';add.dataset.createWorkspace='normal';add.textContent='+ New workspace';frag.append(add);
    const seal=document.createElement('button');seal.className='wsNew';seal.dataset.createWorkspace='sealed';seal.textContent='🔒 New sealed workspace';frag.append(seal);
    const note=document.createElement('div');note.className='wsRealNote';note.textContent='Sealed workspaces use a separate Chromium session. Breeze does not invent or store an account identity; sign in to websites normally inside that workspace.';frag.append(note);menu.replaceChildren(frag);
  }
  async function refreshWorkspaces(){const rows=await S.listWorkspaces().catch(()=>[]);workspaceMap.clear();(rows||[]).forEach(w=>workspaceMap.set(w.id,w));if(!workspaceMap.has(activeWorkspace))activeWorkspace='default';applyWorkspaceIdentity(workspaceMap.get(activeWorkspace)||workspaceMap.get('default'));renderWorkspaceMenu();}
  const menu=$('#wsMenu');
  if(menu){
    menu.addEventListener('click',e=>{const rename=e.target.closest('[data-rename-workspace]');if(rename){e.preventDefault();e.stopImmediatePropagation();renameWorkspace(rename.dataset.renameWorkspace);return;}const remove=e.target.closest('[data-remove-workspace]');if(remove){e.preventDefault();e.stopImmediatePropagation();removeWorkspace(remove.dataset.removeWorkspace);return;}const create=e.target.closest('[data-create-workspace]');if(create){e.preventDefault();e.stopImmediatePropagation();createWorkspace(create.dataset.createWorkspace==='sealed');return;}const row=e.target.closest('[data-real-workspace]');if(row){e.preventDefault();e.stopImmediatePropagation();switchWorkspace(row.dataset.realWorkspace);}},true);
    menu.addEventListener('keydown',e=>{const row=e.target.closest('[data-real-workspace]');if(row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();switchWorkspace(row.dataset.realWorkspace);}},true);
  }
  S.on('tab:update',st=>{if(st?.active&&!st.private){activeWorkspace=String(st.workspace||'default');applyWorkspaceIdentity(workspaceMap.get(activeWorkspace)||workspaceMap.get('default'));renderWorkspaceMenu();}});
  refreshWorkspaces();

  /* ── remove prototype claims from packaged app ───────────────────────── */
  const sleepStat=document.querySelector('.sleepStat');if(sleepStat)sleepStat.style.display='none';
  $$('.aboutFacts .fact').forEach(f=>{const key=f.querySelector('.k')?.textContent?.trim();if(key==='Security'){const v=f.querySelector('.v');if(v)v.textContent='41 of 41';const d=f.querySelector('.d');if(d)d.textContent='Browser-chrome attack vectors blocked by the repository security gate.';}});
  $$('.nativeCard').forEach(c=>{const name=c.querySelector('.nm')?.textContent?.trim();if(name==='Document workspace'){const st=c.querySelector('.st');if(st)st.textContent='Ready · local PDF tools';}});
  $$('[data-flow-tool="document"] p').forEach(p=>p.textContent='Open PDFs locally, then split, merge, rotate and extract pages without uploading the document.');
})();
