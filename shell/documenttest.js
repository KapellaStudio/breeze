'use strict';
const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path');
const {PDFDocument,StandardFonts}=require('pdf-lib'); const docs=require('./documents');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-doc-')); let pass=0,fail=0;
function ok(name,cond){console.log((cond?'PASS':'FAIL')+'  '+name);cond?pass++:fail++;}
(async()=>{try{
  const source=path.join(tmp,'source.pdf'); const d=await PDFDocument.create(); const font=await d.embedFont(StandardFonts.Helvetica);
  for(let i=1;i<=6;i++){const p=d.addPage([500,700]);p.drawText(`Breeze document test page ${i}`,{x:50,y:640,size:18,font});}
  d.setTitle('Breeze Test PDF');fs.writeFileSync(source,await d.save());
  const info=await docs.info(source);ok('PDF metadata and page count are inspected locally',info.pageCount===6&&info.title==='Breeze Test PDF');
  const ex=path.join(tmp,'extract.pdf');await docs.extract(source,'2-3,5',ex);ok('extract produces selected pages',(await docs.info(ex)).pageCount===3);
  const rot=path.join(tmp,'rotated.pdf');await docs.rotate(source,'1,6',90,rot);const rd=await PDFDocument.load(fs.readFileSync(rot));ok('rotate changes only selected pages',rd.getPage(0).getRotation().angle===90&&rd.getPage(1).getRotation().angle===0&&rd.getPage(5).getRotation().angle===90);
  const splitDir=path.join(tmp,'split');fs.mkdirSync(splitDir);const sr=await docs.split(source,'1-2;3-4;5-6',splitDir);ok('split creates one PDF per range',sr.files.length===3&&sr.files.every(f=>fs.existsSync(path.join(splitDir,f))));
  const merged=path.join(tmp,'merged.pdf');await docs.merge([path.join(splitDir,sr.files[0]),path.join(splitDir,sr.files[1])],merged);ok('merge appends PDFs in order',(await docs.info(merged)).pageCount===4);
  ok('page parser deduplicates explicit pages',JSON.stringify(docs.parsePageSpec('1,1,2-3',6,{allowBlank:false}))==='[0,1,2]');
  let bad=false;try{docs.parsePageSpec('0-9',6,{allowBlank:false});}catch{bad=true;}ok('page parser rejects out-of-range selections',bad);
  ok('viewer bytes are returned without exposing a path',(await docs.bytesForViewer(source)) instanceof Uint8Array);
}catch(e){console.error(e);fail++;}finally{fs.rmSync(tmp,{recursive:true,force:true});console.log(`\nDocument engine: ${pass}/${pass+fail}`);process.exit(fail?1:0);}})();
