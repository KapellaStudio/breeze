/* Breeze first-run preference gate.
   Product migrations may prepare the visible chrome during startup, but they
   must not mutate a fresh profile's persisted search preference before the
   user has completed first-run setup. Once onboarding is complete, calls pass
   straight through to the real shell API. */
(function(){
  'use strict';
  const S=window.__BREEZE_SHELL__;
  if(!S||!S.isShell||typeof S.setSearchProvider!=='function'||typeof S.firstRunStatus!=='function')return;
  const original=S.setSearchProvider.bind(S);
  S.setSearchProvider=async function(name){
    if(name==='Google'){
      const status=await S.firstRunStatus().catch(()=>null);
      if(status && status.firstRunComplete===false)return false;
    }
    return original(name);
  };
})();
