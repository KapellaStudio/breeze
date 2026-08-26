/* Breeze onboarding native-surface guard.
   The Electron web page lives in a WebContentsView above the browser chrome.
   While first-run setup is open, hide that native page surface so real mouse
   input reaches the onboarding dialog. Restore the surface immediately when
   setup closes. */
(function(){
  'use strict';
  const S=window.__BREEZE_SHELL__;
  if(!S||!S.isShell||typeof S.setInternalView!=='function')return;

  let enforceTimer=null;
  function internalForChrome(){
    return document.documentElement.dataset.view !== 'browse';
  }
  function stopEnforcing(){
    if(enforceTimer){clearInterval(enforceTimer);enforceTimer=null;}
  }
  function hideNativeSurface(){
    S.setInternalView(true).catch?.(()=>{});
  }
  function sync(){
    const setup=document.querySelector('.bzLaunch');
    const open=setup?.dataset.on==='1';
    if(open){
      hideNativeSurface();
      // The shell adapter can perform a late initial browse-surface sync after
      // first-run markup is mounted. Keep first-run authoritative until the
      // dialog closes so a native page can never drift back above its buttons.
      if(!enforceTimer) enforceTimer=setInterval(()=>{
        if(document.querySelector('.bzLaunch')?.dataset.on==='1') hideNativeSurface();
        else { stopEnforcing(); sync(); }
      },25);
    }else{
      stopEnforcing();
      S.setInternalView(internalForChrome()).catch?.(()=>{});
    }
    document.documentElement.dataset.onboardingSurface=open?'hidden':'restored';
  }

  const attach=()=>{
    const setup=document.querySelector('.bzLaunch');
    if(!setup)return false;
    sync();
    new MutationObserver(sync).observe(setup,{attributes:true,attributeFilter:['data-on']});
    return true;
  };

  if(!attach()){
    const bodyObserver=new MutationObserver(()=>{
      if(attach())bodyObserver.disconnect();
    });
    bodyObserver.observe(document.body,{childList:true,subtree:true});
  }

  // Any renderer-side view change must re-check first-run. When setup is open
  // the native surface remains hidden; when closed, normal browse/internal
  // visibility follows the active Breeze view.
  new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:['data-view']});
})();
