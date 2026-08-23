'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const library = require('./library');
const launch = require('./launch');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'breeze-launch-'));
try {
  library.init(root);
  launch.init(root);

  assert.equal(launch.status().firstRunComplete, false, 'first run starts incomplete');
  launch.completeFirstRun();
  assert.equal(launch.status().firstRunComplete, true, 'first run completion persists in memory');
  assert.ok(fs.existsSync(path.join(root, 'launch-state.json')), 'launch state is persisted');

  const html = path.join(root, 'bookmarks.html');
  fs.writeFileSync(html, `<!DOCTYPE NETSCAPE-Bookmark-file-1>
  <DL><p>
    <DT><A HREF="https://example.com/a">Example &amp; A</A>
    <DT><A HREF='https://example.org/b'>Example B</A>
    <DT><A HREF="javascript:alert(1)">Unsafe</A>
  </DL><p>`, 'utf8');
  const imported = launch.importBookmarksHtml(html);
  assert.equal(imported.ok, true);
  assert.equal(imported.imported, 2, 'only http/https bookmarks import');
  assert.equal(imported.skipped, 1, 'unsafe bookmark is skipped');
  const bookmarks = library.listBookmarks('');
  assert.equal(bookmarks.length, 2);
  assert.equal(bookmarks.some(b => b.title === 'Example & A'), true, 'entities decode safely');

  const exported = path.join(root, 'export.html');
  const exp = launch.exportBookmarksHtml(exported);
  assert.equal(exp.ok, true);
  assert.match(fs.readFileSync(exported, 'utf8'), /NETSCAPE-Bookmark-file-1/);
  assert.match(fs.readFileSync(exported, 'utf8'), /https:\/\/example\.com\/a/);

  const historyResult = library.importHistory([
    { url:'https://example.com/old', title:'Old', visitedAt:1000, workspace:'Imported' },
    { url:'https://example.com/new', title:'New', visitedAt:5000, workspace:'Imported' },
    { url:'file:///tmp/private', title:'Nope', visitedAt:9999, workspace:'Imported' }
  ]);
  assert.equal(historyResult.imported, 2);
  assert.equal(historyResult.skipped, 1);
  const history = library.listHistory('');
  assert.equal(history[0].url, 'https://example.com/new');
  assert.equal(history.some(h => h.url.startsWith('file:')), false);

  const chromeUnixEpoch = 11644473600000000;
  assert.equal(launch.chromiumTimeToUnixMs(chromeUnixEpoch), 0, 'Chromium epoch converts to Unix epoch');
  assert.ok(Array.isArray(launch.detectSources()), 'source detection is safe when browsers are absent');

  console.log('Breeze launch/migration tests passed');
} finally {
  fs.rmSync(root, { recursive:true, force:true });
}
