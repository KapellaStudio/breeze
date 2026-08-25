/* ═══════════════════════════════════════════════════════════════════════════
   BREEZE — PACKAGED BROWSER INTERACTIONS
   User-facing bindings for visible browser controls. Keep the common path
   simple: one click should do what the icon says.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const S = window.__BREEZE_SHELL__;
  if (!S || !S.isShell) return;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const toastSafe = text => {
    try { if (typeof toast === 'function') toast(text); } catch {}
  };
  const hostOf = url => {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return ''; }
  };
  const canonicalUrl = url => {
    try {
      const u = new URL(url);
      u.hash = '';
      const out = u.toString();
      return out.endsWith('/') && u.pathname === '/' && !u.search ? out.slice(0, -1) : out;
    } catch { return String(url || ''); }
  };
  const showBrowse = () => {
    try { if (typeof setView === 'function') setView('browse'); } catch {}
  };
  const showHome = () => {
    try { if (typeof setView === 'function') setView('home'); } catch {}
  };
  const closeChromeOverlays = () => {
    try { if (typeof closeAll === 'function') closeAll(); } catch {}
  };
  let activeTab = null;

  function tabModelForButton(button) {
    if (!button || typeof flatTabs !== 'function') return null;
    const buttons = [...document.querySelectorAll('#tablist .tab')];
    const index = buttons.indexOf(button);
    return index >= 0 ? flatTabs()[index] || null : null;
  }

  async function refreshActiveTab() {
    const tabs = await S.listTabs().catch(() => []);
    activeTab = (tabs || []).find(t => t.active) || null;
    return activeTab;
  }

  async function enforceBrandSafeSearch() {
    const cfg = await S.searchConfig().catch(() => null);
    // A Breeze user should never unexpectedly land on a Brave-branded page.
    // Existing beta profiles are corrected even if an earlier migration flag
    // was already written.
    if (cfg?.provider === 'Brave Search') {
      await S.setSearchProvider('Google').catch(() => null);
    }
    const firstRun = await S.firstRunStatus().catch(() => null);
    const prefs = await S.getPreferences().catch(() => null);
    if (firstRun?.firstRunComplete && prefs && !prefs.searchProviderMigrated) {
      await S.setPreference('searchProviderMigrated', true).catch(() => null);
    }
    try {
      if (typeof engine !== 'undefined' && engine === 'Brave Search') {
        engine = 'Google';
        if (typeof renderEngines === 'function') renderEngines();
      }
    } catch {}
    scrubBraveFromChrome();
    return true;
  }

  function scrubBraveFromChrome() {
    $$('#engRow .engBtn').forEach(b => {
      if (/brave/i.test(b.textContent || '')) b.remove();
    });
  }

  function scheduleSearchMigration() {
    let attempts = 0;
    const run = async () => {
      attempts += 1;
      await enforceBrandSafeSearch();
      const cfg = await S.searchConfig().catch(() => null);
      if (cfg?.provider !== 'Brave Search' || attempts >= 100) return;
      setTimeout(run, 100);
    };
    run();
    const row = $('#engRow');
    if (row) new MutationObserver(scrubBraveFromChrome).observe(row, { childList: true, subtree: true });
  }

  function guardAllSearchSubmissions() {
    try {
      const original = window.runSearch;
      if (typeof original !== 'function' || original.__breezeBrandGuard) return;
      const wrapped = async function() {
        await enforceBrandSafeSearch();
        return original.apply(this, arguments);
      };
      wrapped.__breezeBrandGuard = true;
      window.runSearch = wrapped;
    } catch {}
  }

  function bindHomeSearch() {
    const input = $('.bigsearch input');
    const wrap = input?.closest('.bigsearch');
    if (!input || !wrap || input.dataset.realBrowserSearch === '1') return;

    input.dataset.realBrowserSearch = '1';
    input.readOnly = false;
    input.tabIndex = 0;
    input.style.pointerEvents = 'auto';
    wrap.removeAttribute('data-open');
    wrap.dataset.realBrowserSearch = '1';

    // Remove the old prototype overlay action; the field itself owns focus.
    wrap.onclick = () => input.focus();

    input.addEventListener('keydown', async e => {
      if (e.key !== 'Enter') return;
      const value = input.value.trim();
      if (!value) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      closeChromeOverlays();

      await enforceBrandSafeSearch();
      const tabs = await S.listTabs().catch(() => []);
      const active = (tabs || []).find(t => t.active);
      if (active?.id != null) await S.navigate(active.id, value);
      else await S.newTab({ url: value });
      input.value = '';
      showBrowse();
    }, true);
  }

  async function resumeRecentCard(card) {
    const title = card.querySelector('h3')?.textContent?.trim() || '';
    const detail = card.querySelector('p')?.textContent || '';
    const hintedHost = detail.split('·')[0].trim();
    const tabs = await S.listTabs().catch(() => []);
    const active = (tabs || []).find(t => t.active);
    const workspace = String(active?.workspace || 'default');
    const sealed = !!active?.sealed;
    const history = await S.historyList('').catch(() => []);
    const candidates = (history || []).filter(r => {
      const sameWorkspace = !r.workspace || String(r.workspace) === workspace;
      return sameWorkspace && (!hintedHost || hostOf(r.url) === hintedHost);
    });
    const recent = candidates.find(r => String(r.title || hostOf(r.url)).trim() === title) || candidates[0];
    if (!recent?.url) return false;

    const target = canonicalUrl(recent.url);
    const open = (tabs || []).find(t =>
      !t.private &&
      String(t.workspace || 'default') === workspace &&
      !!t.sealed === sealed &&
      canonicalUrl(t.url) === target
    );
    if (open?.id != null) {
      await S.selectTab(open.id);
      showBrowse();
      return true;
    }

    await S.newTab({ url: recent.url, workspaceId: workspace, sealed });
    showBrowse();
    return true;
  }

  /* One-click bookmark ----------------------------------------------------- */
  async function paintBookmarkButton(button) {
    if (!button) return;
    const tab = await refreshActiveTab();
    const usable = tab?.id != null && /^https?:\/\//i.test(tab.url || '');
    let saved = false;
    if (usable) saved = !!(await S.isBookmarked(tab.id).catch(() => false));
    button.disabled = !usable;
    button.setAttribute('aria-pressed', saved ? 'true' : 'false');
    button.dataset.saved = saved ? '1' : '0';
    button.title = saved ? 'Remove bookmark' : 'Bookmark this page';
  }

  function wireOneClickBookmark() {
    const old = $('.tools [data-panel="bookmarks"]');
    if (!old) return null;
    const button = old.cloneNode(true);
    old.replaceWith(button);
    button.id = 'toolbarBookmarkBtn';
    button.removeAttribute('data-panel');
    button.setAttribute('aria-label', 'Bookmark this page');
    button.onclick = async e => {
      e.preventDefault();
      e.stopPropagation();
      const tab = await refreshActiveTab();
      if (tab?.id == null || !/^https?:\/\//i.test(tab.url || '')) {
        toastSafe('Open a web page to bookmark it');
        return;
      }
      const result = await S.toggleBookmark(tab.id).catch(() => ({ error: 'Could not change bookmark' }));
      if (result?.error) {
        toastSafe(result.error);
        return;
      }
      toastSafe(result.saved ? 'Bookmarked' : 'Bookmark removed');
      await paintBookmarkButton(button);
      try {
        if (typeof window.__BREEZE_SHELL_RENDER_BOOKMARKS__ === 'function') {
          window.__BREEZE_SHELL_RENDER_BOOKMARKS__();
        }
      } catch {}
    };
    paintBookmarkButton(button);
    return button;
  }

  /* Notes: open, type, save. No prompt dialog. ----------------------------- */
  function noteWorkspace(tab) {
    return tab && !tab.private ? String(tab.workspace || 'default') : 'default';
  }

  async function renderSimpleNotes(focusComposer = false) {
    const panel = $('aside[data-p="notes"]');
    const body = $('#notesBody') || panel?.querySelector('.pBody');
    if (!panel || !body) return;

    const tab = await refreshActiveTab();
    const workspace = noteWorkspace(tab);
    const rows = await S.listNotes(workspace).catch(() => []);
    const frag = document.createDocumentFragment();

    const composer = document.createElement('div');
    composer.className = 'breezeNoteComposer';
    const textarea = document.createElement('textarea');
    textarea.id = 'breezeQuickNote';
    textarea.rows = 4;
    textarea.placeholder = tab && /^https?:\/\//i.test(tab.url || '')
      ? 'Write a note about this page…'
      : 'Write a note…';
    textarea.setAttribute('aria-label', 'Write a note');
    const controls = document.createElement('div');
    controls.className = 'breezeNoteComposerControls';
    const hint = document.createElement('span');
    hint.textContent = 'Saved locally';
    const save = document.createElement('button');
    save.id = 'breezeSaveNote';
    save.className = 'btn';
    save.type = 'button';
    save.textContent = 'Save note';
    save.disabled = true;
    textarea.addEventListener('input', () => { save.disabled = !textarea.value.trim(); });
    const saveNote = async () => {
      const value = textarea.value.trim();
      if (!value) return;
      const nowTab = await refreshActiveTab();
      if (nowTab?.private) {
        const keep = confirm('Save this note after Private browsing closes?');
        if (!keep) return;
      }
      const r = await S.addNote({
        url: /^https?:\/\//i.test(nowTab?.url || '') ? nowTab.url : '',
        title: nowTab?.title || 'Breeze',
        workspace: noteWorkspace(nowTab),
        body: value,
        kind: 'note'
      }).catch(() => ({ error: 'Could not save note' }));
      if (r?.error) return toastSafe(r.error);
      textarea.value = '';
      save.disabled = true;
      toastSafe('Note saved');
      renderSimpleNotes(true);
    };
    save.onclick = saveNote;
    textarea.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        saveNote();
      }
    });
    controls.append(hint, save);
    composer.append(textarea, controls);
    frag.append(composer);

    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'ctxEmpty';
      empty.textContent = 'No notes in this workspace yet.';
      frag.append(empty);
    }

    rows.forEach(n => {
      const card = document.createElement('div');
      card.className = 'note breezeSimpleNote';
      const ctx = document.createElement('div');
      ctx.className = 'ctx';
      ctx.textContent = n.title || hostOf(n.url) || 'Breeze note';
      const edit = document.createElement('textarea');
      edit.className = 'breezeExistingNote';
      edit.rows = 3;
      edit.value = String(n.body || '');
      edit.setAttribute('aria-label', 'Edit note');
      let last = edit.value;
      const persistEdit = async () => {
        const next = edit.value.trim();
        if (!next || next === last) return;
        const r = await S.updateNote(n.id, next).catch(() => ({ error: 'Could not update note' }));
        if (r?.error) return toastSafe(r.error);
        last = next;
        toastSafe('Note updated');
      };
      edit.addEventListener('change', persistEdit);
      edit.addEventListener('blur', persistEdit);
      const actions = document.createElement('div');
      actions.className = 'ctxActions';
      if (n.url) {
        const open = document.createElement('button');
        open.type = 'button';
        open.textContent = 'Open page';
        open.onclick = () => S.newTab({ url: n.url, workspaceId: n.workspace || workspace }).catch(() => {});
        actions.append(open);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ctxDanger';
      remove.textContent = 'Delete';
      remove.onclick = async () => {
        await S.removeNote(n.id).catch(() => {});
        renderSimpleNotes(false);
      };
      actions.append(remove);
      card.append(ctx, edit, actions);
      frag.append(card);
    });

    body.replaceChildren(frag);
    if (focusComposer && panel.dataset.on === '1') {
      setTimeout(() => textarea.focus(), 0);
    }
  }

  function wireSimpleNotes() {
    const inherited = window.openPanel;
    if (typeof inherited === 'function' && !inherited.__breezeSimpleNotes) {
      const wrapped = function(name) {
        const result = inherited.apply(this, arguments);
        if (name === 'notes') setTimeout(() => renderSimpleNotes(true), 0);
        return result;
      };
      wrapped.__breezeSimpleNotes = true;
      window.openPanel = wrapped;
    }
    document.addEventListener('click', e => {
      if (e.target.closest('.tools [data-panel="notes"]')) {
        setTimeout(() => renderSimpleNotes(true), 20);
      }
    }, true);
  }

  /* Weather belongs in the working toolbar, not only on New Tab. ----------- */
  const usaFahrenheit = () => {
    const locale = String(navigator.language || '').toUpperCase();
    return /-(US|BS|BZ|KY|PW|FM|MH)$/.test(locale);
  };

  function wireToolbarWeather() {
    const tools = $('.tools');
    const divider = tools?.querySelector('.divider');
    if (!tools || !divider || $('#toolbarWeather')) return null;

    const style = document.createElement('style');
    style.textContent = `
      #toolbarWeather{min-width:42px;width:auto;padding:0 7px;font-size:10.5px;font-weight:650;letter-spacing:-.01em;color:var(--tx2);font-variant-numeric:tabular-nums}
      #toolbarWeather[data-state="ready"]{color:var(--tx1)}
      #toolbarWeather[data-state="error"]{color:var(--tx3)}
      .breezeNoteComposer{display:grid;gap:8px;margin:0 0 12px}
      .breezeNoteComposer textarea,.breezeExistingNote{width:100%;box-sizing:border-box;resize:vertical;border:1px solid var(--line);background:var(--bg2);color:var(--tx1);border-radius:10px;padding:9px 10px;font:inherit;line-height:1.45;outline:none}
      .breezeNoteComposer textarea:focus,.breezeExistingNote:focus{border-color:color-mix(in srgb,var(--accent) 62%,var(--line));box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 12%,transparent)}
      .breezeNoteComposerControls{display:flex;align-items:center;gap:8px}
      .breezeNoteComposerControls span{flex:1;color:var(--tx3);font-size:10px}
      .breezeSimpleNote{margin-bottom:8px}
      .breezeSimpleNote .breezeExistingNote{margin-top:6px}
      #toolbarBookmarkBtn[aria-pressed="true"]{color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent)}
    `;
    document.head.append(style);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'iconbtn';
    button.id = 'toolbarWeather';
    button.dataset.state = 'loading';
    button.textContent = '—°';
    button.setAttribute('aria-label', 'Current weather');
    button.title = 'Loading local weather';
    tools.insertBefore(button, divider);

    let enabled = true;
    let loading = false;
    const unit = usaFahrenheit() ? 'fahrenheit' : 'celsius';

    const load = async () => {
      if (loading) return;
      loading = true;
      button.dataset.state = 'loading';
      button.textContent = '—°';
      try {
        const prefs = await S.getPreferences().catch(() => ({}));
        enabled = prefs?.weatherEnabled !== false;
        if (!enabled) {
          button.dataset.state = 'off';
          button.textContent = 'Weather';
          button.title = 'Weather is off · click to enable';
          return;
        }
        const w = await S.currentWeather(unit);
        if (!w || w.error || w.temperature == null) throw new Error(w?.error || 'weather unavailable');
        button.dataset.state = 'ready';
        button.textContent = `${w.temperature}°`;
        button.title = `${w.location || 'Current area'} · ${w.temperature}°${w.unit || ''} · ${w.condition || 'Current weather'}`;
      } catch {
        button.dataset.state = 'error';
        button.textContent = '—°';
        button.title = 'Weather unavailable · click to retry';
      } finally {
        loading = false;
      }
    };

    (async () => {
      const prefs = await S.getPreferences().catch(() => ({}));
      // Restore the toolbar weather for existing beta users exactly once.
      // Afterwards an explicit Settings choice is respected.
      const migrationKey = 'breeze.weatherToolbar.restored.v1';
      let migrated = false;
      try { migrated = localStorage.getItem(migrationKey) === '1'; } catch {}
      if (!migrated) {
        if (prefs?.weatherEnabled === false) await S.setPreference('weatherEnabled', true).catch(() => null);
        try { localStorage.setItem(migrationKey, '1'); } catch {}
      }
      load();
    })();

    button.onclick = async () => {
      const prefs = await S.getPreferences().catch(() => ({}));
      if (prefs?.weatherEnabled === false) {
        await S.setPreference('weatherEnabled', true).catch(() => null);
        enabled = true;
      }
      load();
    };
    setInterval(load, 20 * 60 * 1000);
    return button;
  }

  /* Flow media: the prototype accidentally recursed into itself. ------------- */
  function repairFlowMediaLoader() {
    try {
      if (typeof flowLoadMediaInfo !== 'function' || typeof flowMediaFormats !== 'function') return;
      flowLoadMediaInfo = async function(info) {
        if (!info || info.error) {
          const result = $('#flowMediaResult');
          if (result) result.textContent = info?.error || 'Could not open media.';
          return;
        }
        flowMediaJob = info;
        const kind = info.kind === 'video' ? 'video' : 'audio';
        if (typeof flowShow === 'function') flowShow('flowMediaWork');
        const title = $('#flowMediaTitle');
        const name = $('#flowMediaName');
        const meta = $('#flowMediaMeta');
        const format = $('#flowMediaFormat');
        const result = $('#flowMediaResult');
        if (title) title.textContent = kind === 'video' ? 'Video convert & extract' : 'Audio convert';
        if (name) name.textContent = info.name || 'Media file';
        const bytes = Number(info.size || 0);
        const size = bytes < 1024 * 1024
          ? `${Math.max(1, Math.round(bytes / 1024))} KB`
          : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        if (meta) meta.textContent = `${String(info.ext || kind).toUpperCase()} · ${size} · local`;
        const rows = await flowMediaFormats(kind);
        if (format) {
          format.replaceChildren(...rows.map(([id, label]) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = label;
            return option;
          }));
        }
        if (result) result.textContent = 'Ready — choose a format and save.';
      };
    } catch {}
  }

  function startCleanToolbar() {
    try {
      // A normal browsing window should not start with a side panel already
      // consuming content space. Panels open only when the user asks.
      if (typeof closePanels === 'function') closePanels();
    } catch {}
    const menu = $('.tools [data-open="set"]');
    if (menu) {
      menu.title = 'Menu & settings';
      menu.setAttribute('aria-label', 'Menu and settings');
    }
  }

  document.addEventListener('click', e => {
    const close = e.target.closest('#tablist .tab .x');
    if (close) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const tab = tabModelForButton(close.closest('.tab'));
      if (tab?.id != null) S.closeTab(tab.id);
      return;
    }

    const newTab = e.target.closest('#tablist .newtab');
    if (newTab) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      closeChromeOverlays();
      S.newTab({}).then(showHome);
      return;
    }

    const recentCard = e.target.closest('.continue .card');
    if (recentCard && recentCard.querySelector('.kind')?.textContent?.trim() === 'Recent page') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      resumeRecentCard(recentCard).catch(() => {});
    }
  }, true);

  S.on('tab:update', st => {
    if (st?.active) activeTab = st;
    const b = $('#toolbarBookmarkBtn');
    if (b) paintBookmarkButton(b);
  });
  S.on('tab:closed', () => {
    const b = $('#toolbarBookmarkBtn');
    if (b) setTimeout(() => paintBookmarkButton(b), 0);
  });

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'd') {
      const b = $('#toolbarBookmarkBtn');
      if (b) setTimeout(() => paintBookmarkButton(b), 80);
    }
  }, true);

  bindHomeSearch();
  guardAllSearchSubmissions();
  scheduleSearchMigration();
  startCleanToolbar();
  wireOneClickBookmark();
  wireSimpleNotes();
  wireToolbarWeather();
  repairFlowMediaLoader();
  refreshActiveTab();
  document.documentElement.dataset.usabilityPass = '1';
})();
