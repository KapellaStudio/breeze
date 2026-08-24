'use strict';
const {SplitState,ratio}=require('./split');
let pass=0,fail=0;
const ok=(name,cond,detail='')=>{console.log((cond?'PASS':'FAIL')+'  '+name+(detail?'  ['+detail+']':''));cond?pass++:fail++;};

const s=new SplitState();
ok('starts collapsed',!s.active&&s.leftTabId===null&&s.rightTabId===null&&s.ratio===0.5);
ok('ratio clamps low',ratio(0.1)===0.25);
ok('ratio clamps high',ratio(0.9)===0.75);
ok('ratio keeps a normal split',ratio(0.62)===0.62);

let r=s.open(1,2);
ok('opens two distinct stable panes',r.active&&r.leftTabId===1&&r.rightTabId===2&&r.focusedTabId===1);
ok('refuses same tab in both panes',s.open(1,1).error==='choose a different tab');
ok('policy can reject sensitive tab',s.open(1,3,id=>id!==3).error==='tab cannot enter Split View');

r=s.focus(2);
ok('focus moves without swapping pane position',r.leftTabId===1&&r.rightTabId===2&&r.focusedTabId===2);
r=s.replaceFocused(3);
ok('selecting another tab replaces only focused pane',r.leftTabId===1&&r.rightTabId===3&&r.focusedTabId===3);
r=s.setRatio(0.68);
ok('resize is retained',r.ratio===0.68);
r=s.swap();
ok('explicit swap moves panes but keeps focused tab',r.leftTabId===3&&r.rightTabId===1&&r.focusedTabId===3);
r=s.tabClosed(1);
ok('closing a visible pane collapses to survivor',r.collapsed===true&&r.survivorTabId===3&&!r.active&&r.focusedTabId===3);

s.open(4,5);s.focus(5);s.setRatio(0.63);
const saved=s.persisted([4,5,7]);
ok('persisted form stores stable slots, not renderer ids',saved.leftIndex===0&&saved.rightIndex===1&&saved.focusedIndex===1&&saved.ratio===0.63);
const restored=new SplitState();r=restored.restore(saved,[11,12,13]);
ok('restore remaps slots and focus to new tab ids',r.leftTabId===11&&r.rightTabId===12&&r.focusedTabId===12&&r.active&&r.ratio===0.63);
const refused=new SplitState();r=refused.restore(saved,[11,12,13],id=>id!==12);
ok('restore fails closed when a pane is no longer eligible',!r.active&&r.focusedTabId===12);

console.log(`\nSplit View state: ${pass}/${pass+fail}`);process.exit(fail?1:0);
