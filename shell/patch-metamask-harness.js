'use strict';
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, 'realmetamasktest.js');
let source = fs.readFileSync(file, 'utf8');
const start = source.indexOf('async function routeClickSelector(win,selector){');
const end = source.indexOf('async function fillSelector(win,selector,value){', start);
if (start < 0 || end < 0) throw new Error('MetaMask route-click harness marker not found');

const replacement = `async function routeClickSelector(win,selector){
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

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(file, source, 'utf8');
console.log('MetaMask certification harness route clicks hardened for CI.');
