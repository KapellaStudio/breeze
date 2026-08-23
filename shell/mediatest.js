/* Breeze Flow media engine verification — local only, generated fixtures. */
'use strict';
const fs=require('fs'); const os=require('os'); const path=require('path');
const {spawnSync}=require('child_process'); const media=require('./media');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'breeze-media-'));
let passed=0;
function pass(name){passed++;console.log('PASS ',name);}
function assert(ok,msg){if(!ok) throw new Error(msg);}
function wav(file){
  const rate=8000, seconds=.25, n=Math.floor(rate*seconds), data=Buffer.alloc(n*2);
  for(let i=0;i<n;i++){ const v=Math.round(Math.sin(2*Math.PI*440*i/rate)*10000); data.writeInt16LE(v,i*2); }
  const h=Buffer.alloc(44); h.write('RIFF',0); h.writeUInt32LE(36+data.length,4); h.write('WAVEfmt ',8); h.writeUInt32LE(16,16); h.writeUInt16LE(1,20); h.writeUInt16LE(1,22); h.writeUInt32LE(rate,24); h.writeUInt32LE(rate*2,28); h.writeUInt16LE(2,32); h.writeUInt16LE(16,34); h.write('data',36); h.writeUInt32LE(data.length,40); fs.writeFileSync(file,Buffer.concat([h,data]));
}
function makeMov(file){
  const r=spawnSync(media.ffmpegPath(),['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=black:s=160x90:r=12:d=0.45','-f','lavfi','-i','sine=frequency=440:sample_rate=22050:duration=0.45','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',file],{encoding:'utf8'});
  if(r.status!==0) throw new Error('could not generate MOV fixture: '+String(r.stderr||'').slice(-500));
}
(async()=>{
  const caps=media.capabilities();
  assert(caps.inputs.video.includes('mov')&&caps.inputs.video.includes('mts')&&caps.inputs.video.includes('wmv'),'common video inputs missing');
  pass('MOV / MTS / WMV inputs advertised');
  for(const f of ['mp4','mov','mkv','webm','avi','wmv','gif']) assert(caps.outputs.video.some(x=>x.id===f),'missing video output '+f);
  for(const f of ['mp3','wav','flac','m4a','ogg','opus','aac','aiff','wma']) assert(caps.outputs.audio.some(x=>x.id===f),'missing audio output '+f);
  pass('broad creator output matrix advertised');

  const audioIn=path.join(tmp,'tone.wav'); wav(audioIn);
  const audioJob=media.safeFile(audioIn); assert(audioJob.kind==='audio'&&audioJob.id,'media token creation failed');
  assert(!audioJob.path,'safe metadata leaked a source path'); pass('opaque media token');

  for(const fmt of ['mp3','wav','flac','m4a','ogg','opus','aac','aiff','wma']){
    const out=path.join(tmp,'tone-out.'+fmt); const r=await media.convert(audioJob.id,{format:fmt,quality:'small'},out);
    assert(r.ok&&fs.existsSync(out)&&fs.statSync(out).size>128,'audio conversion failed: '+fmt);
  }
  pass('WAV converts across every advertised audio output');

  const movIn=path.join(tmp,'camera.mov'); makeMov(movIn);
  const videoJob=media.safeFile(movIn); assert(videoJob.kind==='video'&&videoJob.ext==='mov','MOV not identified as video');
  assert(!videoJob.path,'MOV metadata leaked a path'); pass('MOV input recognized safely');

  for(const fmt of ['mp4','mov','mkv','webm','avi','wmv']){
    const out=path.join(tmp,'camera-out.'+fmt); const r=await media.convert(videoJob.id,{format:fmt,quality:'small'},out);
    assert(r.ok&&fs.existsSync(out)&&fs.statSync(out).size>256,'video conversion failed: '+fmt);
  }
  pass('MOV converts across every advertised video container');

  const extract=path.join(tmp,'camera.mp3'); const er=await media.convert(videoJob.id,{format:'mp3',quality:'small'},extract);
  assert(er.ok&&fs.statSync(extract).size>128,'MOV audio extraction failed'); pass('MOV extracts audio to MP3');

  const gif=path.join(tmp,'camera.gif'); const gr=await media.convert(videoJob.id,{format:'gif',quality:'small'},gif);
  assert(gr.ok&&fs.statSync(gif).size>128,'MOV to GIF failed'); pass('MOV converts to animated GIF');

  let blocked=false; try{await media.convert(videoJob.id,{format:'exe'},path.join(tmp,'bad.exe'));}catch{blocked=true;}
  assert(blocked,'unsafe output format accepted'); pass('unsafe output format rejected');
  let sameBlocked=false; try{await media.convert(videoJob.id,{format:'mov'},movIn);}catch{sameBlocked=true;}
  assert(sameBlocked,'source overwrite accepted'); pass('source overwrite rejected');

  console.log(`\nMedia: ${passed}/${passed} checks passed`);
})().catch(e=>{console.error('FAIL ',e.message||e);process.exitCode=1}).finally(()=>{try{fs.rmSync(tmp,{recursive:true,force:true})}catch{}});
