/* Breeze full-product UX pass.
   Goal: preserve Breeze's power while making the default daily-driver surface
   feel familiar, immediate and quiet. Advanced tools remain one click away. */
(function(){
  'use strict';
  const S=window.__BREEZE_SHELL__;
  if(!S||!S.isShell)return;
  const root=document.documentElement;
  const $=s=>document.querySelector(s);

  const style=document.createElement('style');
  style.textContent=`
    /* One continuous browser: New Tab keeps the same top chrome users browse with. */
    [data-shell="1"][data-view="home"] .chrome.v-browse{display:flex!important}
    [data-shell="1"][data-view="home"] .homebar{display:none!important}
    [data-shell="1"][data-view="home"] .stage{padding-top:18px}
    [data-shell="1"] .chrome{gap:8px;padding-inline:10px}
    [data-shell="1"] .omniwrap{justify-content:stretch}
    [data-shell="1"] .omnibar{width:min(760px,100%)}
    [data-shell="1"] .brand span{display:none}
    [data-shell="1"] .sideId{display:none!important}
    [data-shell="1"] .tabsearch .kbd{display:none!important}

    /* Default toolbar = familiar browser essentials. Breeze power lives in Tools.
       Original controls stay mounted/live for their existing wiring and automated
       contracts, but are moved out of the toolbar and visually parked inside Tools. */
    .bzLegacyControl{position:absolute!important;width:1px!important;height:1px!important;min-width:0!important;min-height:0!important;padding:0!important;margin:0!important;opacity:0!important;pointer-events:none!important;overflow:hidden!important;clip-path:inset(50%)!important}
    #breezeToolsBtn{position:relative}
    .bzToolsPop{position:fixed;z-index:140;width:250px;padding:7px;border:1px solid var(--line);border-radius:13px;background:var(--bg1);box-shadow:var(--shPop);display:none}
    .bzToolsPop[data-on="1"]{display:block}
    .bzToolsRow{width:100%;display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;text-align:left;color:var(--tx2);font-size:12.5px}
    .bzToolsRow:hover{background:var(--bg2);color:var(--tx1)}
    .bzToolsIc{width:25px;height:25px;display:grid;place-items:center;border-radius:8px;background:var(--bg2);color:var(--accentTx);font-size:11px;font-weight:700}
    .bzToolsMain{flex:1}.bzToolsMain b{display:block;color:var(--tx1);font-size:12.5px}.bzToolsMain span{display:block;color:var(--tx3);font-size:10.5px;margin-top:1px}

    /* Familiar New Tab affordance in the tab rail. */
    .bzNewTab{margin:2px 8px 8px;width:calc(100% - 16px);height:32px;display:flex;align-items:center;gap:8px;padding:0 9px;border-radius:8px;color:var(--tx2);font-size:11.5px}
    .bzNewTab:hover{background:var(--bg2);color:var(--tx1)}
    [data-rail="1"] .bzNewTab{width:38px;margin-inline:auto;justify-content:center;padding:0}
    [data-rail="1"] .bzNewTab span:last-child{display:none}

    /* Immediate navigation feedback. The line starts on navigation intent, not after paint. */
    .bzNavProgress{position:absolute;left:0;right:0;bottom:-1px;height:2px;overflow:hidden;pointer-events:none;opacity:0;transition:opacity .12s var(--ease)}
    .bzNavProgress i{display:block;width:38%;height:100%;background:var(--accent);transform:translateX(-110%)}
    [data-navbusy="1"] .bzNavProgress{opacity:1}
    [data-navbusy="1"] .bzNavProgress i{animation:bzNavRun 1.05s ease-in-out infinite}
    @keyframes bzNavRun{0%{transform:translateX(-110%)}65%{transform:translateX(180%)}100%{transform:translateX(285%)}}
    [data-navbusy="1"] .omnibar{border-color:var(--accentLine)}

    /* Central search is still useful, but feels like the same omnibox rather than another app. */
    [data-shell="1"] .bigsearch{height:52px;box-shadow:inset 0 1px 0 var(--anchor),var(--sh2)}
    [data-shell="1"] .bigsearch input{font-size:14px}
    [data-shell="1"] .hero{max-width:600px}
    [data-shell="1"] .mark{width:64px;height:64px}
    [data-shell="1"] .wordmark{font-size:29px}
    [data-shell="1"] .subword{letter-spacing:3.5px}
  `;
  document.head.append(style);

  function showHome(){
    try{if(typeof closeAll==='function')closeAll();if(typeof setView==='function')setView('home');}catch{}
    S.setInternalView(true).catch(()=>{});
    setTimeout(()=>$('.bigsearch input')?.focus(),0);
  }
  function showBrowseNow(){
    try{if(typeof closeAll==='function')closeAll();if(typeof setView==='function')setView('browse');root.dataset.kind='page';}catch{}
    S.setInternalView(false).catch(()=>{});
  }

  /* Make Home search transition before the network round-trip. The previous
     implementation awaited loadURL before changing views, which made a normal
     search feel frozen on slower pages. */
  window.addEventListener('keydown',async e=>{
    const input=e.target?.matches?.('.bigsearch input')?e.target:null;
    if(!input||e.key!=='Enter')return;
    const value=input.value.trim();if(!value)return;
    e.preventDefault();e.stopImmediatePropagation();
    showBrowseNow();
    root.dataset.navbusy='1';
    const tabs=await S.listTabs().catch(()=>[]);const active=(tabs||[]).find(t=>t.active);
    if(active?.id!=null)S.navigate(active.id,value).catch(()=>{});else S.newTab({url:value}).catch(()=>{});
    input.value='';
  },true);

  /* Using the top omnibox from New Tab should also reveal the page immediately. */
  window.addEventListener('keydown',e=>{
    if(root.dataset.view!=='home'||e.target?.id!=='omniInput'||e.key!=='Enter')return;
    if(!String(e.target.value||'').trim())return;
    requestAnimationFrame(showBrowseNow);
  },true);

  /* Quiet default toolbar. */
  const secondary=[
    ['.tools [data-panel="queue"]','Queue','Save pages to finish later','Q'],
    ['.tools [data-panel="notes"]','Notes','Notes tied to what you browse','N'],
    ['.tools [data-panel="snapshots"]','Snapshots','Restore a workspace state','S'],
    ['#flowBtn','Breeze Flow','Convert files locally','F'],
    ['#splitBtn','Split View','Two real pages side by side','2'],
    ['#compactBtn','Compact sidebar','Give the page more room','C'],
    ['#extBtn','Extensions','Manage browser extensions','E'],
    ['.tools [data-theme-toggle]','Appearance','Light, dark or system theme','A']
  ];
  const tools=$('.tools');
  const divider=tools?.querySelector('.divider');
  const toolsBtn=document.createElement('button');
  const pop=document.createElement('div');
  if(tools&&divider){
    toolsBtn.id='breezeToolsBtn';toolsBtn.className='iconbtn';toolsBtn.title='Breeze tools';toolsBtn.setAttribute('aria-label','Breeze tools');toolsBtn.setAttribute('aria-expanded','false');
    toolsBtn.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 8h5V3M20 16h-5v5M15 3v5h5M9 21v-5H4"/><path d="M9 8l6 8M15 8l-6 8"/></svg>';
    divider.before(toolsBtn);
    pop.className='bzToolsPop';pop.id='breezeToolsPop';document.body.append(pop);
    const addRow=(selector,title,desc,icon)=>{
      const original=$(selector);if(!original)return;
      const row=document.createElement('button');row.className='bzToolsRow';
      row.innerHTML=`<span class="bzToolsIc">${icon}</span><span class="bzToolsMain"><b>${title}</b><span>${desc}</span></span>`;
      row.onclick=()=>{pop.dataset.on='0';toolsBtn.setAttribute('aria-expanded','false');original.click();};
      pop.append(row);
      original.classList.add('bzLegacyControl');
      pop.append(original);
    };
    secondary.forEach(x=>addRow(...x));
    toolsBtn.onclick=e=>{e.stopPropagation();const on=pop.dataset.on==='1';pop.dataset.on=on?'0':'1';toolsBtn.setAttribute('aria-expanded',String(!on));if(!on){const r=toolsBtn.getBoundingClientRect();pop.style.top=(r.bottom+7)+'px';pop.style.left=Math.max(8,Math.min(innerWidth-pop.offsetWidth-8,r.right-250))+'px';}};
    document.addEventListener('click',e=>{if(!e.target.closest('#breezeToolsBtn,#breezeToolsPop')){pop.dataset.on='0';toolsBtn.setAttribute('aria-expanded','false');}});
    addEventListener('resize',()=>{pop.dataset.on='0';toolsBtn.setAttribute('aria-expanded','false');});
  }

  /* New Tab where users look for it: in the tab rail. */
  const tabList=$('#tablist');
  if(tabList&&!$('#breezeSideNewTab')){
    const b=document.createElement('button');b.id='breezeSideNewTab';b.className='bzNewTab';b.innerHTML='<span style="font-size:17px;line-height:1">+</span><span>New tab</span>';
    b.onclick=async()=>{await S.newTab({}).catch(()=>null);showHome();};
    tabList.after(b);
  }

  /* Navigation intent and completion are visible immediately. */
  const chrome=$('.chrome');
  if(chrome&&!$('#breezeNavProgress')){
    const p=document.createElement('span');p.id='breezeNavProgress';p.className='bzNavProgress';p.setAttribute('aria-hidden','true');p.innerHTML='<i></i>';chrome.append(p);
  }
  let activeId=null;
  S.on('tab:update',st=>{if(st?.active){activeId=st.id;if(root.dataset.view==='home'&&!st.url){const u=$('#urlText');if(u)u.textContent='Search or enter address';}}});
  S.on('tab:loading',ev=>{if(ev?.id!==activeId)return;root.dataset.navbusy=ev.loading?'1':'0';});
  S.on('tab:error',()=>{root.dataset.navbusy='0';});

  /* The prototype once showed a fake signed-in identity. Packaged Breeze has
     no account requirement, so the rail must not imply one. */
  const identity=$('.sideId');if(identity)identity.remove();

  /* Preserve the familiar logo behavior: it opens New Tab rather than acting
     like a mysterious app-mode switch. */
  const brand=$('.brand[data-home]');
  if(brand){brand.title='New tab';brand.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();S.newTab({}).then(showHome).catch(showHome);},true);}
})();
