/* Breeze packaged omnibox dropdown.
   The main process already owns URL-vs-search resolution. This module removes
   the design prototype's canned web results and makes click suggestions use
   real local browser data without leaking normal activity into Private tabs. */
(function(){
  'use strict';
  const S=window.__BREEZE_SHELL__;
  if(!S||!S.isShell)return;
  const input=document.querySelector('#omniInput');
  const list=document.querySelector('#omniList');
  const links=document.querySelector('#ovLinks');
  if(!input||!list||!links)return;

  let seq=0;
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  function host(url){try{return new URL(url).hostname.replace(/^www\./,'');}catch{return'';}}
  function looksLikeAddress(q){return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q)||/^https?:\/\//i.test(q);}
  async function active(){const tabs=await S.listTabs().catch(()=>[]);return (tabs||[]).find(t=>t.active)||null;}
  async function go(value){
    const a=await active();
    try{if(typeof closeAll==='function')closeAll();}catch{}
    if(a?.id!=null)await S.navigate(a.id,value);else await S.newTab({url:value});
    await S.setInternalView(false).catch(()=>{});
    try{if(typeof setView==='function')setView('browse');document.documentElement.dataset.kind='page';}catch{}
  }
  function row(icon,title,sub,onClick,side=''){
    const b=el('button','ovRow');const ic=el('span','ic',icon);const main=el('span','main');main.append(el('span','t',title),el('span','u',sub));b.append(ic,main);if(side)b.append(el('span','side',side));b.onclick=()=>onClick();return b;
  }
  function section(name){return el('div','ovSec eyebrow',name);}

  async function realData(a){
    if(a?.private)return {bookmarks:[],history:[],queue:[]};
    const workspace=String(a?.workspace||'default');
    const [bookmarks,history,queue]=await Promise.all([
      S.bookmarkList('').catch(()=>[]),S.historyList('').catch(()=>[]),S.listQueue(workspace).catch(()=>[])
    ]);
    return {bookmarks:Array.isArray(bookmarks)?bookmarks:[],history:Array.isArray(history)?history:[],queue:Array.isArray(queue)?queue:[]};
  }
  function uniqueRows(data){
    const seen=new Set(),out=[];
    for(const [kind,rows] of [['Bookmark',data.bookmarks],['Queue',data.queue],['History',data.history]]){
      for(const r of rows){
        if(!/^https?:\/\//i.test(String(r.url||''))||seen.has(r.url))continue;
        seen.add(r.url);out.push({kind,url:r.url,title:r.title||host(r.url),sub:host(r.url)});
        if(out.length>=12)return out;
      }
    }
    return out;
  }

  async function renderQuick(currentSeq){
    const a=await active();const data=await realData(a);if(currentSeq!==seq||input.value.trim())return;
    const rows=uniqueRows(data).slice(0,7);links.replaceChildren();
    if(!rows.length){const note=el('div',null,a?.private?'Private browsing does not show your regular local activity here.':'Your bookmarks and recent sites will appear here as you use Breeze.');note.style.cssText='grid-column:1/-1;padding:12px;color:var(--tx3);font-size:11.5px;line-height:1.5;text-align:center';links.append(note);return;}
    rows.forEach(r=>{const b=el('button','ovLink');const tile=el('span','tile',host(r.url).slice(0,1).toUpperCase()||'B');b.append(tile,el('span',null,(r.title||r.sub).slice(0,15)));b.title=r.title;b.onclick=()=>go(r.url);links.append(b);});
  }
  async function renderQuery(q,currentSeq){
    const a=await active();const data=await realData(a);if(currentSeq!==seq||input.value.trim()!==q)return;
    const needle=q.toLowerCase();const matches=uniqueRows(data).filter(r=>(r.title+' '+r.url).toLowerCase().includes(needle)).slice(0,6);
    const frag=document.createDocumentFragment();
    frag.append(section(looksLikeAddress(q)?'Open':'Search'));
    frag.append(row(looksLikeAddress(q)?'↗':'⌕',looksLikeAddress(q)?q:`Search for “${q}”`,looksLikeAddress(q)?'Open this address':'Use your selected search provider',()=>go(q),looksLikeAddress(q)?'Open':'Search'));
    if(matches.length){frag.append(section('Your Breeze library'));matches.forEach(r=>frag.append(row((host(r.url)[0]||'B').toUpperCase(),r.title,`${r.kind} · ${r.sub}`,()=>go(r.url))));}
    list.replaceChildren(frag);const first=list.querySelector('.ovRow');if(first)first.classList.add('sel');
  }
  function schedule(){
    const currentSeq=++seq;const q=input.value.trim();
    // Command mode intentionally keeps the base command renderer; the runtime
    // truth layer rewrites/removes prototype-only commands before use.
    if(q.startsWith('/'))return;
    setTimeout(()=>{
      if(currentSeq!==seq)return;
      if(!q){list.replaceChildren();links.dataset.on='1';renderQuick(currentSeq);}
      else{links.dataset.on='0';renderQuery(q,currentSeq);}
    },0);
  }

  input.addEventListener('input',schedule);
  input.addEventListener('focus',schedule);
  S.on('tab:update',st=>{if(st?.active&&document.documentElement.dataset.omni==='1')schedule();});
  schedule();
})();
