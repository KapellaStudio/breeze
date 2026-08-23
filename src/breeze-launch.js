/* Breeze first-run / Move to Breeze experience.
   Injected only into the desktop shell build. The standalone prototype never
   receives the privileged setup API and therefore never shows this surface. */
(function(){
  'use strict';
  const S = window.__BREEZE_SHELL__;
  if (!S || !S.isShell || typeof S.firstRunStatus !== 'function') return;

  const css = document.createElement('style');
  css.textContent = `
  .bzLaunch{position:fixed;inset:0;z-index:10000;display:none;place-items:center;padding:24px;background:color-mix(in srgb,var(--bg0) 72%,transparent);backdrop-filter:blur(18px) saturate(.85)}
  .bzLaunch[data-on="1"]{display:grid}.bzLaunchCard{width:min(720px,calc(100vw - 32px));max-height:min(760px,calc(100vh - 32px));overflow:auto;background:var(--bg1);border:1px solid var(--line);border-radius:24px;box-shadow:var(--shPop);padding:28px}
  .bzLaunchHead{display:flex;align-items:center;gap:16px;margin-bottom:22px}.bzLaunchMark{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;background:var(--accentSoft);color:var(--accentTx);font-size:23px;font-weight:700}.bzLaunchHead h2{font-size:22px;letter-spacing:-.45px}.bzLaunchHead p{color:var(--tx2);margin-top:3px;font-size:12.5px}
  .bzLaunchProgress{display:flex;gap:6px;margin:0 0 22px}.bzLaunchProgress i{height:4px;flex:1;border-radius:4px;background:var(--bg3)}.bzLaunchProgress i[data-on="1"]{background:var(--accent)}
  .bzLaunchStep{display:none}.bzLaunchStep[data-on="1"]{display:block}.bzLaunchStep h3{font-size:18px;letter-spacing:-.3px;margin-bottom:7px}.bzLaunchStep>p{font-size:13px;line-height:1.6;color:var(--tx2);max-width:600px}
  .bzLaunchGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:18px}.bzLaunchOpt{padding:16px;border:1px solid var(--line);border-radius:14px;text-align:left;background:var(--bg2);transition:border-color .15s var(--ease),transform .15s var(--ease)}.bzLaunchOpt:hover:not([disabled]){border-color:var(--accentLine);transform:translateY(-1px)}.bzLaunchOpt[disabled]{opacity:.4;cursor:not-allowed}.bzLaunchOpt b{display:block;font-size:13px}.bzLaunchOpt span{display:block;color:var(--tx3);font-size:11.5px;line-height:1.45;margin-top:4px}
  .bzLaunchStatus{min-height:40px;margin-top:14px;padding:10px 12px;border-radius:10px;background:var(--bg2);color:var(--tx2);font-size:12px;line-height:1.5}.bzLaunchStatus[data-kind="good"]{background:color-mix(in srgb,var(--ok) 12%,var(--bg2));color:var(--ok)}.bzLaunchStatus[data-kind="warn"]{background:color-mix(in srgb,var(--warn) 12%,var(--bg2));color:var(--warn)}
  .bzLaunchChecks{display:grid;gap:9px;margin-top:18px}.bzLaunchCheck{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border:1px solid var(--line2);border-radius:11px}.bzLaunchCheck i{width:18px;height:18px;border-radius:50%;background:var(--accentSoft);color:var(--accentTx);display:grid;place-items:center;font-style:normal;font-size:10px;font-weight:800;flex:0 0 auto}.bzLaunchCheck b{font-size:12.5px}.bzLaunchCheck span{display:block;color:var(--tx3);font-size:11px;margin-top:2px}
  .bzLaunchFoot{display:flex;align-items:center;gap:8px;margin-top:24px;padding-top:18px;border-top:1px solid var(--line2)}.bzLaunchFoot .sp{flex:1}.bzLaunchBtn{height:36px;padding:0 14px;border-radius:9px;border:1px solid var(--line);background:var(--bg2);font-weight:600;font-size:12px}.bzLaunchBtn:hover{background:var(--bg3)}.bzLaunchBtn.primary{background:var(--accent);border-color:var(--accent);color:var(--onAccent)}.bzLaunchBtn.primary:hover{filter:brightness(1.06)}
  .bzSetupActions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.bzSetupActions button{font-size:10.5px;padding:4px 8px;border:1px solid var(--line);border-radius:7px;color:var(--tx2)}.bzSetupActions button:hover{background:var(--bg2);color:var(--tx1)}
  @media(max-width:620px){.bzLaunch{padding:8px}.bzLaunchCard{padding:20px;border-radius:18px}.bzLaunchGrid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(css);

  const host = document.createElement('div');
  host.className = 'bzLaunch';
  host.setAttribute('role','dialog');
  host.setAttribute('aria-modal','true');
  host.setAttribute('aria-label','Set up Breeze');
  host.innerHTML = `
    <div class="bzLaunchCard">
      <div class="bzLaunchHead"><div class="bzLaunchMark">B</div><div><h2>Make Breeze yours</h2><p>Move in, choose your defaults, then browse. Everything here stays on this computer.</p></div></div>
      <div class="bzLaunchProgress"><i></i><i></i><i></i><i></i></div>
      <section class="bzLaunchStep" data-step="0">
        <h3>The browser is ready for a real test drive.</h3>
        <p>Breeze already has real Chromium tabs, local history and bookmarks, Private browsing, sealed workspaces, download provenance, the PDF Workspace, Breeze Flow and the current extension compatibility tier. This setup only handles the things a daily-driver browser needs before you move in.</p>
        <div class="bzLaunchChecks">
          <div class="bzLaunchCheck"><i>✓</i><div><b>Private means memory-only</b><span>Private tabs never enter restart state or local history.</span></div></div>
          <div class="bzLaunchCheck"><i>✓</i><div><b>Your library stays local</b><span>Imported bookmarks and history are written to Breeze's local browser library, not Supabase.</span></div></div>
          <div class="bzLaunchCheck"><i>✓</i><div><b>No account required</b><span>You can use Breeze, Flow and the PDF Workspace without signing into Kapella.</span></div></div>
        </div>
      </section>
      <section class="bzLaunchStep" data-step="1">
        <h3>Move your browser life over.</h3>
        <p>Breeze can import bookmarks and history directly from local Chrome or Edge profiles. You can also use the standard bookmarks HTML format.</p>
        <div class="bzLaunchGrid">
          <button class="bzLaunchOpt" data-import="chrome"><b>Import from Chrome</b><span data-source-note="chrome">Looking for local Chrome profiles…</span></button>
          <button class="bzLaunchOpt" data-import="edge"><b>Import from Edge</b><span data-source-note="edge">Looking for local Edge profiles…</span></button>
          <button class="bzLaunchOpt" data-import="html"><b>Import bookmarks file</b><span>Reads a standard browser bookmarks HTML export.</span></button>
          <button class="bzLaunchOpt" data-export><b>Export Breeze bookmarks</b><span>Standard HTML, so leaving Breeze never requires a proprietary format.</span></button>
        </div>
        <div class="bzLaunchStatus" data-launch-status>Nothing imported yet.</div>
      </section>
      <section class="bzLaunchStep" data-step="2">
        <h3>Choose Breeze as your default when you're ready.</h3>
        <p>This is optional during testing. Breeze can ask the operating system to register itself, but Windows and macOS may still require your confirmation in system settings.</p>
        <div class="bzLaunchChecks">
          <div class="bzLaunchCheck"><i>↗</i><div><b data-default-title>Checking default-browser status…</b><span data-default-note>Breeze will never change this silently.</span></div></div>
        </div>
        <div class="bzLaunchGrid">
          <button class="bzLaunchOpt" data-default-request><b>Make Breeze the default</b><span>Request HTTP and HTTPS handling from the operating system.</span></button>
          <button class="bzLaunchOpt" data-default-settings><b>Open system settings</b><span>Use the operating system's own default-app chooser.</span></button>
        </div>
        <div class="bzLaunchStatus" data-default-status>Checking…</div>
      </section>
      <section class="bzLaunchStep" data-step="3">
        <h3>You're set up.</h3>
        <p>Nothing here locks you in. Import can be run again from Settings, bookmarks can be exported at any time, and default-browser status is always under operating-system control.</p>
        <div class="bzLaunchChecks">
          <div class="bzLaunchCheck"><i>✓</i><div><b>Breeze stays testable before signing</b><span>The RC can be used now; Windows/macOS trust warnings disappear only after production signing credentials are added.</span></div></div>
          <div class="bzLaunchCheck"><i>✓</i><div><b>Your existing browser can stay installed</b><span>Use both while you evaluate Breeze. No migration step deletes source-browser data.</span></div></div>
        </div>
      </section>
      <div class="bzLaunchFoot"><button class="bzLaunchBtn" data-launch-back>Back</button><button class="bzLaunchBtn" data-launch-later>Not now</button><span class="sp"></span><button class="bzLaunchBtn primary" data-launch-next>Continue</button></div>
    </div>`;
  document.body.appendChild(host);

  const steps = [...host.querySelectorAll('[data-step]')];
  const bars = [...host.querySelectorAll('.bzLaunchProgress i')];
  const back = host.querySelector('[data-launch-back]');
  const next = host.querySelector('[data-launch-next]');
  const later = host.querySelector('[data-launch-later]');
  let step = 0;
  let forcedOpen = false;

  const notify = text => { try { if (typeof window.toast === 'function') window.toast(text); } catch {} };
  function paint(){
    steps.forEach((el,i)=>el.dataset.on=i===step?'1':'0');
    bars.forEach((el,i)=>el.dataset.on=i<=step?'1':'0');
    back.style.visibility=step===0?'hidden':'visible';
    later.style.display=step===3?'none':'';
    next.textContent=step===3?'Start browsing':'Continue';
  }
  function openSetup(force=false){ forcedOpen=force; step=0; paint(); host.dataset.on='1'; refreshSources(); refreshDefault(); next.focus(); }
  function closeSetup(){ host.dataset.on='0'; }
  async function finish(){
    const r=await S.completeFirstRun().catch(()=>null);
    if(r?.error) return setStatus('Could not save setup state: '+r.error,'warn');
    closeSetup(); notify('Breeze setup complete');
  }
  back.onclick=()=>{ if(step>0){step--;paint();} };
  later.onclick=()=>closeSetup();
  next.onclick=async()=>{ if(step<3){step++;paint(); if(step===1)refreshSources(); if(step===2)refreshDefault();} else await finish(); };
  host.addEventListener('keydown',e=>{ if(e.key==='Escape'&&forcedOpen) closeSetup(); });

  const statusEl=host.querySelector('[data-launch-status]');
  function setStatus(text,kind=''){ statusEl.textContent=text; statusEl.dataset.kind=kind; }
  async function refreshSources(){
    const sources=await S.detectImportSources().catch(()=>[]);
    ['chrome','edge'].forEach(name=>{
      const s=(sources||[]).find(x=>x.browser===name); const b=host.querySelector(`[data-import="${name}"]`); const note=host.querySelector(`[data-source-note="${name}"]`);
      const count=s?.profiles?.length||0; b.disabled=!s?.available; note.textContent=count?`${count} local profile${count===1?'':'s'} found · bookmarks + history`:`No local ${name==='edge'?'Edge':'Chrome'} profile found`;
    });
  }
  host.querySelectorAll('[data-import]').forEach(b=>b.onclick=async()=>{
    const kind=b.dataset.import; b.disabled=true; setStatus('Importing local browser data…');
    let r;
    if(kind==='html') r=await S.importBookmarksFile(); else r=await S.importBrowserData(kind,{bookmarks:true,history:true});
    b.disabled=false;
    if(!r||r.canceled) return setStatus('Import cancelled.');
    if(r.error) return setStatus(r.error,'warn');
    if(kind==='html') setStatus(`Imported ${r.imported||0} bookmarks${r.skipped?` · ${r.skipped} skipped`:''}.`,'good');
    else setStatus(`Imported ${r.bookmarksImported||0} bookmarks and ${r.historyImported||0} history entries from ${kind==='edge'?'Edge':'Chrome'}.`,'good');
    try { if(typeof window.renderHistory==='function')window.renderHistory(); if(typeof window.renderExts==='function'){} } catch {}
  });
  host.querySelector('[data-export]').onclick=async()=>{
    const r=await S.exportBookmarksFile(); if(!r||r.canceled)return; if(r.error)return setStatus(r.error,'warn'); setStatus(`Exported ${r.count||0} Breeze bookmarks.`,'good');
  };

  const defaultTitle=host.querySelector('[data-default-title]');
  const defaultNote=host.querySelector('[data-default-note]');
  const defaultStatus=host.querySelector('[data-default-status]');
  async function refreshDefault(){
    const r=await S.defaultBrowserStatus().catch(()=>null);
    if(!r||r.error){ defaultStatus.textContent='Could not read default-browser status.'; defaultStatus.dataset.kind='warn'; return; }
    defaultTitle.textContent=r.isDefault?'Breeze is your default browser':'Breeze is not your default browser yet';
    defaultNote.textContent=r.isDefault?'HTTP and HTTPS links are assigned to Breeze.':'You can keep testing without changing this.';
    defaultStatus.textContent=r.isDefault?'Default browser is set.':'Default browser is optional during the RC test period.';
    defaultStatus.dataset.kind=r.isDefault?'good':'';
  }
  host.querySelector('[data-default-request]').onclick=async()=>{
    defaultStatus.textContent='Requesting default-browser registration…';
    const r=await S.requestDefaultBrowser();
    if(r?.isDefault){defaultStatus.textContent='Breeze is now the default browser.';defaultStatus.dataset.kind='good';}
    else {defaultStatus.textContent='The operating system still needs your confirmation. Open system settings to finish.';defaultStatus.dataset.kind='warn';}
    refreshDefault();
  };
  host.querySelector('[data-default-settings]').onclick=async()=>{ const r=await S.openDefaultBrowserSettings(); if(r?.error||r?.ok===false)defaultStatus.textContent=r?.message||'Open your system default-app settings and choose Breeze.'; };

  function installSettingsEntry(){
    const facts=document.querySelector('.aboutFacts'); if(!facts||facts.querySelector('[data-breeze-setup]'))return;
    const card=document.createElement('div'); card.className='fact'; card.dataset.breezeSetup='1';
    const k=document.createElement('span'); k.className='k'; k.textContent='Setup & migration';
    const v=document.createElement('span'); v.className='v'; v.textContent='Local';
    const d=document.createElement('span'); d.className='d'; d.textContent='Import Chrome/Edge bookmarks and history, export bookmarks, or change default-browser status.';
    const acts=document.createElement('div'); acts.className='bzSetupActions';
    const setup=document.createElement('button'); setup.textContent='Open setup'; setup.onclick=()=>openSetup(true);
    const exp=document.createElement('button'); exp.textContent='Export bookmarks'; exp.onclick=async()=>{const r=await S.exportBookmarksFile(); if(r?.ok)notify(`Exported ${r.count||0} bookmarks`);};
    acts.append(setup,exp); card.append(k,v,d,acts); facts.append(card);
  }
  installSettingsEntry();

  S.firstRunStatus().then(r=>{ if(r && !r.firstRunComplete) openSetup(false); }).catch(()=>{});
})();
