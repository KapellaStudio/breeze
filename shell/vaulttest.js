'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vault=require('./vault');

function cryptoProvider(backend='test-keyring'){
  return {
    isAsyncEncryptionAvailable:async()=>true,
    getSelectedStorageBackend:()=>backend,
    encryptStringAsync:async value=>Buffer.from('sealed:'+String(value),'utf8'),
    decryptStringAsync:async buf=>Buffer.from(buf).toString('utf8').replace(/^sealed:/,'')
  };
}
function clipboardProvider(){
  let value='';
  return {writeText:v=>{value=String(v);},readText:()=>value,clear:()=>{value='';},peek:()=>value};
}

(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-vault-'));
  try{
    const clip=clipboardProvider();
    vault.init(root,cryptoProvider(),clip,'darwin');
    const status=await vault.securityStatus();
    assert.equal(status.available,true);

    const add=await vault.add({origin:'example.com/login',label:'Personal',username:'person@example.com',password:'correct horse battery staple'});
    assert.equal(add.ok,true);
    assert.equal(add.credential.origin,'https://example.com');
    assert.equal(add.credential.username,'person@example.com');
    assert.equal(Object.prototype.hasOwnProperty.call(add.credential,'password'),false,'password is never returned in public metadata');

    const disk=fs.readFileSync(path.join(root,'vault.json'),'utf8');
    assert.equal(disk.includes('correct horse battery staple'),false,'password is not stored in plaintext');
    assert.equal(disk.includes('person@example.com'),false,'username is also encrypted at rest');

    const listed=await vault.list('person');
    assert.equal(listed.length,1);
    assert.equal(listed[0].username,'person@example.com');
    assert.equal(Object.prototype.hasOwnProperty.call(listed[0],'password'),false);

    const copied=await vault.copyField(add.credential.id,'password');
    assert.equal(copied.ok,true);
    assert.equal(Object.prototype.hasOwnProperty.call(copied,'value'),false,'copy result never returns the secret');
    assert.equal(clip.peek(),'correct horse battery staple','secret is written only to clipboard');

    const csv=path.join(root,'passwords.csv');
    fs.writeFileSync(csv,'name,url,username,password\nWork,https://work.example.test,user@work.test,s3cret\nBad,javascript:alert(1),x,nope\n','utf8');
    const imported=await vault.importCsv(csv);
    assert.equal(imported.ok,true);
    assert.equal(imported.imported,1);
    assert.equal(imported.skipped,1);
    assert.equal((await vault.list('work.example.test')).length,1);

    const linuxRoot=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-vault-linux-'));
    try{
      vault.init(linuxRoot,cryptoProvider('basic_text'),clipboardProvider(),'linux');
      const linux=await vault.securityStatus();
      assert.equal(linux.available,false,'Breeze rejects Electron basic_text fallback');
      assert.match(linux.reason,/refuses/i);
      const blocked=await vault.add({origin:'https://example.com',username:'u',password:'p'});
      assert.ok(blocked.error);
    }finally{fs.rmSync(linuxRoot,{recursive:true,force:true});}

    console.log('Breeze Vault tests passed');
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
  }
})().catch(err=>{console.error(err);process.exit(1);});
