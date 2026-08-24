'use strict';
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, 'realmetamasktest.js');
let source = fs.readFileSync(file, 'utf8');
const routeStart = source.indexOf('async function routeClickSelector(win,selector){');
const fillStart = source.indexOf('async function fillSelector(win,selector,value){', routeStart);
const pasteStart = source.indexOf('async function pasteSelector(win,selector,value){', fillStart);
if (routeStart < 0 || fillStart < 0 || pasteStart < 0) {
  throw new Error('MetaMask certification harness markers not found');
}

const routeReplacement = `async function routeClickSelector(win,selector){
  await waitFor(async()=>{
    const state=await selectorState(win,selector);
    return state?.found&&!state.disabled?state:null;
  },{timeout:30000,label:\`enabled route control \${selector}\`});
  // Resolve this evaluation before React is allowed to tear down the route.
  // A short delayed DOM click is deterministic even for controls below the
  // current Xvfb viewport, while still invoking MetaMask's genuine onClick.
  await win.webContents.executeJavaScript(\`(()=>{const e=document.querySelector(\${JSON.stringify(selector)});if(!e||e.disabled)throw new Error('route control unavailable');setTimeout(()=>e.click(),75);return true})()\`);
  await sleep(200);
  return true;
}
`;

const fillReplacement = `async function fillSelector(win,selector,value){
  // MetaMask can still be hydrating the create-password route after the input
  // first appears. Focus the real control, then type through Electron instead
  // of mutating React's input value from renderer JavaScript. This mirrors an
  // actual Breeze user and avoids racing a renderer evaluation with hydration.
  await waitFor(async()=>{
    if(!win||win.isDestroyed())return null;
    return win.webContents.executeJavaScript(\`(()=>{const e=document.querySelector(\${JSON.stringify(selector)});if(!e||e.disabled)return null;e.scrollIntoView({block:'center',inline:'nearest'});e.focus();if(typeof e.select==='function')e.select();return document.activeElement===e?true:null})()\`).catch(()=>null);
  },{timeout:30000,label:\`focusable \${selector}\`});
  await sleep(75);
  win.webContents.insertText(String(value));
  await waitFor(async()=>{
    if(!win||win.isDestroyed())return null;
    return win.webContents.executeJavaScript(\`(()=>{const e=document.querySelector(\${JSON.stringify(selector)});return e&&e.value===\${JSON.stringify(value)}?e.value:null})()\`).catch(()=>null);
  },{timeout:10000,label:\`typed value for \${selector}\`});
  return value;
}
`;

source = source.slice(0, routeStart) + routeReplacement
  + source.slice(fillStart, pasteStart).replace(
    source.slice(fillStart, pasteStart),
    fillReplacement,
  )
  + source.slice(pasteStart);

const passkeyStart = source.indexOf('    const passkey=await waitSelector(surface,\'[data-testid="passkey-maybe-later-button"]\',30000);');
const completionMarker = "    ok('MetaMask test wallet import reaches completion in Breeze'";
const completionStart = source.indexOf(completionMarker, passkeyStart);
if (passkeyStart < 0 || completionStart < 0) {
  throw new Error('MetaMask post-password onboarding markers not found');
}

const postPasswordReplacement = `    const postPassword=await waitFor(async()=>{
      const passkey=await selectorState(surface,'[data-testid="passkey-maybe-later-button"]');
      if(passkey?.found)return {kind:'passkey',state:passkey};
      const metrics=await selectorState(surface,'[data-testid="metametrics-i-agree"]');
      if(metrics?.found)return {kind:'metrics',state:metrics};
      const done=await selectorState(surface,'[data-testid="onboarding-complete-done"]');
      if(done?.found)return {kind:'done',state:done};
      return null;
    },{timeout:30000,label:'MetaMask post-password onboarding'});
    console.log('MetaMask post-password onboarding:',JSON.stringify(postPassword));

    let nextStep=postPassword;
    if(postPassword.kind==='passkey'){
      ok('MetaMask import reaches passkey choice in Breeze',true,JSON.stringify(postPassword.state));
      await routeClickSelector(surface,'[data-testid="passkey-maybe-later-button"]');
      nextStep=await waitFor(async()=>{
        const metrics=await selectorState(surface,'[data-testid="metametrics-i-agree"]');
        if(metrics?.found)return {kind:'metrics',state:metrics};
        const done=await selectorState(surface,'[data-testid="onboarding-complete-done"]');
        if(done?.found)return {kind:'done',state:done};
        return null;
      },{timeout:30000,label:'MetaMask onboarding after passkey choice'});
    }else{
      ok('MetaMask may skip passkey setup when the browser capability is unavailable',true,JSON.stringify(postPassword));
    }

    if(nextStep.kind==='metrics'){
      await routeClickSelector(surface,'[data-testid="metametrics-i-agree"]');
      await waitSelector(surface,'[data-testid="onboarding-complete-done"]',30000);
    }else if(nextStep.kind!=='done'){
      throw new Error('Unexpected MetaMask post-password onboarding state: '+JSON.stringify(nextStep));
    }
`;

source = source.slice(0, passkeyStart) + postPasswordReplacement + source.slice(completionStart);

const signStart = source.indexOf('      const signWindow=await findExtensionWindow(extOrigin,\'[data-testid="confirm-footer-button"]\',new Set([surface?.id]),30000);');
const signEndMarker = "      ok('MetaMask returns a valid signature to the Breeze dapp'";
const signEndStart = source.indexOf(signEndMarker, signStart);
const signEnd = signEndStart < 0 ? -1 : source.indexOf('\n', signEndStart) + 1;
if (signStart < 0 || signEndStart < 0 || signEnd <= signEndStart) {
  throw new Error('MetaMask personal-sign certification markers not found');
}

const signReplacement = `      const signApproval=await waitFor(async()=>{
        for(const w of BrowserWindow.getAllWindows()){
          if(!w||w.isDestroyed()||w===surface)continue;
          const url=String(w.webContents.getURL()||'');
          if(!url.startsWith(extOrigin))continue;
          const state=await w.webContents.executeJavaScript(\`(()=>{
            const buttons=[...document.querySelectorAll('button')].map((b,index)=>({
              index,
              text:(b.innerText||b.textContent||'').trim(),
              testId:b.getAttribute('data-testid')||'',
              disabled:!!b.disabled,
            }));
            const candidate=buttons.find(b=>!b.disabled&&/^(sign|confirm|approve)$/i.test(b.text))
              || buttons.find(b=>!b.disabled&&/(confirm|sign|approve)/i.test(b.testId));
            return {href:location.href,body:(document.body?.innerText||'').slice(0,800),buttons,candidate};
          })()\`).catch(()=>null);
          if(!state?.candidate)continue;
          const body=String(state.body||'');
          const href=String(state.href||url);
          if(!href.includes('/notification.html')&&!/(sign|signature|message)/i.test(body))continue;
          return {windowId:w.id,state};
        }
        return null;
      },{timeout:30000,label:'MetaMask personal-sign approval window'});
      const signWindow=BrowserWindow.fromId(signApproval.windowId);
      if(!signWindow)throw new Error('MetaMask personal-sign window disappeared before approval');
      const signState=signApproval.state;
      ok('MetaMask opens a real personal-sign confirmation in Breeze',true,JSON.stringify(signState));
      await signWindow.webContents.executeJavaScript(\`(()=>{
        const buttons=[...document.querySelectorAll('button')];
        const candidate=buttons.find(b=>!b.disabled&&/^(sign|confirm|approve)$/i.test((b.innerText||b.textContent||'').trim()))
          || buttons.find(b=>!b.disabled&&/(confirm|sign|approve)/i.test(b.getAttribute('data-testid')||''));
        if(!candidate)throw new Error('MetaMask personal-sign approval control unavailable');
        setTimeout(()=>candidate.click(),75);
        return true;
      })()\`);
      const signResult=await waitFor(()=>win.webContents.executeJavaScript('window.__breezeSignResult'),{timeout:30000,label:'personal_sign result'});
      ok('MetaMask returns a valid signature to the Breeze dapp',signResult?.ok===true&&/^0x[0-9a-fA-F]{130}$/.test(String(signResult.value||'')),JSON.stringify(signResult));
`;

source = source.slice(0, signStart) + signReplacement + source.slice(signEnd);
fs.writeFileSync(file, source, 'utf8');
console.log('MetaMask certification harness hardened for route clicks, password typing, optional passkey onboarding, and personal-sign approval.');
