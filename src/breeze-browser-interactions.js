/* ═══════════════════════════════════════════════════════════════════════════
   BREEZE — PACKAGED BROWSER INTERACTIONS
   Shell-only bindings for visible browser controls that must drive the real
   Chromium tab model rather than the standalone prototype model.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const S = window.__BREEZE_SHELL__;
  if (!S || !S.isShell) return;

  const $ = s => document.querySelector(s);
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

  function tabModelForButton(button) {
    if (!button || typeof flatTabs !== 'function') return null;
    const buttons = [...document.querySelectorAll('#tablist .tab')];
    const index = buttons.indexOf(button);
    return index >= 0 ? flatTabs()[index] || null : null;
  }

  async function migrateLegacySearchProvider() {
    const firstRun = await S.firstRunStatus().catch(() => null);
    if (!firstRun?.firstRunComplete) return false;

    const prefs = await S.getPreferences().catch(() => null);
    if (!prefs) return false;
    if (prefs.searchProviderMigrated) return true;

    const cfg = await S.searchConfig().catch(() => null);
    if (cfg?.provider === 'Brave Search') await S.setSearchProvider('Google').catch(() => null);
    await S.setPreference('searchProviderMigrated', true).catch(() => null);
    return true;
  }

  function scheduleSearchMigration() {
    let attempts = 0;
    const run = async () => {
      attempts += 1;
      const done = await migrateLegacySearchProvider();
      if (done || attempts >= 300) return;
      setTimeout(run, 100);
    };
    run();
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

    // The prototype assigned an onclick before this shell module loads.
    // Replace it outright so the removed data-open route cannot still fire.
    wrap.onclick = () => input.focus();

    input.addEventListener('keydown', async e => {
      if (e.key !== 'Enter') return;
      const value = input.value.trim();
      if (!value) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      closeChromeOverlays();

      await migrateLegacySearchProvider();
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
    const open = (tabs || []).find(t => !t.private && String(t.workspace || 'default') === workspace && !!t.sealed === sealed && canonicalUrl(t.url) === target);
    if (open?.id != null) {
      await S.selectTab(open.id);
      showBrowse();
      return true;
    }

    await S.newTab({ url: recent.url, workspaceId: workspace, sealed });
    showBrowse();
    return true;
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

  bindHomeSearch();
  scheduleSearchMigration();
})();
