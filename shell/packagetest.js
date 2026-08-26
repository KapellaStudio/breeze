/* Breeze packaged archive completeness test.
   A browser that works from source can still crash after installation when an
   explicitly-whitelisted runtime dependency is omitted from app.asar. This
   gate inspects every packaged app.asar it can find and requires the complete
   startup/extension chain before an installer can be approved. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const REQUIRED = [
  'bootstrap.js',
  'main.js',
  'preload.js',
  'extensions.js',
  'extensions-runtime.js',
  'extension-compat.js',
  'extension-page-preload.js',
  'extension-sw-preload.js',
  'extension-identity-preload.js',
  'extension-self-close.js'
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    if (path.basename(dir) === 'app.asar') out.push(path.resolve(dir));
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name === 'app.asar') out.push(path.resolve(full));
  }
  return out;
}

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['dist'];
const archives = [...new Set(roots.flatMap(root => walk(path.resolve(root))))];
if (!archives.length) {
  console.error(`PACKAGE TEST FAILED: no app.asar found under ${roots.join(', ')}`);
  process.exit(2);
}

let failed = false;
for (const archive of archives) {
  let listed;
  try {
    listed = asar.listPackage(archive);
  } catch (err) {
    console.error(`PACKAGE TEST FAILED: could not read ${archive}: ${err.message || err}`);
    failed = true;
    continue;
  }
  const files = new Set((listed || []).map(name => String(name).replace(/^[/\\]+/, '').replace(/\\/g, '/')));
  const missing = REQUIRED.filter(name => !files.has(name));
  if (missing.length) {
    console.error(`PACKAGE TEST FAILED: ${archive}`);
    console.error(`Missing required runtime files: ${missing.join(', ')}`);
    failed = true;
  } else {
    console.log(`Package archive OK: ${archive}`);
    console.log(`Required startup/runtime files present: ${REQUIRED.length}/${REQUIRED.length}`);
  }
}

if (failed) process.exit(1);
console.log(`Breeze package completeness: ${archives.length} archive(s) passed.`);
