/* ═══════════════════════════════════════════════════════════════════════════
   BREEZE DOCUMENTS — local PDF inspection + manipulation

   All filesystem paths remain in the main process. The PDF renderer receives
   bytes for the one document it owns; Breeze chrome receives safe metadata
   and operation results only. No cloud service is involved.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BYTES = 512 * 1024 * 1024; // avoid turning a hostile PDF into a RAM bomb
const MAX_PAGES = 5000;
let PDFDocument, degrees;
function lib(){
  if (!PDFDocument){ ({PDFDocument,degrees}=require('pdf-lib')); }
  return {PDFDocument,degrees};
}
function cleanPdfPath(p){
  if(typeof p!=='string' || !p || p.length>4096) throw new Error('invalid PDF path');
  const full=path.resolve(p);
  if(path.extname(full).toLowerCase()!=='.pdf') throw new Error('not a PDF document');
  const st=fs.statSync(full);
  if(!st.isFile()) throw new Error('not a file');
  if(st.size>MAX_BYTES) throw new Error('PDF is larger than Breeze’s 512 MB safety limit');
  return {full,st};
}
async function load(p){
  const {full,st}=cleanPdfPath(p); const bytes=await fs.promises.readFile(full);
  const {PDFDocument}=lib();
  let doc;
  try{ doc=await PDFDocument.load(bytes,{updateMetadata:false,ignoreEncryption:false,throwOnInvalidObject:true}); }
  catch(err){ if(/encrypted/i.test(String(err))) throw new Error('This PDF is encrypted. Open it with its password first.'); throw err; }
  if(doc.getPageCount()>MAX_PAGES) throw new Error('PDF exceeds Breeze’s 5,000-page safety limit');
  return {full,st,bytes,doc};
}
function iso(d){ try{return d instanceof Date&&!Number.isNaN(d.valueOf())?d.toISOString():null;}catch{return null;} }
async function info(p){
  const {full,st,doc}=await load(p);
  const safe=(fn)=>{try{return fn()||null}catch{return null}};
  return {
    fileName:path.basename(full), pageCount:doc.getPageCount(), fileSize:st.size,
    title:safe(()=>doc.getTitle()), author:safe(()=>doc.getAuthor()), subject:safe(()=>doc.getSubject()),
    creator:safe(()=>doc.getCreator()), producer:safe(()=>doc.getProducer()),
    createdAt:iso(safe(()=>doc.getCreationDate())), modifiedAt:iso(safe(()=>doc.getModificationDate()))
  };
}
async function bytesForViewer(p){ const {bytes}=await load(p); return new Uint8Array(bytes); }
function parsePageSpec(spec,count,{allowBlank=true}={}){
  const s=String(spec||'').trim();
  if(!s && allowBlank) return Array.from({length:count},(_,i)=>i);
  if(!s) throw new Error('Enter pages, for example 1-3,5,8');
  const out=[]; const seen=new Set();
  for(const raw of s.split(',')){
    const part=raw.trim(); if(!part)continue;
    const m=part.match(/^(\d+)(?:\s*-\s*(\d+))?$/); if(!m)throw new Error(`Invalid page range: ${part}`);
    let a=Number(m[1]), b=m[2]?Number(m[2]):a; if(a>b)[a,b]=[b,a];
    if(a<1||b>count)throw new Error(`Pages must be between 1 and ${count}`);
    for(let n=a;n<=b;n++){ const i=n-1; if(!seen.has(i)){seen.add(i);out.push(i);} }
  }
  if(!out.length)throw new Error('No pages selected');
  return out;
}
function parseSplitRanges(spec,count){
  const chunks=String(spec||'').split(';').map(x=>x.trim()).filter(Boolean);
  if(!chunks.length)throw new Error('Enter ranges separated by semicolons, for example 1-3;4-8;9-12');
  if(chunks.length>50)throw new Error('Split is limited to 50 output files at a time');
  return chunks.map(x=>({label:x,indices:parsePageSpec(x,count,{allowBlank:false})}));
}
async function writeDoc(doc,out){
  const bytes=await doc.save({useObjectStreams:true,addDefaultPage:false,objectsPerTick:40});
  await fs.promises.writeFile(out,bytes,{flag:'w'}); return {ok:true,fileName:path.basename(out),size:bytes.length};
}
async function extract(p,spec,out){
  const {doc}=await load(p); const indices=parsePageSpec(spec,doc.getPageCount(),{allowBlank:false});
  const {PDFDocument}=lib(); const next=await PDFDocument.create(); const pages=await next.copyPages(doc,indices); pages.forEach(pg=>next.addPage(pg));
  return writeDoc(next,out);
}
async function rotate(p,spec,angle,out){
  const {doc}=await load(p); const n=Number(angle); if(![90,180,270].includes(n))throw new Error('Rotation must be 90, 180, or 270 degrees');
  const indices=parsePageSpec(spec,doc.getPageCount()); const {degrees}=lib();
  indices.forEach(i=>{const pg=doc.getPage(i); const cur=pg.getRotation().angle||0; pg.setRotation(degrees((cur+n)%360));});
  return writeDoc(doc,out);
}
async function merge(paths,out){
  if(!Array.isArray(paths)||paths.length<2)throw new Error('Choose at least two PDFs to merge');
  if(paths.length>50)throw new Error('Merge is limited to 50 PDFs at a time');
  const {PDFDocument}=lib(); const next=await PDFDocument.create();
  for(const p of paths){ const {doc}=await load(p); const pages=await next.copyPages(doc,doc.getPageIndices()); pages.forEach(pg=>next.addPage(pg)); }
  return writeDoc(next,out);
}
async function split(p,spec,dir){
  const {full,doc}=await load(p); const ranges=parseSplitRanges(spec,doc.getPageCount()); const {PDFDocument}=lib();
  const stem=path.basename(full,path.extname(full)).replace(/[^a-z0-9._-]+/gi,'-').slice(0,120)||'document'; const files=[];
  for(let i=0;i<ranges.length;i++){
    const next=await PDFDocument.create(); const pages=await next.copyPages(doc,ranges[i].indices); pages.forEach(pg=>next.addPage(pg));
    const out=path.join(dir,`${stem}-part-${String(i+1).padStart(2,'0')}.pdf`); const r=await writeDoc(next,out); files.push(r.fileName);
  }
  return {ok:true,files};
}
function token(){ return crypto.randomBytes(24).toString('hex'); }
module.exports={info,bytesForViewer,extract,rotate,merge,split,parsePageSpec,parseSplitRanges,token,cleanPdfPath};
