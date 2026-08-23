/* Local browser-state persistence. No cloud account is required to resume tabs. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
let file = null;
function init(userDataPath){ file = path.join(userDataPath, 'session-state.json'); }
function read(){
  try {
    const v=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!v||!Array.isArray(v.tabs)) return null;
    return v;
  } catch { return null; }
}
function write(value){
  if(!file) return;
  const tmp=file+'.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp,file);
}
module.exports={init,read,write};
