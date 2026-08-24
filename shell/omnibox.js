/* Breeze omnibox search helpers.
   This module owns only query shortcuts and optional remote autocomplete. It
   never persists queries. Remote suggestions are disabled in Private mode and
   can be disabled globally. */
'use strict';

const ENGINE_SHORTCUTS=Object.freeze({
  b:'Brave Search',brave:'Brave Search',
  d:'DuckDuckGo',ddg:'DuckDuckGo',duck:'DuckDuckGo',
  g:'Google',google:'Google',
  sp:'Startpage',startpage:'Startpage',
  k:'Kagi',kagi:'Kagi'
});
const ENGINE_URLS=Object.freeze({
  'Brave Search':q=>'https://search.brave.com/search?q='+encodeURIComponent(q),
  DuckDuckGo:q=>'https://duckduckgo.com/?q='+encodeURIComponent(q),
  Google:q=>'https://www.google.com/search?q='+encodeURIComponent(q),
  Startpage:q=>'https://www.startpage.com/sp/search?query='+encodeURIComponent(q),
  Kagi:q=>'https://kagi.com/search?q='+encodeURIComponent(q)
});
const DIRECT_SHORTCUTS=Object.freeze({
  yt:{label:'YouTube',url:q=>'https://www.youtube.com/results?search_query='+encodeURIComponent(q)},
  youtube:{label:'YouTube',url:q=>'https://www.youtube.com/results?search_query='+encodeURIComponent(q)},
  w:{label:'Wikipedia',url:q=>'https://en.wikipedia.org/w/index.php?search='+encodeURIComponent(q)},
  wiki:{label:'Wikipedia',url:q=>'https://en.wikipedia.org/w/index.php?search='+encodeURIComponent(q)},
  gh:{label:'GitHub',url:q=>'https://github.com/search?q='+encodeURIComponent(q)},
  github:{label:'GitHub',url:q=>'https://github.com/search?q='+encodeURIComponent(q)}
});
const SCOPES=Object.freeze([
  {token:'@tabs',label:'Open tabs'},
  {token:'@history',label:'History'},
  {token:'@bookmarks',label:'Bookmarks'},
  {token:'@queue',label:'Reading Queue'}
]);

function cleanQuery(v){return String(v||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,400);}
function resolve(input,defaultProvider='Brave Search'){
  const raw=cleanQuery(input);if(!raw)return{kind:'empty',value:''};
  const m=raw.match(/^!([a-z0-9_-]+)(?:\s+(.+))?$/i);
  if(!m)return{kind:'plain',value:raw};
  const token=m[1].toLowerCase(),query=cleanQuery(m[2]||'');
  if(!query)return{kind:'shortcut-help',token,value:raw};
  const engine=ENGINE_SHORTCUTS[token];
  if(engine){return{kind:'engine',token,query,engine,url:(ENGINE_URLS[engine]||ENGINE_URLS[defaultProvider]||ENGINE_URLS['Brave Search'])(query)};}
  const direct=DIRECT_SHORTCUTS[token];
  if(direct)return{kind:'direct',token,query,engine:direct.label,url:direct.url(query)};
  return{kind:'plain',value:raw};
}
function shortcuts(){
  return [
    {token:'!b',label:'Brave Search'},{token:'!ddg',label:'DuckDuckGo'},
    {token:'!g',label:'Google'},{token:'!sp',label:'Startpage'},
    {token:'!k',label:'Kagi'},{token:'!yt',label:'YouTube'},
    {token:'!w',label:'Wikipedia'},{token:'!gh',label:'GitHub'},...SCOPES
  ];
}

const suggestionCache=new Map();
const CACHE_TTL=5*60*1000;
function cached(key){const hit=suggestionCache.get(key);if(!hit)return null;if(Date.now()-hit.at>CACHE_TTL){suggestionCache.delete(key);return null;}return hit.value;}
function put(key,value){suggestionCache.set(key,{at:Date.now(),value});while(suggestionCache.size>80)suggestionCache.delete(suggestionCache.keys().next().value);}
function uniqueStrings(values){const seen=new Set(),out=[];for(const v of values||[]){const s=cleanQuery(v);const k=s.toLowerCase();if(!s||seen.has(k))continue;seen.add(k);out.push(s);if(out.length>=6)break;}return out;}
function parseGoogle(json){return uniqueStrings(Array.isArray(json)&&Array.isArray(json[1])?json[1]:[]);}
function parseDuck(json){
  if(Array.isArray(json)&&Array.isArray(json[1]))return uniqueStrings(json[1]);
  if(Array.isArray(json))return uniqueStrings(json.map(x=>typeof x==='string'?x:x?.phrase));
  return[];
}
function providerSpec(provider,q,endpointOverride){
  if(provider==='Google')return{provider,url:endpointOverride||('https://suggestqueries.google.com/complete/search?client=firefox&q='+encodeURIComponent(q)),parse:parseGoogle};
  if(provider==='DuckDuckGo')return{provider,url:endpointOverride||('https://duckduckgo.com/ac/?q='+encodeURIComponent(q)+'&type=list'),parse:parseDuck};
  return null;
}
async function suggest(query,{provider='Brave Search',privateMode=false,enabled=true,endpointOverride=null,fetchImpl=globalThis.fetch}={}){
  const q=cleanQuery(query);
  if(!enabled)return{suggestions:[],provider,remote:false,reason:'disabled'};
  if(privateMode)return{suggestions:[],provider,remote:false,reason:'private'};
  if(q.length<2||q.startsWith('!')||q.startsWith('@'))return{suggestions:[],provider,remote:false,reason:'not-applicable'};
  const spec=providerSpec(provider,q,endpointOverride);if(!spec)return{suggestions:[],provider,remote:false,reason:'provider-no-keyless-suggestions'};
  const key=provider+'\0'+q.toLowerCase();const hit=cached(key);if(hit)return{suggestions:hit,provider,remote:true,cached:true};
  if(typeof fetchImpl!=='function')return{suggestions:[],provider,remote:false,reason:'fetch-unavailable'};
  const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),2200);
  try{
    const res=await fetchImpl(spec.url,{signal:ctrl.signal,headers:{Accept:'application/json','User-Agent':'Breeze Browser'}});
    if(!res.ok)return{suggestions:[],provider,remote:false,reason:'http-'+res.status};
    const json=await res.json();const values=spec.parse(json).filter(x=>x.toLowerCase()!==q.toLowerCase());put(key,values);
    return{suggestions:values,provider,remote:true,cached:false};
  }catch(err){return{suggestions:[],provider,remote:false,reason:err?.name==='AbortError'?'timeout':'network'};}
  finally{clearTimeout(timer);}
}

module.exports={resolve,shortcuts,suggest,SCOPES,ENGINE_SHORTCUTS,DIRECT_SHORTCUTS,_internal:{cleanQuery,parseGoogle,parseDuck,suggestionCache}};
