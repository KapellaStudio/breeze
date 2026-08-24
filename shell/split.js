'use strict';

/* Breeze Split View state policy.
   Pane position and focus are deliberately separate. Clicking the right pane
   must not make both pages jump sides just because that pane became the target
   for the omnibox. Electron owns renderers; this object only owns which tab is
   left/right, which one is focused, and the divider ratio. */

const MIN_RATIO = 0.25;
const MAX_RATIO = 0.75;
const DEFAULT_RATIO = 0.5;

function tabId(value){
  const n=Number(value);
  return Number.isInteger(n) && n>0 ? n : null;
}
function ratio(value){
  const n=Number(value);
  if(!Number.isFinite(n)) return DEFAULT_RATIO;
  return Math.max(MIN_RATIO,Math.min(MAX_RATIO,n));
}

class SplitState {
  constructor(){
    this.leftTabId=null;
    this.rightTabId=null;
    this.focusedTabId=null;
    this.ratio=DEFAULT_RATIO;
  }

  get active(){ return this.leftTabId!==null && this.rightTabId!==null; }
  has(id){ const n=tabId(id); return !!n && (n===this.leftTabId || n===this.rightTabId); }

  open(primaryId, secondaryId, canUse=()=>true){
    const left=tabId(primaryId), right=tabId(secondaryId);
    if(!left||!right) return {error:'invalid tab'};
    if(left===right) return {error:'choose a different tab'};
    if(!canUse(left)||!canUse(right)) return {error:'tab cannot enter Split View'};
    this.leftTabId=left;
    this.rightTabId=right;
    this.focusedTabId=left;
    return this.snapshot();
  }

  close(){
    const focused=this.focusedTabId;
    this.leftTabId=null;
    this.rightTabId=null;
    this.focusedTabId=focused;
    return this.snapshot();
  }

  focus(id){
    const n=tabId(id);
    if(!this.active || !this.has(n)) return {error:'tab is not in Split View'};
    this.focusedTabId=n;
    return this.snapshot();
  }

  /* Selecting another ordinary tab replaces whichever pane currently owns
     keyboard/omnibox focus. The other pane remains exactly where it was. */
  replaceFocused(id,canUse=()=>true){
    const n=tabId(id);
    if(!this.active||!n) return {error:'Split View is not active'};
    if(!canUse(n)) return {error:'tab cannot enter Split View'};
    if(this.has(n)){this.focusedTabId=n;return this.snapshot();}
    if(this.focusedTabId===this.rightTabId)this.rightTabId=n;
    else this.leftTabId=n;
    this.focusedTabId=n;
    return this.snapshot();
  }

  setRatio(value){
    this.ratio=ratio(value);
    return this.snapshot();
  }

  swap(){
    if(!this.active) return {error:'Split View is not active'};
    [this.leftTabId,this.rightTabId]=[this.rightTabId,this.leftTabId];
    return this.snapshot();
  }

  /* Closing either visible pane collapses Split View and keeps the survivor as
     the focused normal tab. Closing a hidden tab leaves the split untouched. */
  tabClosed(closedId){
    const closed=tabId(closedId);
    if(!closed||!this.active||!this.has(closed)) return {survivorTabId:this.focusedTabId,...this.snapshot()};
    const survivor=closed===this.leftTabId?this.rightTabId:this.leftTabId;
    this.leftTabId=null;
    this.rightTabId=null;
    this.focusedTabId=survivor;
    return {survivorTabId:survivor,collapsed:true,...this.snapshot()};
  }

  persisted(orderedTabIds){
    const ids=Array.isArray(orderedTabIds)?orderedTabIds.map(tabId):[];
    return {
      active:this.active,
      ratio:this.ratio,
      leftIndex:this.active?ids.indexOf(this.leftTabId):-1,
      rightIndex:this.active?ids.indexOf(this.rightTabId):-1,
      focusedIndex:this.focusedTabId?ids.indexOf(this.focusedTabId):-1
    };
  }

  restore(saved,orderedTabIds,canUse=()=>true){
    this.leftTabId=null;this.rightTabId=null;this.focusedTabId=null;
    this.ratio=ratio(saved?.ratio);
    const ids=Array.isArray(orderedTabIds)?orderedTabIds.map(tabId):[];
    const fallback=ids[Number(saved?.focusedIndex)]||ids[0]||null;
    if(!saved?.active){this.focusedTabId=fallback;return this.snapshot();}
    const left=ids[Number(saved.leftIndex)], right=ids[Number(saved.rightIndex)];
    if(!left||!right||left===right||!canUse(left)||!canUse(right)){
      this.focusedTabId=fallback;
      return this.snapshot();
    }
    this.leftTabId=left;this.rightTabId=right;
    const focused=ids[Number(saved.focusedIndex)];
    this.focusedTabId=(focused===left||focused===right)?focused:left;
    return this.snapshot();
  }

  snapshot(){
    return {
      active:this.active,
      leftTabId:this.leftTabId,
      rightTabId:this.rightTabId,
      focusedTabId:this.focusedTabId,
      ratio:this.ratio
    };
  }
}

module.exports={SplitState,MIN_RATIO,MAX_RATIO,DEFAULT_RATIO,ratio};
