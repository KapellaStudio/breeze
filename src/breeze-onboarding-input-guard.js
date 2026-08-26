/* Breeze onboarding native-surface guard.
   The Electron web page lives in a WebContentsView above the browser chrome.
   While first-run setup is open, hide that native page surface so real mouse
   input reaches the onboarding dialog. Restore the surface immediately when
   setup closes. */
(function(){
  'use strict';
  const S=window.__BREEZE_SHELL__;
  if(!S||!S.isShell||typeof S.setInternalView!=='function')return;

  function internalForChrome(){
    return document.documentElement.dataset.view !== 'browse';
  }
  function sync(){
    const setup=document.querySelector('.bzLaunch');
    const open=setup?.dataset.on==='1';
    S.setInternalView(open ? true : internalForChrome()).catch?.(()=>{});
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

  // View/layout changes can happen while setup is closed; keep the restored
  // native page state aligned with the active Breeze view.
  new MutationObserver(()=>{
    const setup=document.querySelector('.bzLaunch');
    if(setup?.dataset.on!=='1')sync();
  }).observe(document.documentElement,{attributes:true,attributeFilter:['data-view']});
})();
