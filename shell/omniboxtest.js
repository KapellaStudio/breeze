'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const omnibox=require('./omnibox');

assert.equal(omnibox.resolve('hello world').kind,'plain');
let r=omnibox.resolve('!g breeze browser');
assert.equal(r.kind,'engine');assert.equal(r.engine,'Google');assert.match(r.url,/google\.com\/search\?q=breeze%20browser/);
r=omnibox.resolve('!ddg private browser');assert.equal(r.engine,'DuckDuckGo');assert.match(r.url,/duckduckgo\.com/);
r=omnibox.resolve('!yt ambient music');assert.equal(r.kind,'direct');assert.equal(r.engine,'YouTube');assert.match(r.url,/youtube\.com\/results/);
r=omnibox.resolve('!w electron');assert.equal(r.engine,'Wikipedia');
assert.ok(omnibox.shortcuts().some(x=>x.token==='@tabs'));
assert.ok(omnibox.shortcuts().some(x=>x.token==='!gh'));

const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  res.setHeader('content-type','application/json');
  if(u.pathname==='/google')return res.end(JSON.stringify(['bre',[ 'breeze browser','breeze weather','breeze browser' ]]));
  if(u.pathname==='/ddg')return res.end(JSON.stringify([{phrase:'duck one'},{phrase:'duck two'}]));
  res.statusCode=404;res.end('{}');
});
server.listen(0,'127.0.0.1',async()=>{
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    let s=await omnibox.suggest('bre',{provider:'Google',endpointOverride:base+'/google'});
    assert.deepEqual(s.suggestions,['breeze browser','breeze weather']);
    assert.equal(s.remote,true);
    s=await omnibox.suggest('duck',{provider:'DuckDuckGo',endpointOverride:base+'/ddg'});
    assert.deepEqual(s.suggestions,['duck one','duck two']);
    s=await omnibox.suggest('secret',{provider:'Google',privateMode:true,endpointOverride:base+'/google'});
    assert.equal(s.remote,false);assert.equal(s.reason,'private');assert.deepEqual(s.suggestions,[]);
    s=await omnibox.suggest('secret',{provider:'Google',enabled:false,endpointOverride:base+'/google'});
    assert.equal(s.reason,'disabled');
    s=await omnibox.suggest('hello',{provider:'Brave Search'});
    assert.equal(s.reason,'provider-no-keyless-suggestions');
    console.log('Breeze omnibox tests passed');
  }finally{server.close();}
});
