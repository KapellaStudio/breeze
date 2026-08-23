/* ═══════════════════════════════════════════════════════════════════════════
   BREEZE FLOW — LOCAL MEDIA ENGINE
   Media paths never cross into the renderer. The chrome receives opaque job
   ids and safe metadata; only this module touches source/output paths.

   Format support lives here as the single source of truth. The main process
   uses it for native file filters and output validation; the renderer receives
   only safe capability metadata through a named IPC method.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

let staticFfmpeg = null;
try { staticFfmpeg = require('ffmpeg-static'); } catch {}
const FFMPEG = process.env.BREEZE_FFMPEG_PATH || staticFfmpeg || 'ffmpeg';

const jobs = new Map();
const MAX_JOBS = 24;
const JOB_TTL_MS = 60 * 60 * 1000;

const AUDIO_INPUTS = [
  'wav','mp3','aac','m4a','flac','ogg','oga','opus','aiff','aif','wma',
  'caf','ac3','amr','mka'
];
const VIDEO_INPUTS = [
  'mp4','mov','mkv','webm','avi','m4v','mpeg','mpg','wmv','flv','3gp','3g2',
  'ts','mts','m2ts','vob','ogv'
];

const AUDIO_OUTPUTS = [
  { id:'mp3',  label:'MP3',        note:'Universal audio' },
  { id:'wav',  label:'WAV',        note:'Uncompressed PCM' },
  { id:'flac', label:'FLAC',       note:'Lossless audio' },
  { id:'m4a',  label:'M4A · AAC',  note:'Apple-friendly AAC' },
  { id:'ogg',  label:'OGG · Vorbis', note:'Open audio' },
  { id:'opus', label:'Opus',       note:'Efficient speech/music' },
  { id:'aac',  label:'AAC',        note:'Raw AAC audio' },
  { id:'aiff', label:'AIFF',       note:'Uncompressed Apple audio' },
  { id:'wma',  label:'WMA',        note:'Windows Media Audio' }
];
const VIDEO_OUTPUTS = [
  { id:'mp4',  label:'MP4 · H.264', note:'Best general compatibility' },
  { id:'mov',  label:'MOV · H.264', note:'QuickTime / editing workflows' },
  { id:'mkv',  label:'MKV · H.264', note:'Flexible archival container' },
  { id:'webm', label:'WebM · VP9',  note:'Web delivery' },
  { id:'avi',  label:'AVI · MPEG-4', note:'Legacy compatibility' },
  { id:'wmv',  label:'WMV',        note:'Windows Media Video' },
  { id:'gif',  label:'Animated GIF', note:'Short shareable clips' }
];

const AUDIO_INPUT_SET = new Set(AUDIO_INPUTS.map(x => '.' + x));
const VIDEO_INPUT_SET = new Set(VIDEO_INPUTS.map(x => '.' + x));
const ALLOWED_INPUT = new Set([...AUDIO_INPUT_SET, ...VIDEO_INPUT_SET]);
const AUDIO_OUT = new Set(AUDIO_OUTPUTS.map(x => x.id));
const VIDEO_OUT = new Set(VIDEO_OUTPUTS.map(x => x.id));

function token(){ return crypto.randomBytes(18).toString('base64url'); }
function prune(){ while (jobs.size >= MAX_JOBS) jobs.delete(jobs.keys().next().value); }
function kindFor(ext){ return VIDEO_INPUT_SET.has(ext) ? 'video' : 'audio'; }
function cloneFormats(rows){ return rows.map(x => ({...x})); }
function supportedInputs(kind='media'){
  if(kind === 'audio') return [...AUDIO_INPUTS];
  if(kind === 'video') return [...VIDEO_INPUTS];
  return [...AUDIO_INPUTS, ...VIDEO_INPUTS];
}
function supportedOutputs(kind='audio'){
  const rows = kind === 'video' ? [...VIDEO_OUTPUTS, ...AUDIO_OUTPUTS] : AUDIO_OUTPUTS;
  return rows.map(x => x.id);
}
function capabilities(){
  return {
    inputs: { audio:[...AUDIO_INPUTS], video:[...VIDEO_INPUTS] },
    outputs: { audio:cloneFormats(AUDIO_OUTPUTS), video:cloneFormats([...VIDEO_OUTPUTS, ...AUDIO_OUTPUTS]) }
  };
}
function safeFile(fp){
  const st=fs.statSync(fp); if(!st.isFile()) throw new Error('not a file');
  const ext=path.extname(fp).toLowerCase(); if(!ALLOWED_INPUT.has(ext)) throw new Error('unsupported media type');
  prune(); const id=token(); const kind=kindFor(ext); jobs.set(id,{path:fp,kind,created:Date.now()});
  return {id,kind,name:path.basename(fp),ext:ext.slice(1),size:st.size};
}
function get(id){
  if(typeof id!=='string'||id.length>64) throw new Error('invalid media job');
  const j=jobs.get(id);
  if(!j||Date.now()-j.created>JOB_TTL_MS){jobs.delete(id);throw new Error('media job expired');}
  return j;
}
function audioSpec(format,quality){
  const q=String(quality||'balanced');
  if(!AUDIO_OUT.has(format)) throw new Error('unsupported audio output format');
  if(format==='mp3')  return ['-vn','-c:a','libmp3lame','-b:a',q==='small'?'128k':q==='high'?'320k':'192k'];
  if(format==='m4a')  return ['-vn','-c:a','aac','-b:a',q==='small'?'128k':q==='high'?'256k':'192k'];
  if(format==='aac')  return ['-vn','-c:a','aac','-b:a',q==='small'?'128k':q==='high'?'256k':'192k'];
  if(format==='flac') return ['-vn','-c:a','flac'];
  if(format==='ogg')  return ['-vn','-c:a','libvorbis','-q:a',q==='small'?'3':q==='high'?'8':'5'];
  if(format==='opus') return ['-vn','-c:a','libopus','-b:a',q==='small'?'96k':q==='high'?'192k':'128k'];
  if(format==='aiff') return ['-vn','-c:a','pcm_s16be'];
  if(format==='wma')  return ['-vn','-c:a','wmav2','-b:a',q==='small'?'128k':q==='high'?'256k':'192k'];
  return ['-vn','-c:a','pcm_s16le']; // WAV
}
function videoSpec(format,quality){
  const q=String(quality||'balanced');
  const crf = q==='small'?'28':q==='high'?'18':'23';
  if(AUDIO_OUT.has(format)) return audioSpec(format,q);
  if(!VIDEO_OUT.has(format)) throw new Error('unsupported video output format');
  if(format==='webm') return ['-c:v','libvpx-vp9','-crf',q==='small'?'38':q==='high'?'24':'31','-b:v','0','-c:a','libopus','-b:a',q==='high'?'160k':'128k'];
  if(format==='avi')  return ['-c:v','mpeg4','-q:v',q==='small'?'7':q==='high'?'2':'4','-c:a','libmp3lame','-b:a','192k'];
  if(format==='wmv')  return ['-c:v','wmv2','-b:v',q==='small'?'1200k':q==='high'?'5000k':'2500k','-c:a','wmav2','-b:a','192k'];
  if(format==='gif')  return ['-an','-vf',`fps=${q==='small'?'10':q==='high'?'18':'14'},scale='min(${q==='small'?'640':q==='high'?'1280':'960'},iw)':-2:flags=lanczos`];
  // MP4, MOV and M4V all use H.264/AAC; MKV uses the same broadly-decodable
  // streams in a more flexible container. yuv420p avoids 10-bit/player traps.
  const base=['-c:v','libx264','-preset','medium','-crf',crf,'-pix_fmt','yuv420p','-c:a','aac','-b:a',q==='high'?'192k':'160k'];
  if(format==='mp4'||format==='mov') base.push('-movflags','+faststart');
  return base;
}
function outSpec(kind,format,quality){ return kind==='video' ? videoSpec(format,quality) : audioSpec(format,quality); }
function convert(id,opts,outPath){
  const j=get(id); const format=String(opts?.format||'').toLowerCase();
  if(!supportedOutputs(j.kind).includes(format)) throw new Error('unsupported output format');
  if(!outPath||path.extname(outPath).toLowerCase()!=='.'+format) throw new Error('output extension mismatch');
  if(path.resolve(outPath)===path.resolve(j.path)) throw new Error('choose a different output file');
  const args=['-hide_banner','-nostdin','-y','-i',j.path,...outSpec(j.kind,format,opts?.quality),outPath];
  return new Promise((resolve,reject)=>{
    const child=spawn(FFMPEG,args,{windowsHide:true,stdio:['ignore','ignore','pipe']}); let err='';
    child.stderr.on('data',d=>{if(err.length<24000)err+=String(d)});
    child.on('error',e=>reject(new Error(e.code==='ENOENT'?'Flow media engine is unavailable':e.message)));
    child.on('close',code=>{
      if(code!==0)return reject(new Error((err.trim().split(/\r?\n/).slice(-4).join(' ')||'media conversion failed').slice(0,1200)));
      const st=fs.statSync(outPath);resolve({ok:true,name:path.basename(outPath),size:st.size,format});
    });
  });
}
function clear(id){jobs.delete(id);return true;}
module.exports={safeFile,get,convert,clear,capabilities,supportedInputs,supportedOutputs,ffmpegPath:()=>FFMPEG};
