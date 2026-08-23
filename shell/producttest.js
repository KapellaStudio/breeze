'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const prefs=require('./preferences');
const workspaces=require('./workspaces');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-product-'));
try{
  prefs.init(root);
  assert.equal(prefs.get().theme,'light');
  assert.equal(prefs.set('theme','dark').ok,true);
  assert.equal(prefs.set('askwhere',true).ok,true);
  assert.equal(prefs.set('theme','neon').error,'invalid preference value');
  assert.equal(prefs.set('unknown',true).error,'unknown preference');
  prefs.init(root);
  assert.equal(prefs.get().theme,'dark','theme persists');
  assert.equal(prefs.get().askwhere,true,'download preference persists');
  assert.equal(prefs.setMany({accent:'mint',tabs:'classic',provenance:false}).ok,true);
  assert.equal(prefs.get().accent,'mint');
  assert.equal(prefs.get().provenance,false);

  workspaces.init(root);
  let list=workspaces.list();
  assert.equal(list.length,1);
  assert.equal(list[0].id,'default');
  assert.equal(list[0].name,'Personal');
  assert.equal(list[0].sealed,false);
  const created=workspaces.create({name:'Client',sealed:true,accent:'teal'});
  assert.equal(created.ok,true);
  assert.equal(created.workspace.sealed,true);
  assert.equal(workspaces.update(created.workspace.id,{name:'Client Work'}).ok,true);
  assert.equal(workspaces.get(created.workspace.id).name,'Client Work');
  assert.ok(workspaces.remove('default').error,'default workspace is protected');
  workspaces.init(root);
  list=workspaces.list();
  assert.equal(list.some(w=>w.name==='Client Work'&&w.sealed),true,'workspace persists');
  assert.equal(workspaces.remove(created.workspace.id).ok,true);
  assert.equal(workspaces.get(created.workspace.id),null);

  console.log('Breeze persistent product-state tests passed');
}finally{
  fs.rmSync(root,{recursive:true,force:true});
}
