'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const data=require('./workspace-data');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-context-'));
try{
  data.init(root);
  assert.ok(data.addQueue({url:'javascript:alert(1)',title:'bad'}).error);
  let q=data.addQueue({url:'https://example.com/article',title:'Article',workspace:'default'});
  assert.equal(q.ok,true);
  assert.equal(data.listQueue('default').length,1);
  q=data.addQueue({url:'https://example.com/article',title:'Article updated',workspace:'default'});
  assert.equal(q.existing,true,'duplicate queue URL is moved/updated instead of duplicated');
  assert.equal(data.listQueue('default')[0].title,'Article updated');

  const note=data.addNote({url:'https://example.com/article',title:'Article',workspace:'default',body:'Keep this thought.'});
  assert.equal(note.ok,true);
  assert.equal(data.listNotes('default').length,1);
  assert.equal(data.updateNote(note.note.id,'Updated thought.').ok,true);
  assert.equal(data.listNotes('default')[0].body,'Updated thought.');

  const snap=data.saveSnapshot({workspace:'default',tabs:[
    {url:'https://example.com/a',title:'A',workspace:'default',sealed:false,private:false},
    {url:'https://example.com/private',title:'Private',workspace:'private',sealed:true,private:true},
    {url:'file:///Users/test/secret.pdf',title:'Local PDF',workspace:'default',private:false}
  ]});
  assert.equal(snap.ok,true);
  assert.equal(snap.snapshot.tabs.length,1,'private tabs and local-file paths are excluded');
  const same=data.saveSnapshot({workspace:'default',tabs:[{url:'https://example.com/a',title:'A',workspace:'default',sealed:false,private:false}]});
  assert.equal(same.unchanged,true,'unchanged automatic snapshots dedupe');
  assert.equal(data.listSnapshots('default').length,1);

  data.init(root);
  assert.equal(data.listQueue('default').length,1,'queue persists');
  assert.equal(data.listNotes('default').length,1,'notes persist');
  assert.equal(data.listSnapshots('default').length,1,'snapshots persist');
  assert.equal(data.removeQueue(data.listQueue('default')[0].id).ok,true);
  assert.equal(data.removeNote(data.listNotes('default')[0].id).ok,true);
  assert.equal(data.removeSnapshot(data.listSnapshots('default')[0].id).ok,true);

  console.log('Breeze local context tests passed');
}finally{fs.rmSync(root,{recursive:true,force:true});}
