'use strict';

/* Breeze Split View state policy.
   This module deliberately knows nothing about Electron/WebContents. The main
   process owns renderers and asks this object only which two tab ids should be
   visible and at what ratio. Keeping policy separate makes close/swap/restore
   behavior deterministic and testable without granting renderer code any new
   capability. */

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
    this.secondaryTabId=null;
    this.ratio=DEFAULT_RATIO;
  }

  get active(){ return this.secondaryTabId!==null; }

  open(primaryId, secondaryId, canUse=()=>true){
    const primary=tabId(primaryId), secondary=tabId(secondaryId);
    if(!primary||!secondary) return {error:'invalid tab'};
    if(primary===secondary) return {error:'choose a different tab'};
    if(!canUse(primary)||!canUse(secondary)) return {error:'tab cannot enter Split View'};
    this.secondaryTabId=secondary;
    return this.snapshot(primary);
  }

  close(primaryId){
    this.secondaryTabId=null;
    return this.snapshot(tabId(primaryId));
  }

  setRatio(value,primaryId){
    this.ratio=ratio(value);
    return this.snapshot(tabId(primaryId));
  }

  swap(primaryId){
    const primary=tabId(primaryId);
    if(!primary||!this.active) return {error:'Split View is not active'};
    const nextPrimary=this.secondaryTabId;
    this.secondaryTabId=primary;
    return this.snapshot(nextPrimary);
  }

  /* Closing the secondary pane collapses Split View. Closing the primary pane
     promotes the secondary tab so the remaining page never disappears. */
  tabClosed(closedId,primaryId){
    const closed=tabId(closedId), primary=tabId(primaryId);
    if(!closed) return {primaryTabId:primary,...this.snapshot(primary)};
    if(closed===this.secondaryTabId){
      this.secondaryTabId=null;
      return {primaryTabId:primary,...this.snapshot(primary)};
    }
    if(this.active && closed===primary){
      const promoted=this.secondaryTabId;
      this.secondaryTabId=null;
      return {primaryTabId:promoted,...this.snapshot(promoted),promoted:true};
    }
    return {primaryTabId:primary,...this.snapshot(primary)};
  }

  /* Tab ids are process-local, so persistence records a stable slot index and
     ratio. main.js maps the saved slot back to the recreated tab id. */
  persisted(primaryId,orderedTabIds){
    const primary=tabId(primaryId);
    const ids=Array.isArray(orderedTabIds)?orderedTabIds.map(tabId):[];
    return {
      active:this.active,
      ratio:this.ratio,
      primaryIndex:primary?ids.indexOf(primary):-1,
      secondaryIndex:this.active?ids.indexOf(this.secondaryTabId):-1
    };
  }

  restore(saved,orderedTabIds,canUse=()=>true){
    this.secondaryTabId=null;
    this.ratio=ratio(saved?.ratio);
    if(!saved?.active) return {primaryTabId:null,...this.snapshot(null)};
    const ids=Array.isArray(orderedTabIds)?orderedTabIds.map(tabId):[];
    const primary=ids[Number(saved.primaryIndex)];
    const secondary=ids[Number(saved.secondaryIndex)];
    if(!primary||!secondary||primary===secondary||!canUse(primary)||!canUse(secondary)){
      return {primaryTabId:primary||null,...this.snapshot(primary||null)};
    }
    this.secondaryTabId=secondary;
    return {primaryTabId:primary,...this.snapshot(primary)};
  }

  snapshot(primaryId){
    return {
      active:this.active,
      primaryTabId:tabId(primaryId),
      secondaryTabId:this.secondaryTabId,
      ratio:this.ratio
    };
  }
}

module.exports={SplitState,MIN_RATIO,MAX_RATIO,DEFAULT_RATIO,ratio};
