'use strict';
const {SplitState,ratio}=require('./split');
let pass=0,fail=0;
const ok=(name,cond,detail='')=>{console.log((cond?'PASS':'FAIL')+'  '+name+(detail?'  ['+detail+']':''));cond?pass++:fail++;};

const s=new SplitState();
ok('starts collapsed',s.active===false&&s.secondaryTabId===null&&s.ratio===0.5);
ok('ratio clamps low',ratio(0.1)===0.25);
ok('ratio clamps high',ratio(0.9)===0.75);
ok('ratio keeps a normal split',ratio(0.62)===0.62);

let r=s.open(1,2);
ok('opens two distinct tabs',r.active===true&&r.primaryTabId===1&&r.secondaryTabId===2);
ok('refuses same tab in both panes',s.open(1,1).error==='choose a different tab');
ok('policy can reject sensitive tab',s.open(1,3,id=>id!==3).error==='tab cannot enter Split View');

r=s.setRatio(0.68,1);
ok('resize is retained',r.ratio===0.68);
r=s.swap(1);
ok('swap promotes secondary without a third pane',r.primaryTabId===2&&r.secondaryTabId===1&&r.active===true);
r=s.tabClosed(1,2);
ok('closing secondary collapses split',r.primaryTabId===2&&r.active===false);

s.open(2,4);r=s.tabClosed(2,2);
ok('closing primary promotes secondary',r.promoted===true&&r.primaryTabId===4&&r.active===false);

s.open(4,5);s.setRatio(0.63,4);
const saved=s.persisted(4,[4,5,7]);
ok('persisted form stores stable slots, not renderer ids',saved.primaryIndex===0&&saved.secondaryIndex===1&&saved.ratio===0.63);
const restored=new SplitState();r=restored.restore(saved,[11,12,13]);
ok('restore remaps slots to new tab ids',r.primaryTabId===11&&r.secondaryTabId===12&&r.active===true&&r.ratio===0.63);
const refused=new SplitState();r=refused.restore(saved,[11,12,13],id=>id!==12);
ok('restore fails closed when a pane is no longer eligible',r.active===false&&r.primaryTabId===11);

console.log(`\nSplit View state: ${pass}/${pass+fail}`);process.exit(fail?1:0);
