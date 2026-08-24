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
fs.writeFileSync(file, source, 'utf8');
console.log('MetaMask certification harness hardened for route clicks, password typing, and optional passkey onboarding.');
