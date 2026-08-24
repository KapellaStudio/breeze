/* Breeze Vault UI.
   Password values are write-only from this renderer. Listing returns metadata
   and usernames only; password copy happens entirely in the main process. */
(function(){
  'use strict';
  const S=window.__BREEZE_SHELL__;
  if(!S||!S.isShell||typeof S.vaultList!=='function')return;
  const $=s=>document.querySelector(s);
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  let rows=[];
  let status=null;
  let query='';

  const css=document.createElement('style');
  css.textContent=`
    .bzVault{position:fixed;inset:0;z-index:10020;display:none;place-items:center;padding:24px;background:color-mix(in srgb,var(--bg0) 74%,transparent);backdrop-filter:blur(16px)}
    .bzVault[data-on="1"]{display:grid}.bzVaultCard{width:min(840px,calc(100vw - 32px));height:min(700px,calc(100vh - 32px));display:flex;flex-direction:column;background:var(--bg1);border:1px solid var(--line);border-radius:22px;box-shadow:var(--shPop);overflow:hidden}
    .bzVaultHead{display:flex;align-items:center;gap:13px;padding:19px 21px;border-bottom:1px solid var(--line2)}.bzVaultMark{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--accentSoft);color:var(--accentTx);font-weight:800;font-size:17px}.bzVaultTitle{min-width:0;flex:1}.bzVaultTitle h2{font-size:17px;letter-spacing:-.3px}.bzVaultTitle p{font-size:11.5px;color:var(--tx3);margin-top:2px}.bzVaultClose{width:30px;height:30px;border-radius:8px;color:var(--tx2)}.bzVaultClose:hover{background:var(--bg2);color:var(--tx1)}
    .bzVaultBar{display:flex;align-items:center;gap:8px;padding:11px 16px;border-bottom:1px solid var(--line2)}.bzVaultSearch{height:34px;flex:1;display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:9px;padding:0 10px;background:var(--bg2)}.bzVaultSearch input{width:100%;font-size:12px}.bzVaultBtn{height:34px;padding:0 11px;border:1px solid var(--line);border-radius:9px;font-size:11.5px;font-weight:600;background:var(--bg1)}.bzVaultBtn:hover:not(:disabled){background:var(--bg2)}.bzVaultBtn.primary{background:var(--accent);border-color:var(--accent);color:var(--onAccent)}.bzVaultBtn:disabled{opacity:.4;cursor:not-allowed}
    .bzVaultState{padding:9px 16px;font-size:10.5px;color:var(--tx3);border-bottom:1px solid var(--line2);display:flex;gap:8px;align-items:center}.bzVaultState i{width:7px;height:7px;border-radius:50%;background:var(--ok);flex:0 0 auto}.bzVaultState[data-ok="0"]{color:var(--warn)}.bzVaultState[data-ok="0"] i{background:var(--warn)}
    .bzVaultBody{flex:1;min-height:0;overflow:auto;padding:10px 12px 16px}.bzVaultEmpty{height:100%;display:grid;place-items:center;text-align:center;color:var(--tx3);font-size:12px;line-height:1.6;padding:30px}.bzCred{display:grid;grid-template-columns:minmax(180px,1.25fr) minmax(140px,.9fr) auto;gap:12px;align-items:center;padding:12px;border:1px solid transparent;border-radius:12px}.bzCred:hover{background:var(--bg2);border-color:var(--line2)}.bzCredMain{min-width:0}.bzCredMain b{display:block;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bzCredMain span{display:block;font-size:10.5px;color:var(--tx3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bzCredUser{min-width:0;font-size:11.5px;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bzCredActs{display:flex;gap:5px}.bzCredActs button{height:28px;padding:0 8px;border:1px solid var(--line);border-radius:7px;font-size:10px;color:var(--tx2)}.bzCredActs button:hover{background:var(--bg3);color:var(--tx1)}.bzCredActs .danger:hover{color:var(--bad)}
    .bzVaultFormWrap{position:absolute;inset:0;z-index:2;display:none;place-items:center;padding:20px;background:color-mix(in srgb,var(--bg0) 68%,transparent);backdrop-filter:blur(10px)}.bzVaultFormWrap[data-on="1"]{display:grid}.bzVaultForm{width:min(460px,100%);background:var(--bg1);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shPop);padding:20px}.bzVaultForm h3{font-size:15px;margin-bottom:4px}.bzVaultForm>p{font-size:11px;line-height:1.5;color:var(--tx3);margin-bottom:14px}.bzVaultFields{display:grid;gap:10px}.bzVaultField label{display:block;font-size:10px;color:var(--tx3);font-weight:600;margin:0 0 4px}.bzVaultField input{width:100%;height:36px;border:1px solid var(--line);border-radius:8px;background:var(--bg2);padding:0 10px;font-size:12px}.bzVaultField input:focus{border-color:var(--accent)}.bzVaultFormFoot{display:flex;justify-content:flex-end;gap:7px;margin-top:16px}.bzVaultCard{position:relative}
    .bzVaultPrivacy{padding:10px 16px;border-top:1px solid var(--line2);font-size:10.5px;line-height:1.5;color:var(--tx3)}
    @media(max-width:650px){.bzVault{padding:8px}.bzVaultCard{width:100%;height:100%;border-radius:15px}.bzVaultBar{flex-wrap:wrap}.bzVaultSearch{flex-basis:100%}.bzCred{grid-template-columns:1fr}.bzCredActs{justify-content:flex-start}}
  `;
  document.head.append(css);

  const host=el('div','bzVault');host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');host.setAttribute('aria-label','Breeze Vault');
  host.innerHTML=`<div class="bzVaultCard">
    <div class="bzVaultHead"><div class="bzVaultMark">V</div><div class="bzVaultTitle"><h2>Breeze Vault</h2><p>Local credentials protected by your operating system</p></div><button class="bzVaultClose" aria-label="Close">×</button></div>
    <div class="bzVaultBar"><div class="bzVaultSearch"><span>⌕</span><input type="search" autocomplete="off" spellcheck="false" placeholder="Search websites or usernames" aria-label="Search Breeze Vault"></div><button class="bzVaultBtn" data-vault-import>Import CSV</button><button class="bzVaultBtn primary" data-vault-add>Add login</button></div>
    <div class="bzVaultState"><i></i><span>Checking secure storage…</span></div>
    <div class="bzVaultBody"></div>
    <div class="bzVaultPrivacy">Passwords are never displayed back into Breeze chrome. “Copy password” is handled by the main process and clears the clipboard after 30 seconds if it is still unchanged. Automatic form injection is intentionally not enabled in this Electron generation.</div>
    <div class="bzVaultFormWrap" aria-hidden="true"><form class="bzVaultForm"><h3>Add a login</h3><p>Saved locally with OS-backed encryption. Breeze refuses insecure Linux basic-text storage.</p><div class="bzVaultFields">
      <div class="bzVaultField"><label>Website</label><input name="origin" required placeholder="example.com" autocomplete="url"></div>
      <div class="bzVaultField"><label>Label</label><input name="label" placeholder="Optional · Work account" autocomplete="off"></div>
      <div class="bzVaultField"><label>Username or email</label><input name="username" autocomplete="username"></div>
      <div class="bzVaultField"><label>Password</label><input name="password" type="password" autocomplete="new-password"></div>
    </div><div class="bzVaultFormFoot"><button type="button" class="bzVaultBtn" data-vault-cancel>Cancel</button><button class="bzVaultBtn primary" type="submit">Save login</button></div></form></div>
  </div>`;
  document.body.append(host);

  const body=host.querySelector('.bzVaultBody');
  const stateEl=host.querySelector('.bzVaultState');
  const stateText=stateEl.querySelector('span');
  const search=host.querySelector('.bzVaultSearch input');
  const addBtn=host.querySelector('[data-vault-add]');
  const importBtn=host.querySelector('[data-vault-import]');
  const formWrap=host.querySelector('.bzVaultFormWrap');
  const form=host.querySelector('.bzVaultForm');
  const field=n=>form.elements.namedItem(n);

  const notify=text=>{try{if(typeof toast==='function')toast(text);}catch{}};
  function activeWebTab(){try{return typeof S.listTabs==='function'?S.listTabs().then(t=>(t||[]).find(x=>x.active)):Promise.resolve(null);}catch{return Promise.resolve(null);}}
  function backendName(s){const b=String(s?.backend||'OS encryption');if(b==='basic_text')return'Linux basic-text';return b;}
  async function refreshStatus(){
    status=await S.vaultStatus().catch(()=>({available:false,reason:'Could not reach secure storage'}));
    stateEl.dataset.ok=status?.available?'1':'0';
    stateText.textContent=status?.available?`Protected by ${backendName(status)} · stored only on this device`:(status?.reason||'Secure storage unavailable');
    addBtn.disabled=!status?.available;importBtn.disabled=!status?.available;
  }
  function siteLabel(origin){try{return new URL(origin).hostname.replace(/^www\./,'');}catch{return origin||'Website';}}
  function render(){
    body.replaceChildren();
    if(!rows.length){const empty=el('div','bzVaultEmpty');empty.textContent=query?'No saved login matches this search.':'No logins saved yet. Add one manually or import a browser password CSV. Breeze never uploads the file.';body.append(empty);return;}
    const frag=document.createDocumentFragment();
    rows.forEach(r=>{
      const row=el('div','bzCred');
      const main=el('div','bzCredMain');const title=el('b',null,r.label||siteLabel(r.origin));const origin=el('span',null,r.origin);main.append(title,origin);
      const user=el('div','bzCredUser',r.username||'No username saved');
      const acts=el('div','bzCredActs');
      const copyUser=el('button',null,'Copy username');copyUser.disabled=!r.username;copyUser.onclick=async()=>{const x=await S.vaultCopyUsername(r.id);notify(x?.ok?'Username copied · clears in 30 seconds':(x?.error||'Could not copy username'));};
      const copyPass=el('button',null,'Copy password');copyPass.onclick=async()=>{const x=await S.vaultCopyPassword(r.id);notify(x?.ok?'Password copied · clears in 30 seconds':(x?.error||'Could not copy password'));};
      const remove=el('button','danger','Delete');remove.onclick=async()=>{if(!confirm(`Delete the saved login for ${siteLabel(r.origin)}?`))return;const x=await S.vaultRemove(r.id);if(x?.ok){notify('Saved login deleted');await refresh();}};
      acts.append(copyUser,copyPass,remove);row.append(main,user,acts);frag.append(row);
    });
    body.append(frag);
  }
  async function refresh(){rows=await S.vaultList(query).catch(()=>[]);if(!Array.isArray(rows))rows=[];render();}
  async function openVault(){
    host.dataset.on='1';await refreshStatus();await refresh();search.focus();
  }
  function closeVault(){host.dataset.on='0';formWrap.dataset.on='0';formWrap.setAttribute('aria-hidden','true');form.reset();}
  async function openForm(){
    form.reset();formWrap.dataset.on='1';formWrap.setAttribute('aria-hidden','false');
    const tab=await activeWebTab();
    if(tab&&!tab.private&&/^https?:\/\//i.test(tab.url||'')){try{field('origin').value=new URL(tab.url).origin;}catch{}}
    setTimeout(()=>field('origin').focus(),20);
  }
  function closeForm(){formWrap.dataset.on='0';formWrap.setAttribute('aria-hidden','true');form.reset();}

  host.querySelector('.bzVaultClose').onclick=closeVault;
  host.onclick=e=>{if(e.target===host)closeVault();};
  addBtn.onclick=openForm;
  host.querySelector('[data-vault-cancel]').onclick=closeForm;
  search.addEventListener('input',()=>{query=search.value.trim();refresh();});
  importBtn.onclick=async()=>{
    const r=await S.vaultImportCsv();if(!r||r.canceled)return;if(r.error)return notify(r.error);
    notify(`Imported ${r.imported||0} login${r.imported===1?'':'s'}${r.skipped?` · ${r.skipped} skipped`:''}`);await refresh();
  };
  form.addEventListener('submit',async e=>{
    e.preventDefault();const save=form.querySelector('[type="submit"]');save.disabled=true;
    const r=await S.vaultAdd({origin:field('origin').value,label:field('label').value,username:field('username').value,password:field('password').value});
    save.disabled=false;if(r?.error)return notify(r.error);closeForm();notify(r?.updated?'Saved login updated':'Login saved to Breeze Vault');await refresh();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&host.dataset.on==='1'){e.preventDefault();if(formWrap.dataset.on==='1')closeForm();else closeVault();}},true);

  /* Replace the prototype menu promise with the real packaged feature. */
  try{
    if(typeof APP_MENU!=='undefined'){
      const item=APP_MENU.find(x=>x&&x.t==='Passwords and autofill');
      if(item){item.t='Breeze Vault';item.soon=false;item.more=false;item.act=openVault;if(typeof renderAppMenu==='function')renderAppMenu();}
    }
    if(typeof COMMANDS!=='undefined'&&!COMMANDS.some(x=>x?.t==='Open Breeze Vault')){
      COMMANDS.push({ic:'⌘',t:'Open Breeze Vault',u:'OS-encrypted local credentials',run:openVault});
    }
  }catch{}

  window.openBreezeVault=openVault;
})();
