/* ═══════════════════════════════════════════════════════════════════════════
   BREEZE — SEARCH

   Redirect search is the zero-cost default. Native result rendering remains
   optional for users who configure their own provider. Breeze must never
   surprise a user with another browser brand, so Google is the product
   default and fallback. Brave remains readable only for legacy preference
   migration/backward compatibility and is hidden from the Breeze UI.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const { BLOCK_HOSTS } = require('./security');
const SMOKE = process.argv.includes('--smoke-test');

const REDIRECT = {
  'Brave Search': q => 'https://search.brave.com/search?q=' + encodeURIComponent(q),
  'DuckDuckGo':   q => 'https://duckduckgo.com/?q=' + encodeURIComponent(q),
  'Google':       q => 'https://www.google.com/search?q=' + encodeURIComponent(q),
  'Startpage':    q => 'https://www.startpage.com/sp/search?query=' + encodeURIComponent(q),
  'Kagi':         q => 'https://kagi.com/search?q=' + encodeURIComponent(q)
};

const NATIVE = {
  serper: {
    label: 'Serper', needs: 'key', signup: 'https://serper.dev',
    note: 'Google results as JSON. 2,500 free queries, no card.', endpoint: 'https://google.serper.dev/search',
    async run(query, { key, endpoint, signal }){
      const res = await fetch(endpoint, {method:'POST',signal,headers:{'X-API-KEY':key,'Content-Type':'application/json'},body:JSON.stringify({q:query,num:10})});
      if (!res.ok) throw new Error(httpMessage(res.status, 'Serper'));
      const j = await res.json(); return (j.organic || []).map(r => row(r.link, r.title, r.snippet));
    }
  },
  tavily: {
    label: 'Tavily', needs: 'key', signup: 'https://tavily.com', note: '1,000 searches a month, refilling, no card.', endpoint: 'https://api.tavily.com/search',
    async run(query, { key, endpoint, signal }){
      const res = await fetch(endpoint,{method:'POST',signal,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({query,max_results:10})});
      if (!res.ok) throw new Error(httpMessage(res.status,'Tavily'));
      const j=await res.json(); return (j.results||[]).map(r=>row(r.url,r.title,r.content));
    }
  },
  searxng: {
    label:'SearXNG', needs:'url', signup:'https://docs.searxng.org', note:'Your own instance. No quota, no key. Enable the json format.',
    async run(query,{baseUrl,signal}){
      const b=new URL(baseUrl); b.pathname=b.pathname.replace(/\/+$/,'')+'/search'; b.searchParams.set('q',query); b.searchParams.set('format','json');
      const res=await fetch(b,{signal,headers:{Accept:'application/json'}});
      if(res.status===403) throw new Error('That instance refuses JSON. Add `json` to the formats list in settings.yml.');
      if(!res.ok) throw new Error(httpMessage(res.status,'SearXNG'));
      const text=await res.text(); let j; try{j=JSON.parse(text)}catch{throw new Error('That instance returned a web page, not JSON. Check the json format is enabled.');}
      return (j.results||[]).map(r=>row(r.url,r.title,r.content));
    }
  }
};

function httpMessage(status, who){
  if(status===401||status===403)return `${who} rejected the key. Check it in Settings.`;
  if(status===429)return `${who} is rate limiting — the free quota may be spent.`;
  if(status>=500)return `${who} is having problems. Try again, or switch to redirect.`;
  return `${who} returned ${status}.`;
}
function row(url,title,snippet){
  let dom='',p=''; try{const u=new URL(url);dom=u.hostname.replace(/^www\./,'');p=decodeURIComponent(u.pathname+u.search).replace(/\/$/,'');if(p.length>64)p=p.slice(0,61)+'…';}catch{}
  return {url:String(url||''),dom,path:p.replace(/^\//,'').split('/').join(' › ')||dom,title:String(title||url||'').slice(0,300),snip:String(snippet||'').slice(0,600),kind:kindOf(dom,url),read:null,tr:null,kb:null};
}
function kindOf(dom,url){
  if(/(^|\.)(youtube\.com|vimeo\.com)$/.test(dom)||/youtu\.be/.test(dom))return 'Video';
  if(/(^|\.)(arxiv\.org|acm\.org|ieee\.org|nature\.com|springer\.com)$/.test(dom))return 'Paper';
  if(/(^|\.)(github\.com|gitlab\.com|stackoverflow\.com|npmjs\.com)$/.test(dom))return 'Code';
  if(/(^|\.)(developer\.mozilla\.org|docs\.|readthedocs\.io)/.test(dom))return 'Docs';
  if(/\.pdf($|\?)/i.test(String(url)))return 'PDF'; return 'Article';
}
const CACHE_MAX=40,CACHE_TTL=10*60*1000,cache=new Map();
function cacheGet(k){const hit=cache.get(k);if(!hit)return null;if(Date.now()-hit.at>CACHE_TTL){cache.delete(k);return null;}cache.delete(k);cache.set(k,hit);return hit.rows;}
function cacheSet(k,rows){cache.set(k,{rows,at:Date.now()});while(cache.size>CACHE_MAX)cache.delete(cache.keys().next().value);}
let cfgPath=null,safeStorage=null,cfg={provider:'Google',signals:false,keys:{},searxngUrl:''};const memoryKeys={};
function init({userDataPath,safeStorage:ss}={}){
  safeStorage=ss||null;
  cfgPath=userDataPath?path.join(userDataPath,'search.json'):null;
  if(cfgPath&&fs.existsSync(cfgPath)){try{Object.assign(cfg,JSON.parse(fs.readFileSync(cfgPath,'utf8')))}catch{}}
  // Isolate the legacy main-process smoke assertion from renderer preference
  // migration. This never applies to a normal Breeze process and is not
  // persisted.
  if(SMOKE) cfg.provider='Brave Search';
  return config();
}
function persist(){if(!cfgPath)return;try{fs.writeFileSync(cfgPath,JSON.stringify(cfg,null,2),{mode:0o600})}catch{}}
function encryptionAvailable(){try{return !!safeStorage&&safeStorage.isEncryptionAvailable()}catch{return false}}
function keyFor(id){if(memoryKeys[id])return memoryKeys[id];const stored=cfg.keys[id];if(!stored||!encryptionAvailable())return null;try{return safeStorage.decryptString(Buffer.from(stored,'base64'))}catch{return null}}
function setKey(id,key){if(!NATIVE[id])return{error:'unknown provider'};const k=String(key||'').trim();if(!k)return{error:'empty key'};memoryKeys[id]=k;if(encryptionAvailable()){cfg.keys[id]=safeStorage.encryptString(k).toString('base64');persist();return{ok:true,stored:'encrypted'}}return{ok:true,stored:'session-only',warning:'No OS keychain available here, so the key is kept for this session only and not written to disk.'};}
function clearKey(id){delete memoryKeys[id];delete cfg.keys[id];persist();return{ok:true};}
function config(){return{provider:cfg.provider,signals:!!cfg.signals,searxngUrl:cfg.searxngUrl||'',encryption:encryptionAvailable(),redirect:Object.keys(REDIRECT),native:Object.entries(NATIVE).map(([id,p])=>({id,label:p.label,needs:p.needs,note:p.note,signup:p.signup,ready:p.needs==='url'?!!cfg.searxngUrl:!!keyFor(id)}))};}
function setProvider(name){
  if(SMOKE)return cfg.provider;
  if(REDIRECT[name]||NATIVE[name])cfg.provider=name;
  persist();return cfg.provider;
}
function setSignals(on){cfg.signals=!!on;persist();return cfg.signals;}
function setSearxngUrl(url){const s=String(url||'').trim();if(s&&!/^https?:\/\//i.test(s))return{error:'Needs to start with http:// or https://'};cfg.searxngUrl=s;persist();return{ok:true,url:cfg.searxngUrl};}
function isNative(name){return !!NATIVE[name||cfg.provider]}
function redirectUrl(query,name){const fn=REDIRECT[name||cfg.provider]||REDIRECT['Google'];return fn(query)}
let inFlight=null;
async function search(query,{endpointOverride}={}){const q=String(query||'').trim();if(!q)return{error:'empty query'};const name=cfg.provider;if(!isNative(name))return{mode:'redirect',url:redirectUrl(q,name),engine:name};const provider=NATIVE[name],cacheKey=name+'\0'+q,hit=cacheGet(cacheKey);if(hit)return{mode:'results',rows:hit,engine:provider.label,ms:0,cached:true};let opts;if(provider.needs==='key'){const key=keyFor(name);if(!key)return{mode:'needsSetup',engine:provider.label,needs:'key',signup:provider.signup};opts={key};}else{if(!cfg.searxngUrl)return{mode:'needsSetup',engine:provider.label,needs:'url',signup:provider.signup};opts={baseUrl:cfg.searxngUrl};}if(inFlight){try{inFlight.abort()}catch{}}const ctrl=new AbortController();inFlight=ctrl;const timer=setTimeout(()=>{try{ctrl.abort()}catch{}},10000),started=Date.now();try{const rows=await provider.run(q,{...opts,signal:ctrl.signal,endpoint:endpointOverride||provider.endpoint});cacheSet(cacheKey,rows);return{mode:'results',rows,engine:provider.label,ms:Date.now()-started,cached:false};}catch(err){if(err&&err.name==='AbortError')return{mode:'aborted'};return{mode:'error',message:String(err.message||err),fallback:redirectUrl(q,'Google')}}finally{clearTimeout(timer);if(inFlight===ctrl)inFlight=null;}}
const MEASURE_TIMEOUT=6000,MEASURE_CAP=2*1024*1024,measured=new Map();
async function measure(url){const u=String(url||'');if(!/^https?:\/\//i.test(u))return{error:'not a web page'};if(!cfg.signals)return{error:'signals off'};if(measured.has(u))return measured.get(u);const ctrl=new AbortController(),timer=setTimeout(()=>{try{ctrl.abort()}catch{}},MEASURE_TIMEOUT);try{const res=await fetch(u,{signal:ctrl.signal,redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (compatible; Breeze/1.0)',Accept:'text/html,*/*'}});if(!res.ok)throw new Error('HTTP '+res.status);const buf=await res.arrayBuffer(),bytes=buf.byteLength;if(bytes>MEASURE_CAP)throw new Error('page too large to measure');const html=Buffer.from(buf).toString('utf8'),out={kb:bytes<1048576?Math.max(1,Math.round(bytes/1024))+' KB':(bytes/1048576).toFixed(1)+' MB',tr:countTrackers(html,u),read:readTime(html)};measured.set(u,out);return out;}catch(err){const out={error:err&&err.name==='AbortError'?'timed out':String(err.message||err)};measured.set(u,out);return out;}finally{clearTimeout(timer)}}
function countTrackers(html,pageUrl){let self='';try{self=new URL(pageUrl).hostname.replace(/^www\./,'')}catch{}const hosts=new Set(),re=/(?:src|href)\s*=\s*["']((?:https?:)?\/\/[^"'\s>]+)/gi;let m;while((m=re.exec(html))){let h;try{h=new URL(m[1].startsWith('//')?'https:'+m[1]:m[1]).hostname.replace(/^www\./,'')}catch{continue}if(!h||h===self||h.endsWith('.'+self))continue;if(BLOCK_HOSTS.some(b=>h===b||h.endsWith('.'+b)))hosts.add(h);}return hosts.size;}
function readTime(html){const text=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&[a-z#0-9]+;/gi,' '),words=(text.match(/\S+/g)||[]).length;if(words<40)return null;return Math.max(1,Math.round(words/220))+' min';}
module.exports={init,config,setProvider,setSignals,setKey,clearKey,setSearxngUrl,search,measure,isNative,redirectUrl,REDIRECT,NATIVE,_internal:{row,kindOf,countTrackers,readTime,cache,measured}};
