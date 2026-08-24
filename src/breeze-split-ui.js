/* Breeze Split View chrome.
   Runs only in packaged Breeze. The actual pages remain native WebContentsView
   renderers owned by main.js; this module only paints the toolbar state and the
   narrow divider that lives in the gap between those native views. */
(function(){
  'use strict';
  const S=window.__BREEZE_SHELL__;
  if(!S||!S.isShell)return;
  const $=s=>document.querySelector(s);
  const clamp=n=>Math.max(.25,Math.min(.75,Number(n)||.5));
  let split={active:false,leftTabId:null,rightTabId:null,focusedTabId:null,ratio:.5};
  let tabs=[];
  let divider=null;
  let dragFrame=0;

  const style=document.createElement('style');
  style.textContent=`
    .breezeSplitDivider{position:fixed;width:10px;display:none;z-index:2147483000;cursor:col-resize;touch-action:none;background:linear-gradient(180deg,transparent 0%,color-mix(in srgb,var(--accent) 28%,transparent) 18%,color-mix(in srgb,var(--accent) 52%,transparent) 50%,color-mix(in srgb,var(--accent) 28%,transparent) 82%,transparent 100%)}
    .breezeSplitDivider::before{content:"";position:absolute;left:3px;top:calc(50% - 28px);width:4px;height:56px;border-radius:999px;background:color-mix(in srgb,var(--accent) 55%,var(--line));box-shadow:0 0 18px color-mix(in srgb,var(--accent) 28%,transparent)}
    .breezeSplitDivider[data-drag="1"]::before{background:var(--accent);box-shadow:0 0 24px color-mix(in srgb,var(--accent) 42%,transparent)}
    #splitBtn[data-real-split="1"][data-on="1"]{background:color-mix(in srgb,var(--accent) 13%,transparent);color:var(--accent)}
  `;
  document.head.append(style);

  function eligible(t){return !!t&&!t.private&&t.kind==='page';}
  function activeTab(){return tabs.find(t=>t.id===split.focusedTabId)||tabs.find(t=>t.active)||null;}

  function ensureDivider(){
    if(divider)return divider;
    divider=document.createElement('div');
    divider.className='breezeSplitDivider';
    divider.setAttribute('role','separator');
    divider.setAttribute('aria-orientation','vertical');
    divider.setAttribute('aria-label','Resize Split View');
    divider.title='Drag to resize · double-click to swap sides';
    document.body.append(divider);

    divider.addEventListener('dblclick',async()=>{
      const r=await S.swapSplit().catch(()=>null);
      if(r&&!r.error){split=r;paint();}
    });
    divider.addEventListener('pointerdown',e=>{
      if(!split.active)return;
      e.preventDefault();divider.dataset.drag='1';
      try{divider.setPointerCapture(e.pointerId);}catch{}
      const move=ev=>{
        const content=$('#content');if(!content)return;
        const r=content.getBoundingClientRect();
        const next=clamp((ev.clientX-r.left-5)/Math.max(1,r.width-10));
        split={...split,ratio:next};paintDivider();
        if(!dragFrame){
          dragFrame=requestAnimationFrame(()=>{dragFrame=0;S.setSplitRatio(split.ratio).catch(()=>{});});
        }
      };
      const done=()=>{divider.dataset.drag='0';window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',done,true);window.removeEventListener('pointercancel',done,true);S.setSplitRatio(split.ratio).catch(()=>{});};
      window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',done,true);window.addEventListener('pointercancel',done,true);
    });
    return divider;
  }

  function paintDivider(){
    const d=ensureDivider();
    if(!split.active){d.style.display='none';return;}
    const content=$('#content');if(!content){d.style.display='none';return;}
    const r=content.getBoundingClientRect();
    const left=Math.round(r.left+Math.max(0,r.width-10)*clamp(split.ratio));
    d.style.display='block';d.style.left=left+'px';d.style.top=Math.round(r.top)+'px';d.style.height=Math.max(0,Math.round(r.height))+'px';
    d.setAttribute('aria-valuemin','25');d.setAttribute('aria-valuemax','75');d.setAttribute('aria-valuenow',String(Math.round(clamp(split.ratio)*100)));
  }

  function paintButton(){
    const b=$('#splitBtn');if(!b)return;
    b.style.removeProperty('display');b.dataset.realSplit='1';b.dataset.on=split.active?'1':'0';
    b.setAttribute('aria-pressed',split.active?'true':'false');
    b.title=split.active?'Close Split View':'Open two real pages side by side';
  }
  function paint(){paintButton();paintDivider();}

  async function toggleSplit(){
    if(split.active){
      const r=await S.closeSplit().catch(()=>null);if(r&&!r.error){split=r;paint();}return;
    }
    let primary=activeTab();
    if(!eligible(primary)){if(typeof toast==='function')toast('Split View works with web tabs');return;}
    let other=[...tabs].reverse().find(t=>t.id!==primary.id&&eligible(t));
    if(!other){
      const created=await S.newTab({}).catch(()=>null);
      if(typeof created!=='number'){if(typeof toast==='function')toast('Could not create a second pane');return;}
      await S.selectTab(primary.id).catch(()=>{});
      tabs=await S.listTabs().catch(()=>tabs);
      other=tabs.find(t=>t.id===created)||{id:created,kind:'page',private:false};
    }
    const r=await S.openSplit(other.id).catch(()=>null);
    if(!r||r.error){if(typeof toast==='function')toast(r?.error||'Could not open Split View');return;}
    split=r;paint();
  }

  function wireButton(){
    const old=$('#splitBtn');if(!old)return;
    // Clone away the old prototype listener before installing the native action.
    const b=old.cloneNode(true);old.replaceWith(b);
    b.onclick=e=>{e.preventDefault();e.stopPropagation();toggleSplit();};
    paintButton();
  }

  S.on('split:update',st=>{if(st&&typeof st==='object'){split={...split,...st};paint();}});
  S.on('tab:update',st=>{if(!st)return;const i=tabs.findIndex(t=>t.id===st.id);if(i>=0)tabs[i]={...tabs[i],...st};else tabs.push(st);if(st.active&&!split.active)split.focusedTabId=st.id;});
  S.on('tab:closed',({id})=>{tabs=tabs.filter(t=>t.id!==id);});
  addEventListener('resize',paintDivider);
  new ResizeObserver(paintDivider).observe($('#content')||document.documentElement);

  Promise.all([S.listTabs(),S.splitState()]).then(([rows,state])=>{
    tabs=Array.isArray(rows)?rows:[];
    if(state&&typeof state==='object')split={...split,...state};
    wireButton();paint();
    try{
      if(typeof COMMANDS!=='undefined'&&!COMMANDS.some(c=>c?.t==='Split View')){
        COMMANDS.push({t:'Split View',u:'Two real Chromium pages side by side',k:'⇧ S',run:toggleSplit});
      }
    }catch{}
  }).catch(()=>wireButton());
})();
