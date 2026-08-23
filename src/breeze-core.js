/* ═══════════════════════════════════════════════════════════════════════════
   BREEZE — SHARED CORE
   Data, escaping, DOM helpers and the luminance readout. Used by both
   breeze-desktop.html and breeze-mobile.html. Neither shell owns any of this.

   Loaded BEFORE each shell's own script. Everything here is a plain global
   (no modules) so the built single-file output works from file:// with no
   server and no bundler.
   ═══════════════════════════════════════════════════════════════════════════ */

const root = document.documentElement;
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ── esc ──────────────────────────────────────────────────────────────────
   Browser chrome runs at higher privilege than any page it displays, so a
   single unescaped page title or URL is a full compromise: script running
   here can read every tab, every cookie jar including sealed workspaces, and
   switch the shield off. Any value that originated outside these files —
   page titles, URLs, link metadata, extension manifests, search results,
   typed queries — is escaped before it touches markup, or built as DOM nodes
   instead. Quotes are escaped too, because several sinks land in attributes. */
const ESC_MAP = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'};
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ESC_MAP[c]);

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── DOM builders ─────────────────────────────────────────────────────────
   Preferred over string concatenation anywhere untrusted data is involved.
   Escaping is a discipline you forget on the next edit; node construction
   makes injection structurally impossible.                                 */
const NS = 'http://www.w3.org/2000/svg';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* Multiple subpaths are separated by '|'. */
function svgIcon(d, w, sw){
  if (d == null || d === 'undefined'){
    // A missing icon key used to render <path d="undefined"> — invisible, and
    // silent. Loud in the console beats a button the user cannot see.
    console.error('svgIcon: unknown icon key');
    d = 'M5 5h14v14H5z';
  }
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('width', w || 16); s.setAttribute('height', w || 16);
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', sw || 1.9);
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  String(d).split('|').forEach(p => {
    const n = document.createElementNS(NS, 'path'); n.setAttribute('d', p); s.appendChild(n);
  });
  return s;
}

/* Snippets carry <mark> around matched terms. Rather than trust the string,
   split on the marker and build the highlight nodes ourselves, so a forged
   <mark><img onerror=…></mark> becomes inert text. */
function snippetNode(raw, cls){
  const box = el('div', cls || 'srSnip');
  String(raw).split(/(<mark>.*?<\/mark>)/g).forEach(part => {
    if (!part) return;
    const m = part.match(/^<mark>(.*)<\/mark>$/);
    box.appendChild(m ? el('mark', null, m[1]) : document.createTextNode(part));
  });
  return box;
}

function sigNode(label, cls, path){
  const s = el('span', 'sig' + (cls ? ' ' + cls : ''));
  if (path) s.appendChild(svgIcon(path, 11, 2.2));
  s.appendChild(el('span', null, label));
  return s;
}

/* ── shared icon paths ────────────────────────────────────────────────────
   Multiple subpaths separated by '|'. This is the COMPLETE set both shells
   draw from — an incomplete map silently renders <path d="undefined">, which
   throws no error and shows nothing. See the emptyPaths check in icons.py.  */
const ICON = {
  clock:  'M12 7v5l3.2 1.9',
  shield: 'M12 3l7.5 3.2v5.1c0 4.4-3.1 8.3-7.5 9.4-4.4-1.1-7.5-5-7.5-9.4V6.2z',
  weight: 'M4 20h16L16 8H8zM9.5 8V6a2.5 2.5 0 0 1 5 0v2',
  lock:   'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  book:   'M4 5h10a3 3 0 0 1 3 3v11a2.5 2.5 0 0 0-2.5-2.5H4z|M20 5h-1a3 3 0 0 0-2 .8V19a2.5 2.5 0 0 1 2.5-2.5H20z',
  plus:   'M12 5v14M5 12h14',
  close:  'M6 6l12 12M18 6L6 18',
  x:      'M6 6l12 12M18 6L6 18',
  find:   'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z|M16.5 16.5L21 21',
  back:   'M15 5l-7 7 7 7',
  fwd:    'M9 5l7 7-7 7',
  home:   'M4 11l8-7 8 7v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z',
  menu:   'M4 7h16M4 12h16M4 17h16',
  tabs:   'M4 6h16v13H4z',
  share:  'M12 15V4M8.5 7.5L12 4l3.5 3.5|M5 13v6h14v-6',
  star:   'M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8z',
  split:  'M4 5h16v14H4z|M12 5v14',
  note:   'M6 4h9l4 4v12H6z|M15 4v4h4',
  down:   'M12 4v11M8 11l4 4 4-4|M5 20h14',
  desk:   'M4 5h16v11H4z|M9 20h6M12 16v4',
  snap:   'M12 7v5l3 2|M12 3a9 9 0 1 0 9 9',
  refresh:'M20 11a8 8 0 1 0-2.3 5.7|M20 5v6h-6',
  moon:   'M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z',
  puzzle: 'M9 4h6v2.2a1.8 1.8 0 1 0 3.6 0V4H20v16H4v-5.4H6.2a1.8 1.8 0 1 0 0-3.6H4V4z'
};

/* ── SITE registry ────────────────────────────────────────────────────────
   One entry per known site: brand tint (as an "r g b" triple for use inside
   rgb(var(--site)/α)) and a letter fallback. Desktop additionally draws real
   brand marks from MARK below; mobile uses the letter form at small sizes. */
const SITE = {
  youtube: {tint:'255 0 51',    ini:'▶'},
  netflix: {tint:'229 9 20',    ini:'N'},
  x:       {tint:'30 41 59',    ini:'X'},
  figma:   {tint:'162 89 255',  ini:'F'},
  github:  {tint:'55 65 81',    ini:'G'},
  dribbble:{tint:'234 76 137',  ini:'D'},
  arxiv:   {tint:'179 27 27',   ini:'A'},
  signal:  {tint:'30 58 95',    ini:'S'},
  mdn:     {tint:'11 95 255',   ini:'M'},
  hn:      {tint:'255 102 0',   ini:'Y'},
  ink:     {tint:'17 24 39',    ini:'I'},
  sqlite:  {tint:'15 128 204',  ini:'S'},
  medium:  {tint:'5 150 105',   ini:'M'},
  linear:  {tint:'94 106 210',  ini:'L'},
  notion:  {tint:'20 20 19',    ini:'N'}
};
const site   = k => SITE[k] || {tint:'100 116 139', ini:'?'};
const tintOf = t => site(typeof t === 'string' ? t : (t && t.mark)).tint;

function markNode(k){
  const s = site(k);
  const n = document.createElementNS(NS, 'svg');
  n.setAttribute('viewBox', '0 0 24 24');
  const r = document.createElementNS(NS, 'rect');
  r.setAttribute('width', 24); r.setAttribute('height', 24);
  r.setAttribute('fill', 'rgb(' + s.tint + ')');
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', 12); t.setAttribute('y', 16.5);
  t.setAttribute('font-family', 'Inter,sans-serif'); t.setAttribute('font-size', 12);
  t.setAttribute('font-weight', 700); t.setAttribute('fill', '#fff');
  t.setAttribute('text-anchor', 'middle');
  t.textContent = String(s.ini).slice(0, 2);
  n.append(r, t);
  return n;
}

const SR_DATA = [
  {kind:'Docs', k:'mdn', dom:'developer.mozilla.org', path:'Web › API › Service Worker API', read:'14 min', tr:0, kb:'310 KB', seen:true, title:'Service Worker API — offline and background sync', snip:'A service worker acts as a proxy between the application and the network, letting you serve an <mark>offline-first</mark> experience by intercepting requests and answering them from a cache.'},
  {kind:'Paper', k:'arxiv', dom:'arxiv.org', path:'cs.SE › 2603.04417', read:'18 min', tr:0, kb:'1.2 MB', queued:true, title:'Advanced patterns for offline-first applications', snip:'We survey conflict resolution strategies across twelve production systems and find that CRDT-backed <mark>offline-first architecture</mark> reduces sync failures by 61% versus last-write-wins.'},
  {kind:'Article', k:'signal', dom:'signalandnoise.com', path:'Essays › local software', read:'12 min', tr:2, kb:'184 KB', title:'Local-first software is just software that respects you', snip:'The argument for <mark>offline-first</mark> is usually framed as resilience. It is really about ownership: your data lives on your machine and the network is an optimisation, not a dependency.'},
  {kind:'Discussion', k:'hn', dom:'news.ycombinator.com', path:'item?id=41882301 · 284 comments', read:'26 min', tr:0, kb:'96 KB', title:'Ask HN: what actually broke when you went offline-first?', snip:'Long thread with practitioners. Recurring themes: clock skew, schema migration on stale clients, and users who never quit the app so never pick up new code.'},
  {kind:'Video', k:'youtube', dom:'youtube.com', path:'watch?v=xR2m · 22:14', read:'22:14', tr:31, kb:'14 MB', title:'Designing quiet interfaces — offline-first in practice', snip:'Conference talk walking through a rewrite of a field-service app for crews working in tunnels with no signal. Chapters and full transcript detected.'},
  {kind:'Code', k:'github', dom:'github.com', path:'rxdb / rxdb · 21.4k ★', read:'9 min', tr:0, kb:'420 KB', seen:true, title:'rxdb — a local-first, reactive database for JavaScript', snip:'Realtime replication, conflict handling and encryption. Ships adapters for IndexedDB, SQLite and in-memory storage for tests.'},
  {kind:'Docs', k:'sqlite', dom:'sqlite.org', path:'wasm › persistence', read:'11 min', tr:0, kb:'72 KB', title:'Persistent storage options for SQLite in the browser', snip:'Covers OPFS versus the older key-value VFS shims, and the durability guarantees each one can and cannot make when a tab is closed mid-write.'},
  {kind:'Article', k:'ink', dom:'inkandswitch.com', path:'Essays › local-first', read:'42 min', tr:0, kb:'760 KB', bookmarked:true, title:'Local-first software: you own your data, in spite of the cloud', snip:'The essay that named the movement. Seven ideals, an honest assessment of where CRDTs fall short, and a set of prototypes built against each one.'},
  {kind:'Article', k:'medium', dom:'medium.com', path:'@devblog › offline-apps-2026', read:'6 min', tr:47, kb:'3.1 MB', title:'10 offline-first tips every developer must know in 2026', snip:'Listicle summary of patterns already covered in the primary sources above. Heavy third-party script load and an interstitial paywall after the second section.'}
];

const SR_MINE = [
  {t:'Advanced patterns for offline-first apps', s:'In your reading queue · 18 min'},
  {t:'Offline-first patterns',                   s:'Sleeping tab · arxiv.org'},
  {t:'Local-first software',                     s:'Bookmarked 3 weeks ago'},
  {t:'sync-conflicts.md',                        s:'Note · Design Research'}
];

const SR_REL = ['CRDT', 'service workers', 'conflict resolution', 'IndexedDB', 'sync engines', 'local-first', 'OPFS'];

const QUEUE = [
  {t:'What happens after the click',             s:'signalandnoise.com', r:'12 min'},
  {t:'Advanced patterns for offline-first apps', s:'arxiv.org',          r:'18 min'},
  {t:'Privacy in 2026: what actually changed',   s:'eff.org',            r:'9 min'},
  {t:'The economics of default search',          s:'stratechery.com',    r:'14 min'},
  {t:'Interview: quiet software',                s:'signalandnoise.com', r:'7 min'}
];

const WORKSPACES = [
  {n:'Design Research',    a:'cyan', c:'#22D3EE', sealed:false, id:'terry@kapella.studio'},
  {n:'Code Review',        a:'blue', c:'#2563EB', sealed:false, id:'terry@kapella.studio'},
  {n:'Client — Northwind', a:'teal', c:'#0891B2', sealed:true,  id:'t.toto@northwind.co'},
  {n:'Japan Trip',         a:'mint', c:'#7EF3D6', sealed:true,  id:''}
];

const QUICK = [['figma','Figma'], ['github','GitHub'], ['signal','Signal'], ['arxiv','ArXiv'], ['x','X'], ['dribbble','Dribbble'], ['youtube','YouTube'], ['netflix','Netflix']];
const ACC_NAME = {blue:'Breeze Blue', cyan:'Sky Cyan', teal:'Ocean Teal', mint:'Aqua Mint'};
const LUM_LC = {bright:106, comfort:104, dim:101};
const byClock = () => { const h = new Date().getHours(); return (h >= 19 || h < 7) ? 'dark' : 'light'; };

function relLum(css){
  const m = String(css).match(/[\d.]+/g); if (!m) return 1;
  const f = c => { c = c / 255; return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
  return .2126 * f(+m[0]) + .7152 * f(+m[1]) + .0722 * f(+m[2]);
}
function paintLuminance(surfaceSel){
  const surf = $(surfaceSel) || document.body;
  const pct  = Math.round(relLum(getComputedStyle(surf).backgroundColor) * 100);
  const lvl  = root.dataset.comfort || 'comfort';
  const fill = $('#lumFill') || $('#lumRow i');
  const val  = $('#lumVal');
  const lc   = $('#lumLc');
  if (fill) fill.style.width = pct + '%';
  if (val)  val.textContent  = pct + '%';
  if (lc)   lc.textContent   = String(LUM_LC[lvl] || 104);
}
let __toastTimer;
function toast(msg){
  const t = $('#toast'); if (!t) return;
  const label = $('#toastText') || t;
  label.textContent = msg;
  t.dataset.on = '1';
  clearTimeout(__toastTimer);
  __toastTimer = setTimeout(() => t.dataset.on = '0', 2200);
}

const HISTORY = [{view:'home', kind:'page', host:'', label:'Home'}];
let hIndex = 0;
const canBack = () => hIndex > 0;
const canFwd  = () => hIndex < HISTORY.length - 1;
function pushHistory(entry){
  const cur = HISTORY[hIndex];
  if (cur && cur.view === entry.view && cur.host === entry.host && cur.kind === entry.kind) return;
  HISTORY.splice(hIndex + 1);
  HISTORY.push(entry);
  hIndex = HISTORY.length - 1;
  if (HISTORY.length > 60){ HISTORY.shift(); hIndex--; }
}
function goBack(){    if (canBack()){ hIndex--; applyHistory(); } }
function goForward(){ if (canFwd()){  hIndex++; applyHistory(); } }

const VERSION = {number:'1.0', name:'McCloskey', full:'Breeze McCloskey · Version 1.0'};
const SHELL = (typeof window !== 'undefined' && window.__BREEZE_SHELL__) || null;
const inShell = () => !!SHELL;
function shellCall(method, arg, fallbackMsg){
  if (SHELL && typeof SHELL[method] === 'function'){
    try { return SHELL[method](arg); }
    catch (err){ toast('Shell error: ' + method); return null; }
  }
  toast(fallbackMsg || 'Available in the Breeze app');
  return null;
}
