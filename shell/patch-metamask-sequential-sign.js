'use strict';
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, 'realmetamasktest.js');
let source = fs.readFileSync(file, 'utf8');

const readyMarker = '    await app.whenReady();\n';
const readyAt = source.indexOf(readyMarker);
if (readyAt < 0) throw new Error('MetaMask app-ready marker not found');
const installSelfClose = "    require('./extension-self-close').install(require('electron').ipcMain,BrowserWindow);\n";
if (!source.includes("require('./extension-self-close').install")) {
  source = source.slice(0, readyAt + readyMarker.length) + installSelfClose + source.slice(readyAt + readyMarker.length);
}

const accountMarker = "    ok('MetaMask approves eth_requestAccounts through Breeze',accounts.length>0&&/^0x[0-9a-fA-F]{40}$/.test(String(accounts[0]||'')),JSON.stringify(accountResult));\n";
const accountAt = source.indexOf(accountMarker);
if (accountAt < 0) throw new Error('MetaMask account approval marker not found');

const waitForClose = `\n    // MetaMask resolves eth_requestAccounts just before its notification window\n    // finishes closing. A real user cannot approve a second wallet prompt until\n    // that first approval surface has completed its close lifecycle. Waiting for\n    // the actual BrowserWindow close also exercises Breeze's windows.onRemoved\n    // delivery instead of racing the next personal_sign request against teardown.\n    await waitFor(\n      () => !connectWindow || connectWindow.isDestroyed() ? true : null,\n      {timeout:10000,label:'MetaMask connection approval window to close'},\n    );\n    await sleep(250);\n`;

if (!source.includes("label:'MetaMask connection approval window to close'")) {
  source = source.slice(0, accountAt + accountMarker.length) + waitForClose + source.slice(accountAt + accountMarker.length);
}

const signRequestMarker = "      await win.webContents.executeJavaScript(`(()=>{window.__breezeSignResult=null;window.ethereum.request({method:'personal_sign'";
const signRequestAt = source.indexOf(signRequestMarker);
if (signRequestAt < 0) throw new Error('MetaMask personal_sign request marker not found');
const signRequestEnd = source.indexOf(";return 'started'})()`);", signRequestAt);
if (signRequestEnd < 0) throw new Error('MetaMask personal_sign request end marker not found');
const afterRequest = signRequestEnd + ";return 'started'})()`);".length;

const diagnostics = `\n      // Give MetaMask one renderer tick to create or route the confirmation.\n      // If the request is rejected before a window is created, surface that\n      // provider error directly instead of reporting a misleading selector timeout.\n      await sleep(250);\n      const earlySignResult=await win.webContents.executeJavaScript('window.__breezeSignResult').catch(()=>null);\n      if(earlySignResult&&!earlySignResult.ok){\n        throw new Error('MetaMask personal_sign rejected before confirmation: '+JSON.stringify(earlySignResult));\n      }\n`;
if (!source.includes('MetaMask personal_sign rejected before confirmation')) {
  source = source.slice(0, afterRequest) + diagnostics + source.slice(afterRequest);
}

fs.writeFileSync(file, source, 'utf8');
console.log('MetaMask certification installs Breeze self-close semantics and waits for the connection popup lifecycle before personal_sign.');
