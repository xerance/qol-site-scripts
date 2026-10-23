// ==UserScript==
// @name         F95Visited
// @namespace    https://github.com/xerance/qol-site-scripts
// @version      1.1.0
// @description  Highlight visited games + "last viewed" timestamp on F95zone's Latest Updates (SAM), and flag games that have a new version since you last viewed them.
// @author       xerance
// @match        https://f95zone.to/sam/*
// @match        https://f95zone.to/threads/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    /*───────────────────────────────────────────────────────────────────────╗
    │  Settings                                                                │
    ╚───────────────────────────────────────────────────────────────────────*/
    const FADE_FILTER  = 'grayscale(0.75) brightness(0.45)'; // how much visited covers are dimmed
    const HOVER_FILTER = 'grayscale(0.15) brightness(0.9)';  // eased back on hover so you can look
    const BADGE_BG     = 'rgba(2, 129, 255, 0.9)';
    const UPDATE_BG    = 'rgba(255, 140, 0, 0.97)';
    const STORAGE_KEY  = 'f95-visited';

    /*───────────────────────────────────────────────────────────────────────╗
    │  Storage — { threadId: { t: lastViewed, v: versionSeen } } in            │
    │  localStorage (single domain, purely client-side).                       │
    ╚───────────────────────────────────────────────────────────────────────*/
    function load() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
        catch (e) { return {}; }
    }
    function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
    let store = load();

    /*───────────────────────────────────────────────────────────────────────╗
    │  Helpers                                                                 │
    ╚───────────────────────────────────────────────────────────────────────*/
    const isSam    = /^\/sam\//.test(location.pathname);
    const isThread = /^\/threads\//.test(location.pathname);

    // Thread id from both "/threads/281153/" and "/threads/some-slug.281153/".
    function idFromHref(href) {
        const m = (href || '').match(/\/threads\/(?:[^/]*\.)?(\d+)/);
        return m ? m[1] : null;
    }
    const normVer = s => String(s || '').trim().toLowerCase();

    // Pull a version string out of a thread page title, e.g.
    // "Unity - Office Party [v0.1.3060] [Eek! Games]" → "v0.1.3060".
    function versionFromTitle(title) {
        const brackets = [...String(title).matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
        const v = brackets.find(b => /\d/.test(b) && /v?\s*\d/i.test(b));
        return v ? normVer(v) : '';
    }

    function relTime(then) {
        const s = Math.round((Date.now() - then) / 1000);
        if (s < 60) return 'just now';
        const m = Math.round(s / 60); if (m < 60) return m + 'm';
        const h = Math.round(m / 60); if (h < 24) return h + 'h';
        const d = Math.round(h / 24); if (d < 30) return d + 'd';
        const mo = Math.round(d / 30); if (mo < 12) return mo + 'mo';
        return Math.round(mo / 12) + 'y';
    }
    const fullTime = then => new Date(then).toLocaleString();

    /*───────────────────────────────────────────────────────────────────────╗
    │  Recording a visit                                                       │
    ╚───────────────────────────────────────────────────────────────────────*/
    // id + the version string to store with it (keeps an existing version if none given).
    function record(id, version) {
        if (!id) return;
        const prev = store[id] || {};
        store[id] = { t: Date.now(), v: version || prev.v || '' };
        save();
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  SAM listing — paint cards + record on click                             │
    ╚───────────────────────────────────────────────────────────────────────*/
    function cardVersion(tile) {
        return normVer(tile.querySelector('.resource-tile_label-version')?.textContent || '');
    }

    function paintSam() {
        document.querySelectorAll('.resource-tile').forEach(tile => {
            const a = tile.querySelector('a.resource-tile_link');
            if (!a) return;
            const id = idFromHref(a.getAttribute('href'));
            if (!id) return;
            const rec = store[id];
            const thumb = tile.querySelector('.resource-tile_thumb-wrap') || tile;

            if (!rec) {
                tile.classList.remove('f95-visited', 'f95-updated');
                thumb.querySelectorAll(':scope > .f95-badge, :scope > .f95-update').forEach(e => e.remove());
                return;
            }

            tile.classList.add('f95-visited');
            if (getComputedStyle(thumb).position === 'static') thumb.style.position = 'relative';

            let badge = thumb.querySelector(':scope > .f95-badge');
            if (!badge) { badge = document.createElement('div'); badge.className = 'f95-badge'; thumb.appendChild(badge); }
            badge.textContent = '👁 ' + relTime(rec.t);
            badge.title = 'Last viewed ' + fullTime(rec.t);

            // "UPDATE" when the card's current version differs from the one you saw.
            const cur = cardVersion(tile);
            const updated = rec.v && cur && rec.v !== cur;
            let ub = thumb.querySelector(':scope > .f95-update');
            if (updated) {
                if (!ub) { ub = document.createElement('div'); ub.className = 'f95-update'; thumb.appendChild(ub); }
                ub.textContent = '⬆ UPDATE';
                ub.title = 'Updated since your last view: ' + rec.v + ' → ' + cur;
                tile.classList.add('f95-updated');
            } else {
                if (ub) ub.remove();
                tile.classList.remove('f95-updated');
            }
        });
    }

    function onCardClick(e) {
        if (e.button === 2) return; // ignore right-click
        const a = e.target.closest && e.target.closest('a.resource-tile_link');
        if (!a) return;
        const id = idFromHref(a.getAttribute('href'));
        if (!id) return;
        const tile = a.closest('.resource-tile');
        record(id, tile ? cardVersion(tile) : '');
        paintSam();
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Styles (SAM only)                                                       │
    ╚───────────────────────────────────────────────────────────────────────*/
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Fade seen games so unseen ones pop; ease back on hover to look.
               !important because the site sets its own filter on the thumb. */
            .f95-visited .resource-tile_thumb { filter:${FADE_FILTER} !important; transition:filter .15s ease; }
            .f95-visited:hover .resource-tile_thumb { filter:${HOVER_FILTER} !important; }
            /* Updated games stay full colour + get an orange ring, so they stand out. */
            .f95-updated .resource-tile_thumb { filter:none !important; }
            .f95-updated .resource-tile_thumb-wrap { box-shadow: inset 0 0 0 3px ${UPDATE_BG}; }

            .f95-badge { position:absolute; top:6px; left:6px; z-index:2; pointer-events:none;
                background:${BADGE_BG}; color:#fff; font:600 11px/1 system-ui,sans-serif;
                padding:4px 7px; border-radius:4px; white-space:nowrap; box-shadow:0 1px 4px rgba(0,0,0,.5); }
            .f95-update { position:absolute; top:6px; right:6px; z-index:2; pointer-events:none;
                background:${UPDATE_BG}; color:#111; font:800 10px/1 system-ui,sans-serif;
                padding:4px 7px; border-radius:4px; white-space:nowrap; letter-spacing:.03em;
                box-shadow:0 1px 4px rgba(0,0,0,.5); }
        `;
        document.head.appendChild(style);
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Boot                                                                    │
    ╚───────────────────────────────────────────────────────────────────────*/
    if (isThread) {
        // Record a visit whenever you land on a thread page (opened from anywhere).
        record(idFromHref(location.pathname), versionFromTitle(document.title));
    }

    if (isSam) {
        injectStyles();
        document.addEventListener('click', onCardClick, true);
        document.addEventListener('auxclick', onCardClick, true);

        // Cross-tab sync: a thread opened in another tab records there; repaint here.
        window.addEventListener('storage', e => { if (e.key === STORAGE_KEY) { store = load(); paintSam(); } });

        // SPA keep-up: the grid re-renders on page/filter changes with no reload.
        let pending = null;
        new MutationObserver(() => {
            if (pending) return;
            pending = setTimeout(() => { pending = null; paintSam(); }, 150);
        }).observe(document.documentElement, { childList: true, subtree: true });

        // Refresh relative times + pick up cross-tab writes periodically.
        setInterval(() => { store = load(); paintSam(); }, 2000);

        paintSam();
    }
})();
