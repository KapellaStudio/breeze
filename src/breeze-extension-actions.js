/* Breeze extension action surface.
   Keeps extension UI out of page content: toolbar actions call one named preload
   method, and the main-process extension registry opens the declared popup in
   the extension's own persistent session. */
(function(){
  'use strict';
  const S = window.__BREEZE_SHELL__;
  if (!S || !S.isShell || typeof S.listExtensions !== 'function' || typeof S.openExtensionAction !== 'function') return;

  const button = document.getElementById('extBtn');
  const list = document.getElementById('epList');
  if (!button || !list) return;

  const style = document.createElement('style');
  style.textContent = `
    #epList .breezeExtActionRow{display:grid;grid-template-columns:28px minmax(0,1fr) auto auto;align-items:center;gap:8px}
    #epList .breezeExtActionRow .breezeExtMeta{min-width:0;display:flex;flex-direction:column;gap:2px}
    #epList .breezeExtActionRow .breezeExtName{font-size:11.5px;color:var(--tx1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #epList .breezeExtActionRow .breezeExtTier{font-size:8.5px;color:var(--tx3);text-transform:uppercase;letter-spacing:.08em}
    #epList .breezeExtOpen{border:1px solid var(--line2);background:var(--bg2);color:var(--tx2);border-radius:9px;padding:5px 8px;font:inherit;font-size:9.5px;cursor:pointer}
    #epList .breezeExtOpen:hover{color:var(--tx1);border-color:var(--line)}
    #epList .breezeExtOpen:disabled{opacity:.45;cursor:default}
  `;
  document.head.appendChild(style);

  const initials = name => {
    const bits=String(name||'E').trim().split(/\s+/).filter(Boolean);
    return (bits.length>1 ? bits[0][0]+bits[1][0] : (bits[0]||'E').slice(0,2)).toUpperCase();
  };
  const note = text => {
    if (typeof window.toast === 'function') window.toast(text);
    else console.info('[Breeze extensions]', text);
  };

  async function renderActionList(){
    let rows=[];
    try { rows = await S.listExtensions() || []; }
    catch { rows=[]; }
    list.replaceChildren();
    if (!rows.length){
      const empty=document.createElement('div');
      empty.style.cssText='padding:18px 10px;text-align:center;color:var(--tx3);font-size:12px';
      empty.textContent='No compatible extensions installed';
      list.appendChild(empty);
      return;
    }

    for (const ext of rows){
      const row=document.createElement('div');
      row.className='epRow breezeExtActionRow';

      const ic=document.createElement('span');
      ic.className='ic'; ic.textContent=initials(ext.name);
      row.appendChild(ic);

      const meta=document.createElement('span'); meta.className='breezeExtMeta';
      const name=document.createElement('span'); name.className='breezeExtName'; name.textContent=ext.name || 'Extension';
      const tier=document.createElement('span'); tier.className='breezeExtTier';
      tier.textContent=(ext.backgroundKind==='mv3-service-worker'?'MV3 · ':'') + (ext.compatibility || 'uncertified');
      meta.append(name,tier); row.appendChild(meta);

      if (ext.hasActionPopup){
        const open=document.createElement('button');
        open.type='button'; open.className='breezeExtOpen'; open.textContent='Open';
        open.title='Open '+(ext.name||'extension');
        open.disabled=ext.enabled===false;
        open.addEventListener('click',async ev=>{
          ev.stopPropagation(); open.disabled=true;
          try {
            const result=await S.openExtensionAction(ext.localId);
            if(result?.error) note(result.error);
          } catch { note('Could not open extension'); }
          finally { open.disabled=ext.enabled===false; }
        });
        row.appendChild(open);
      } else {
        const spacer=document.createElement('span'); row.appendChild(spacer);
      }

      const toggle=document.createElement('button');
      toggle.type='button'; toggle.className='switch sm'; toggle.setAttribute('role','switch');
      toggle.setAttribute('aria-checked',ext.enabled===false?'false':'true');
      toggle.title=(ext.enabled===false?'Enable ':'Disable ')+(ext.name||'extension');
      toggle.addEventListener('click',async ev=>{
        ev.stopPropagation();
        const next=ext.enabled===false;
        const result=await S.setExtensionEnabled(ext.localId,next).catch(()=>({error:'Could not change extension state'}));
        if(result?.error){ note(result.error); return; }
        ext.enabled=next;
        await renderActionList();
      });
      row.appendChild(toggle);
      list.appendChild(row);
    }
  }

  button.addEventListener('click',()=>setTimeout(renderActionList,0));
  window.__BREEZE_EXTENSION_ACTIONS__={ refresh:renderActionList };
})();
