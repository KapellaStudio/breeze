/* Breeze toolbar-weather migration.
   Existing beta builds shipped the weather preference off while the product
   UI previously showed local temperature in the working toolbar. Restore that
   expected behavior once, then respect any later explicit user choice. */
(function(){
  'use strict';
  const S=window.__BREEZE_SHELL__;
  if(!S||!S.isShell)return;
  (async()=>{
    const prefs=await S.getPreferences().catch(()=>null);
    if(!prefs)return;
    if(prefs.weatherToolbarRestored!==true){
      if(prefs.weatherEnabled!==true)await S.setPreference('weatherEnabled',true).catch(()=>null);
      await S.setPreference('weatherToolbarRestored',true).catch(()=>null);
    }
    const button=document.querySelector('#toolbarWeather');
    if(button)button.click();
  })();
})();
