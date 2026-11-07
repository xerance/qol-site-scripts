// ==UserScript==
// @name         SubtitleCatLangFilter
// @namespace    https://github.com/xerance/qol-site-scripts
// @version      1.2.0
// @description  subtitlecat.com subtitle pages: floating filter button (bottom right) to show only the languages you care about, and to hide languages that have no subtitle yet.
// @author       xerance
// @match        *://subtitlecat.com/*
// @match        *://*.subtitlecat.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'scLangFilter.v1';

  // ---------------------------------------------------------------- settings

  const DEFAULTS = { langs: [], onlyTranslated: false };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { ...DEFAULTS };
      const v = JSON.parse(raw);
      return {
        langs: Array.isArray(v.langs) ? v.langs.filter((x) => typeof x === 'string') : [],
        onlyTranslated: !!v.onlyTranslated,
      };
    } catch (e) {
      return { ...DEFAULTS };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    } catch (e) {
      /* private mode / full storage: the filter still works for this page view */
    }
  }

  const settings = loadSettings();
  const keep = new Set(settings.langs); // empty == no language filter, show all

  // -------------------------------------------------------------------- rows

  // One entry per language row on the page. `cell` is the bootstrap column we
  // hide, so the grid reflows cleanly instead of leaving gaps.
  let rows = [];

  function rowInfo(sub) {
    const spans = [...sub.children].filter((c) => c.tagName === 'SPAN');
    const img = sub.querySelector('img.flag');
    const btn = sub.querySelector('button[id]');
    const dl = sub.querySelector('a[id^="download_"]');
    const code =
      (img && img.getAttribute('alt')) ||
      (btn && btn.id) ||
      (dl && dl.id.replace(/^download_/, '')) ||
      '';
    const name = (spans[1] ? spans[1].textContent : '').replace(/\s+/g, ' ').trim();
    if (!code || !name) return null;
    return {
      sub,
      cell: sub.closest('[class*="col-"]') || sub,
      code,
      name,
      flag: img ? img.getAttribute('src') : '',
      get translated() {
        return !!this.sub.querySelector('a[id^="download_"]');
      },
    };
  }

  function collectRows() {
    const found = [...document.querySelectorAll('div.sub-single')].map(rowInfo).filter(Boolean);
    // De-dup by language code, keeping page order.
    const seen = new Set();
    rows = found.filter((r) => (seen.has(r.code) ? false : (seen.add(r.code), true)));
    return rows;
  }

  function isVisible(r) {
    if (settings.onlyTranslated && !r.translated) return false;
    if (keep.size && !keep.has(r.code)) return false;
    return true;
  }

  function applyFilter() {
    let shown = 0;
    for (const r of rows) {
      const ok = isVisible(r);
      r.cell.classList.toggle('scl-hidden', !ok);
      if (ok) shown++;
    }
    updateBadge(shown);
    return shown;
  }

  // ---------------------------------------------------------------------- UI

  // A light panel, like the rest of the site: black-on-white text instead of
  // grey-on-dark. Every text colour here is at least 7:1 on its background,
  // and `!important` keeps the site's own stylesheet out of the panel.
  const css = [
    '.scl-hidden { display: none !important; }',
    '#scl-fab {',
    '  position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;',
    '  display: flex; align-items: center; gap: 9px;',
    '  padding: 11px 16px; border: 2px solid #111418; border-radius: 999px;',
    '  background: #111418; color: #ffffff; cursor: pointer;',
    '  font: 700 15px/1.1 system-ui, -apple-system, "Segoe UI", sans-serif;',
    '  box-shadow: 0 4px 16px rgba(0,0,0,.3);',
    '}',
    '#scl-fab:hover { background: #2a2f38; border-color: #2a2f38; }',
    '#scl-fab.scl-on { background: #ffc800; border-color: #111418; color: #111418; }',
    '#scl-fab.scl-on:hover { background: #ffd633; }',
    '#scl-fab .scl-count {',
    '  padding: 2px 8px; border-radius: 999px; font-size: 13px; font-weight: 800;',
    '  background: #ffffff; color: #111418;',
    '}',
    '#scl-fab.scl-on .scl-count { background: #111418; color: #ffffff; }',
    '#scl-panel {',
    '  position: fixed; right: 18px; bottom: 76px; z-index: 2147483000;',
    '  width: 340px; max-width: calc(100vw - 36px);',
    '  display: none; flex-direction: column; overflow: hidden;',
    '  background: #ffffff !important; color: #111418 !important;',
    '  border: 2px solid #111418; border-radius: 12px;',
    '  box-shadow: 0 12px 34px rgba(0,0,0,.28);',
    '  font: 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif !important;',
    '  accent-color: #111418;',
    '}',
    '#scl-panel.scl-open { display: flex; }',
    '#scl-panel * { box-sizing: border-box; }',
    '#scl-panel input[type=checkbox] {',
    '  width: 17px; height: 17px; flex: 0 0 auto; margin: 0; cursor: pointer;',
    '}',
    '.scl-head {',
    '  display: flex; align-items: center; justify-content: space-between;',
    '  padding: 11px 14px; background: #ffc800; border-bottom: 2px solid #111418;',
    '  font-size: 15px; font-weight: 800; color: #111418 !important;',
    '}',
    '.scl-head button {',
    '  border: 0; background: transparent; color: #111418 !important;',
    '  font-size: 22px; line-height: 1; cursor: pointer; padding: 0 5px; border-radius: 6px;',
    '}',
    '.scl-head button:hover { background: rgba(0,0,0,.14); }',
    '.scl-body { padding: 12px 14px 0; background: #ffffff; }',
    '#scl-search {',
    '  width: 100%; padding: 9px 11px; margin-bottom: 10px;',
    '  border: 2px solid #5c636e; border-radius: 8px;',
    '  background: #ffffff !important; color: #111418 !important; font-size: 15px;',
    '}',
    '#scl-search:focus { outline: 0; border-color: #111418; }',
    '#scl-search::placeholder { color: #595f69 !important; opacity: 1; }',
    '.scl-opt {',
    '  display: flex; align-items: center; gap: 9px; margin-bottom: 12px;',
    '  cursor: pointer; color: #111418 !important; font-weight: 500;',
    '}',
    '.scl-acts { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }',
    '.scl-acts button {',
    '  padding: 6px 11px; border: 2px solid #111418; border-radius: 7px;',
    '  background: #ffffff; color: #111418 !important;',
    '  font-size: 13px; font-weight: 700; cursor: pointer;',
    '}',
    '.scl-acts button:hover { background: #ffc800; }',
    '#scl-list {',
    '  max-height: min(46vh, 340px); overflow: auto;',
    '  background: #ffffff; border-top: 2px solid #111418;',
    '  padding: 6px 8px 6px 12px; margin: 0;',
    '}',
    '#scl-list label {',
    '  display: flex; align-items: center; gap: 10px;',
    '  padding: 6px; border-radius: 6px; cursor: pointer;',
    '  font-weight: 500; color: #111418 !important;',
    '}',
    '#scl-list label:hover { background: #fff2bf; }',
    '#scl-list img { width: 20px; height: auto; flex: 0 0 auto; border: 1px solid #c9ced6; }',
    '#scl-list .scl-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '#scl-list .scl-dot {',
    '  flex: 0 0 auto; font-size: 11px; font-weight: 800; letter-spacing: .4px;',
    '  color: #ffffff; background: #1c7a3e; padding: 2px 7px; border-radius: 4px;',
    '}',
    '#scl-list .scl-dot.scl-none {',
    '  color: #595f69; background: transparent; font-weight: 500; letter-spacing: 0;',
    '}',
    '.scl-foot {',
    '  padding: 10px 14px; font-size: 13px; color: #111418 !important;',
    '  background: #f1f3f6; border-top: 2px solid #111418;',
    '}',
  ].join('\n');

  let fab, panel, listEl, searchEl, footEl, onlyEl;

  function updateBadge(shown) {
    if (!fab) return;
    const active = keep.size > 0 || settings.onlyTranslated;
    fab.classList.toggle('scl-on', active);
    fab.querySelector('.scl-count').textContent = active
      ? shown + '/' + rows.length
      : String(rows.length);
    fab.title = active
      ? 'Language filter on — showing ' + shown + ' of ' + rows.length
      : 'Language filter — showing all languages';
    if (footEl) {
      const translated = rows.filter((r) => r.translated).length;
      footEl.textContent = keep.size
        ? shown + ' shown · ' + keep.size + ' picked · ' + translated + ' with subtitles'
        : 'No languages picked — showing all ' + shown + '. Tick some to narrow it down.';
    }
  }

  function renderList() {
    const q = (searchEl.value || '').trim().toLowerCase();
    const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    listEl.textContent = '';
    for (const r of sorted) {
      if (q && !r.name.toLowerCase().includes(q) && !r.code.toLowerCase().includes(q)) continue;
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = keep.has(r.code);
      cb.dataset.code = r.code;
      cb.addEventListener('change', () => {
        if (cb.checked) keep.add(r.code);
        else keep.delete(r.code);
        settings.langs = [...keep];
        saveSettings();
        applyFilter();
      });
      label.appendChild(cb);
      if (r.flag) {
        const img = document.createElement('img');
        img.src = r.flag;
        img.alt = '';
        label.appendChild(img);
      }
      const name = document.createElement('span');
      name.className = 'scl-name';
      name.textContent = r.name;
      label.appendChild(name);
      const dot = document.createElement('span');
      dot.className = 'scl-dot' + (r.translated ? '' : ' scl-none');
      dot.textContent = r.translated ? 'SRT' : '—';
      dot.title = r.translated ? 'Subtitle ready to download' : 'Needs translating first';
      label.appendChild(dot);
      listEl.appendChild(label);
    }
    if (!listEl.children.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px 6px;color:#9aa3b5;';
      empty.textContent = 'No language matches that.';
      listEl.appendChild(empty);
    }
  }

  function syncChecks() {
    listEl.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.checked = keep.has(cb.dataset.code);
    });
  }

  function buildUI() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    fab = document.createElement('button');
    fab.id = 'scl-fab';
    fab.type = 'button';
    const fabText = document.createElement('span');
    fabText.textContent = '🌐 Languages';
    const fabCount = document.createElement('span');
    fabCount.className = 'scl-count';
    fab.appendChild(fabText);
    fab.appendChild(fabCount);

    panel = document.createElement('div');
    panel.id = 'scl-panel';
    panel.innerHTML = [
      '<div class="scl-head"><span>Language filter</span>',
      '<button type="button" id="scl-close" title="Close">×</button></div>',
      '<div class="scl-body">',
      '  <input type="search" id="scl-search" placeholder="Search languages…" autocomplete="off">',
      '  <label class="scl-opt"><input type="checkbox" id="scl-only"> Only languages with a subtitle</label>',
      '  <div class="scl-acts">',
      '    <button type="button" id="scl-pick">Pick listed</button>',
      '    <button type="button" id="scl-pick-srt">Pick all with SRT</button>',
      '    <button type="button" id="scl-clear">Show all</button>',
      '  </div>',
      '</div>',
      '<div id="scl-list"></div>',
      '<div class="scl-foot"></div>',
    ].join('\n');

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    listEl = panel.querySelector('#scl-list');
    searchEl = panel.querySelector('#scl-search');
    footEl = panel.querySelector('.scl-foot');
    onlyEl = panel.querySelector('#scl-only');
    onlyEl.checked = settings.onlyTranslated;

    fab.addEventListener('click', () => {
      const open = panel.classList.toggle('scl-open');
      if (open) {
        renderList();
        updateBadge(rows.filter(isVisible).length);
        searchEl.focus();
      }
    });
    panel.querySelector('#scl-close').addEventListener('click', () => {
      panel.classList.remove('scl-open');
    });
    searchEl.addEventListener('input', renderList);
    searchEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (searchEl.value) {
        searchEl.value = '';
        renderList();
      } else {
        panel.classList.remove('scl-open');
      }
    });

    onlyEl.addEventListener('change', () => {
      settings.onlyTranslated = onlyEl.checked;
      saveSettings();
      applyFilter();
    });

    // "Pick listed" adds everything the search currently shows, so you can
    // type a language, click once, and move on.
    panel.querySelector('#scl-pick').addEventListener('click', () => {
      listEl.querySelectorAll('input[type=checkbox]').forEach((cb) => keep.add(cb.dataset.code));
      settings.langs = [...keep];
      saveSettings();
      syncChecks();
      applyFilter();
    });
    panel.querySelector('#scl-pick-srt').addEventListener('click', () => {
      rows.filter((r) => r.translated).forEach((r) => keep.add(r.code));
      settings.langs = [...keep];
      saveSettings();
      syncChecks();
      applyFilter();
    });
    panel.querySelector('#scl-clear').addEventListener('click', () => {
      keep.clear();
      settings.langs = [];
      saveSettings();
      syncChecks();
      applyFilter();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') panel.classList.remove('scl-open');
    });
    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('scl-open')) return;
      if (panel.contains(e.target) || fab.contains(e.target)) return;
      panel.classList.remove('scl-open');
    });
  }

  // -------------------------------------------------------------------- boot

  function start() {
    if (!collectRows().length) return false;
    buildUI();
    applyFilter();

    // The site swaps a row's Translate button for a Download link once a
    // translation finishes, and rows can be (re)rendered late. Re-read the
    // page on changes and re-apply, so "only with a subtitle" stays honest.
    let timer = 0;
    const obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        collectRows();
        applyFilter();
        if (panel.classList.contains('scl-open')) renderList();
      }, 150);
    });
    const host = document.querySelector('.all-sub') || document.body;
    obs.observe(host, { childList: true, subtree: true });
    return true;
  }

  if (!start()) {
    // Subtitle list not in the DOM yet (or this is not a subs page): watch for
    // a little while, then give up quietly.
    const wait = new MutationObserver(() => {
      if (start()) wait.disconnect();
    });
    wait.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => wait.disconnect(), 15000);
  }
})();
