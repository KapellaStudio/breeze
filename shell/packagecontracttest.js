/* Breeze packaging source contract.
   Electron Builder uses an explicit files allowlist, so any new local require
   can silently work in development and disappear from the installer. Follow
   the local CommonJS dependency graph from bootstrap.js and require both
   package manifests to include every runtime source plus the extension preload
   files that are referenced by path rather than require(). */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ROOT = __dirname;

const EXTRA = [
  'preload.js',
  'extension-page-preload.js',
  'extension-sw-preload.js',
  'extension-identity-preload.js',
  'pdf-preload.js',
  'ui/pdf-viewer.html',
  'ui/pdf-viewer.css',
  'ui/pdf-viewer.js',
  'ui/breeze-desktop.html',
  'ui/breeze-mobile.html'
];

function localRequires(file, seen = new Set()) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (seen.has(rel)) return seen;
  seen.add(rel);
  const source = fs.readFileSync(file, 'utf8');
  const re = /require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;
  let match;
  while ((match = re.exec(source))) {
    let target = path.resolve(path.dirname(file), match[1]);
    if (!path.extname(target)) target += '.js';
    if (!target.startsWith(ROOT + path.sep) || !fs.existsSync(target)) continue;
    localRequires(target, seen);
  }
  return seen;
}

function manifestFiles(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const block = text.match(/^files:\s*\n([\s\S]*?)(?=^[A-Za-z][\w-]*:\s*(?:\n|$))/m);
  if (!block) throw new Error(`files allowlist missing from ${path.basename(file)}`);
  return new Set([...block[1].matchAll(/^\s+-\s+([^\n#]+?)\s*$/gm)].map(m => m[1].trim().replace(/^['"]|['"]$/g, '')));
}

const required = new Set([...localRequires(path.join(ROOT, 'bootstrap.js')), ...EXTRA]);
const manifests = ['electron-builder.yml', 'electron-builder.production.yml'];
let failed = false;
for (const name of manifests) {
  const listed = manifestFiles(path.join(ROOT, name));
  const missing = [...required].filter(file => !listed.has(file)).sort();
  if (missing.length) {
    failed = true;
    console.error(`${name}: missing ${missing.join(', ')}`);
  } else {
    console.log(`${name}: packaging contract OK (${required.size} required runtime files)`);
  }
}
if (failed) process.exit(1);
