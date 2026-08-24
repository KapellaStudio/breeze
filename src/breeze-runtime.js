/* Packaged Breeze runtime truth layer.
   Removes prototype-only claims and renders only facts observable from the
   Electron browser runtime. */
(function(){
  'use strict';
  const S=window.__BREEZE_SHELL__;
  if(!S||!S.isShell)return;
  const $=s=>document.querySelector(s);
  const $$=s=>[...document.querySelectorAll(s)];
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  let active=null;

  const style=document.createElement('style');
  style.textContent=`
    .runtimeTruth{font-size:10.5px;line-height:1.5;color:var(--tx3);padding:8px 0 0}.runtimeRow{display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:var(--r-sm);font-size:12px}.runtimeRow .nm{flex:1;color:var(--tx2)}.runtimeRow .ct{font-size:11px;color:var(--tx3);text-align:right}.runtimeDot{width:7px;height:7px;border-radius:50%;background:var(--ok);flex:0 0 auto}.runtimeDot.warn{background:var(--warn)}
    [data-shell-disabled="1"]{opacity:.52!important}.pvShot[data-shell-hidden="1"]{display:none!important}
  `;
  document.head.append(style);

  function host(url){try{return new URL(url).hostname.replace(/^www\./,'');}catch{return'New tab';}}
  function origin(url){try{return new URL(url).origin;}catch{return'';}}
  function connection(url){try{return new URL(url).protocol==='https:'?'Encrypted HTTPS':'HTTP';}catch{return'No web connection';}}
  function row(name,value,warn=false){const r=el('div','runtimeRow');const dot=el('span','runtimeDot'+(warn?' warn':''));const nm=el('span','nm',name);const ct=el('span','ct',value);r.append(dot,nm,ct);return r;}

  async function renderPrivacy(){
    const pop=$('#privPop');if(!pop||!active)return;
    const permissions=await S.listPermissions().catch(()=>[]);const o=origin(active.url);const saved=(permissions||[]).filter(p=>p.origin===o).length;
    pop.replaceChildren();
    const head=el('div','privHead');const big=el('div','big');big.append(el('span','num',String(active.blocked||0)),el('span','lbl',(active.blocked===1?'known tracking-domain request':'known tracking-domain requests')+' blocked\nbefore loading'));const site=el('div','site',`${host(active.url)} · ${connection(active.url)}`);big.querySelector('.lbl').style.whiteSpace='pre-line';head.append(big,site);pop.append(head);
    const list=el('div','privList');
    list.append(row('Known tracking-domain requests',String(active.blocked||0)),row('Workspace session',active.sealed?'Sealed / isolated':'Main browser session'),row('Private browsing',active.private?'Memory-only':'Off'),row('Saved site permissions',String(saved)),row('Connection',connection(active.url),/^http:/.test(active.url||'')));
    pop.append(list);
    const note=el('div','runtimeTruth','Breeze currently blocks a built-in list of known tracking domains and strips common tracking parameters. These numbers are measured from this tab; no category or performance score is invented.');note.style.padding='8px 15px 12px';pop.append(note);
    const foot=el('div','privFoot');
    const perms=el('button','btn ghost','Permissions');perms.style.flex='1';perms.onclick=()=>{try{pop.dataset.on='0';if(typeof openScrim==='function')openScrim('set');if(typeof setPane==='function')setPane('privacy');}catch{}};
    const reload=el('button','btn ghost','Reload fresh');reload.style.flex='1';reload.onclick=async()=>{const r=await S.repairSession(active.id,'reload');if(typeof toast==='function')toast(r?.ok||r?.error||'Done');pop.dataset.on='0';};foot.append(perms,reload);pop.append(foot);
    const lab=el('div',null);lab.style.cssText='padding:11px 15px 5px;border-top:1px solid var(--line2)';lab.append(el('span','eyebrow','Session repair'));pop.append(lab);
    const fixes=el('div','fixList');
    const defs=[['rebuild','Rebuild page state','Drops cache, workers and scratch storage while keeping cookies.','Keeps you signed in'],['reset','Full site reset','Removes this site’s stored state, including cookies.','Signs you out']];
    defs.forEach(([kind,title,desc,keep])=>{const b=el('button','fixRow');const ic=el('span','ic',kind==='rebuild'?'↻':'×');const m=el('span','m');m.append(el('span','t',title),el('span','d',desc),el('span','keeps'+(kind==='reset'?' loses':''),keep));b.append(ic,m);b.onclick=async()=>{const r=await S.repairSession(active.id,kind);if(typeof toast==='function')toast(r?.ok||r?.error||'Done');pop.dataset.on='0';};fixes.append(b);});pop.append(fixes);
  }

  function configureSwitch(pane,title,checked,desc){
    const rows=$$(`${pane} .setRow`);const r=rows.find(x=>x.querySelector('.t')?.textContent?.trim()===title);if(!r)return;
    const sw=r.querySelector('.switch');if(sw){sw.setAttribute('aria-checked',String(checked));sw.disabled=true;sw.dataset.shellDisabled='1';}
    const d=r.querySelector('.d');if(d)d.textContent=desc;
  }
  function correctProtectionSettings(){
    configureSwitch('[data-pane="privacy"]','Block trackers',true,'Built-in known tracking domains are blocked before the request leaves. Custom filter lists are not yet exposed.');
    configureSwitch('[data-pane="privacy"]','Block third-party cookies',false,'Not yet enforced as a separate policy in the current Electron shell.');
    configureSwitch('[data-pane="privacy"]','Randomise fingerprint',false,'Not enabled in the current Electron shell; Breeze will not claim anti-fingerprinting it cannot verify.');
    configureSwitch('[data-pane="privacy"]','Strip tracking parameters',true,'utm_, fbclid, gclid and other common tracking parameters are stripped from navigations.');
  }
  function correctDownloadSettings(){configureSwitch('[data-pane="downloads"]','Detect newer versions',false,'Not active in this RC. Breeze will not simulate version detection.');}
  function correctTabSettings(){configureSwitch('[data-pane="tabs"]','Sleep inactive tabs',false,'Real renderer discard is not enabled in this RC, so Breeze does not report fictional memory savings.');}
  function removeUnsupportedControls(){
    const split=$('#splitBtn');if(split){split.style.display='none';split.title='Split view requires the next browser-core lane';}
    const transcript=$('[data-panel="transcript"]');if(transcript)transcript.style.display='none';
    const shot=$('.pvShot');if(shot)shot.dataset.shellHidden='1';
    try{
      if(typeof COMMANDS!=='undefined'){
        const remove=new Set(['Open the design system PDF','Open the talk','Simulate a stuck page','Split view']);
        for(let i=COMMANDS.length-1;i>=0;i--)if(remove.has(COMMANDS[i]?.t))COMMANDS.splice(i,1);
        const q=COMMANDS.find(x=>x?.t==='Open reading queue');if(q)q.u='Saved locally in this workspace';
        const d=COMMANDS.find(x=>x?.t==='Open downloads');if(d)d.u='Real Chromium downloads';
        const e=COMMANDS.find(x=>x?.t==='Manage extensions');if(e)e.u='Compatible unpacked extensions';
        const snap=COMMANDS.find(x=>x?.t==='Save session snapshot');if(snap){snap.u='Save restorable web tabs in this workspace';snap.run=()=>window.saveBreezeSnapshot?window.saveBreezeSnapshot():openPanel('snapshots');}
      }
      if(typeof APP_MENU!=='undefined'){
        const save=APP_MENU.find(x=>x?.t==='Save and share');if(save){save.t='Downloads & saved files';save.more=false;save.i='down';save.act=()=>openPanel('downloads');}
      }
      if(typeof renderAppMenu==='function')renderAppMenu();
    }catch{}
  }

  S.listTabs().then(t=>{active=(t||[]).find(x=>x.active)||null;renderPrivacy();}).catch(()=>{});
  S.on('tab:update',st=>{if(st?.active){active=st;renderPrivacy();}});
  const shield=$('#shieldBtn');if(shield){shield.title='Privacy and session tools';shield.addEventListener('click',()=>setTimeout(renderPrivacy,0),true);}
  correctProtectionSettings();correctDownloadSettings();correctTabSettings();removeUnsupportedControls();
})();
