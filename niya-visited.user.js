// ==UserScript==
// @name         NiyaVisited
// @namespace    https://github.com/xerance/qol-site-scripts
// @version      2.1.3
// @description  Highlight visited galleries + show a "last viewed" timestamp. Shared history across the mirrors (niyaniya.moe / shupogaki.moe); hdoujin.org tracked separately (it has its own gallery ids)
// @author       xerance
// @match        *://niyaniya.moe/*
// @match        *://hdoujin.org/*
// @match        *://shupogaki.moe/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @license      MIT
// @downloadURL https://raw.githubusercontent.com/xerance/qol-site-scripts/master/niya-visited.user.js
// @updateURL   https://raw.githubusercontent.com/xerance/qol-site-scripts/master/niya-visited.user.js
// ==/UserScript==

(function () {
    'use strict';

    /*───────────────────────────────────────────────────────────────────────╗
    │  Settings — tweak these if you want a different look.                    │
    ╚───────────────────────────────────────────────────────────────────────*/
    const HIGHLIGHT = 'rgba(2, 129, 255, 0.20)'; // tint drawn over visited cards
    const BADGE_BG   = 'rgba(2, 129, 255, 0.85)'; // background of the timestamp pill
    const BADGE_FG   = '#ffffff';                 // text color of the timestamp pill
    const STORAGE_KEY = 'niya-visited';           // key holding the data

    /*───────────────────────────────────────────────────────────────────────╗
    │  Site groups — which domains share gallery ids.                          │
    │    • niyaniya.moe and shupogaki.moe are true mirrors: same backend, so   │
    │      a gallery has the SAME id on both → they share history.             │
    │    • hdoujin.org uses its OWN separate ids → tracked independently.      │
    │  We keep ONE shared store (nice for backup) but tag each saved id with   │
    │  its group ("ny" or "hd"), e.g. "ny:27442", so the groups never mix.     │
    ╚───────────────────────────────────────────────────────────────────────*/
    const GROUP = location.hostname.includes('hdoujin') ? 'hd' : 'ny';
    function key(id) { return GROUP + ':' + id; }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Storage — a { "group:galleryId": lastVisitedTimestamp } map kept in     │
    │  the userscript manager's OWN storage (GM_setValue/GM_getValue), not in  │
    │  a website's localStorage. That storage lives in the extension, so the   │
    │  niyaniya/shupogaki mirrors share one history; hdoujin keeps its own.    │
    ╚───────────────────────────────────────────────────────────────────────*/
    function loadStore() {
        try {
            return GM_getValue(STORAGE_KEY, {}) || {};
        } catch (e) {
            console.warn('NiyaVisited: could not read storage, starting fresh.', e);
            return {};
        }
    }

    // Record one gallery id (for the current site's group). We re-read → merge
    // → write so a write from another tab/mirror at the same moment isn't lost.
    function recordId(id) {
        const s = loadStore();
        s[key(id)] = Date.now();
        GM_setValue(STORAGE_KEY, s);
        store = s;
        applyToCards();
    }

    // One-time import of the old per-domain localStorage history (from v1.x)
    // into the shared store, tagged with THIS domain's group. Runs once per
    // domain, then clears the old data.
    function migrateLegacy() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const legacy = JSON.parse(raw) || {};
            const s = loadStore();
            let changed = false;
            for (const id in legacy) {
                const k = key(id);
                if (!s[k] || legacy[id] > s[k]) { s[k] = legacy[id]; changed = true; }
            }
            if (changed) GM_setValue(STORAGE_KEY, s);
            localStorage.removeItem(STORAGE_KEY); // imported — don't do it again
            console.log('NiyaVisited: migrated old history into shared storage.');
        } catch (e) {
            console.warn('NiyaVisited: legacy migration skipped.', e);
        }
    }

    // v2.0.0 briefly saved bare, un-grouped ids ("27442"). Re-tag any of those
    // to the mirror group ("ny:27442") so they aren't orphaned. (The mirrors
    // were the common case; a stray hdoujin id from that window is unlikely.)
    function normalizeBareKeys() {
        try {
            const s = loadStore();
            let changed = false;
            for (const k of Object.keys(s)) {
                if (/^\d+$/.test(k)) {
                    const nk = 'ny:' + k;
                    if (!s[nk] || s[k] > s[nk]) s[nk] = s[k];
                    delete s[k];
                    changed = true;
                }
            }
            if (changed) GM_setValue(STORAGE_KEY, s);
        } catch (e) {
            console.warn('NiyaVisited: key normalization skipped.', e);
        }
    }

    normalizeBareKeys();
    migrateLegacy();
    let store = loadStore();

    /*───────────────────────────────────────────────────────────────────────╗
    │  Helpers                                                                 │
    ╚───────────────────────────────────────────────────────────────────────*/

    // Pull the numeric gallery id out of a "/g/27442/7a0e3bd0700d" style href.
    function idFromHref(href) {
        const m = (href || '').match(/\/g\/(\d+)/);
        return m ? m[1] : null;
    }

    // Turn a past timestamp into a short "3h", "2d", "just now" style string.
    function relTime(then) {
        const s = Math.round((Date.now() - then) / 1000);
        if (s < 60)          return 'just now';
        const m = Math.round(s / 60);
        if (m < 60)          return m + 'm';
        const h = Math.round(m / 60);
        if (h < 24)          return h + 'h';
        const d = Math.round(h / 24);
        if (d < 30)          return d + 'd';
        const mo = Math.round(d / 30);
        if (mo < 12)         return mo + 'mo';
        return Math.round(mo / 12) + 'y';
    }

    // Full, human-readable timestamp for the badge's hover tooltip.
    function fullTime(then) {
        return new Date(then).toLocaleString();
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Record a visit — called whenever we are looking at a gallery page      │
    │  (/g/{id}/{hash}). Guarded so it only writes once per page view.        │
    ╚───────────────────────────────────────────────────────────────────────*/
    let lastRecordedPath = '';
    function recordVisit() {
        const path = location.pathname;
        if (path === lastRecordedPath) return;   // already handled this page
        const id = idFromHref(path);
        if (!id) { lastRecordedPath = path; return; }

        lastRecordedPath = path;
        recordId(id); // also repaints listings behind us (e.g. after "back")
    }

    // Are we on a gallery's own page (/g/{id}/{hash})? We still record the
    // visit there, but we don't paint highlights — the links on that page are
    // the gallery itself / related items, not a listing to mark up.
    function isGalleryPage() {
        return /^\/g\//.test(location.pathname);
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Paint the listings — add the highlight class + timestamp badge to      │
    │  every visited card, and clean up cards that are no longer visited.     │
    ╚───────────────────────────────────────────────────────────────────────*/
    function applyToCards() {
        if (isGalleryPage()) {
            // Strip any marks that may have carried over from a listing view.
            document.querySelectorAll('.niya-visited').forEach(c => c.classList.remove('niya-visited'));
            document.querySelectorAll('.niya-badge').forEach(b => b.remove());
            return;
        }
        const links = document.querySelectorAll('a[href^="/g/"]');
        for (const a of links) {
            const id = idFromHref(a.getAttribute('href'));
            if (!id) continue;

            // The <article> is the visual card; fall back to the link itself.
            const card = a.closest('article') || a;
            const ts = store[key(id)];

            if (ts) {
                card.classList.add('niya-visited');
                let badge = card.querySelector(':scope > .niya-badge');
                if (!badge) {
                    badge = document.createElement('div');
                    badge.className = 'niya-badge';
                    card.appendChild(badge);
                }
                badge.textContent = '👁 ' + relTime(ts); // 👁 3h
                badge.title = 'Last viewed ' + fullTime(ts);
            } else if (card.classList.contains('niya-visited')) {
                card.classList.remove('niya-visited');
                const badge = card.querySelector(':scope > .niya-badge');
                if (badge) badge.remove();
            }
        }
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Optimistic click tracking — mark a card the moment it's clicked, so    │
    │  the highlight is already there if you hit "back". We listen to both    │
    │  "click" (left click) and "auxclick" (middle click / open-in-new-tab), │
    │  since middle clicks never fire a plain "click" event.                  │
    ╚───────────────────────────────────────────────────────────────────────*/
    function markFromEvent(e) {
        if (e.button === 2) return; // ignore right-click
        const a = e.target.closest && e.target.closest('a[href^="/g/"]');
        if (!a) return;
        const id = idFromHref(a.getAttribute('href'));
        if (!id) return;
        recordId(id);
    }
    document.addEventListener('click', markFromEvent, true);
    document.addEventListener('auxclick', markFromEvent, true);

    /*───────────────────────────────────────────────────────────────────────╗
    │  Cross-tab / cross-mirror sync — the userscript manager notifies us     │
    │  when the shared store changes in ANY tab (even a different mirror).     │
    │  Re-read and repaint so listings update live, no reload needed.         │
    ╚───────────────────────────────────────────────────────────────────────*/
    if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(STORAGE_KEY, (name, oldValue, newValue) => {
            store = newValue || {};
            applyToCards();
        });
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Styles                                                                  │
    ╚───────────────────────────────────────────────────────────────────────*/
    const style = document.createElement('style');
    style.textContent = `
        .niya-visited { position: relative; }
        .niya-visited::after {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: inherit;
            box-shadow: inset 0 0 0 9999px ${HIGHLIGHT};
            pointer-events: none;
            z-index: 1;
        }
        .niya-badge {
            position: absolute;
            top: 6px;
            left: 32px;   /* to the right of the language flag (~20px wide at left:6) */
            z-index: 2;
            padding: 3px 6px;
            border-radius: 4px;
            background: ${BADGE_BG};
            color: ${BADGE_FG};
            font: 600 11px/1 system-ui, sans-serif;
            white-space: nowrap;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);

    /*───────────────────────────────────────────────────────────────────────╗
    │  Keep up with the SPA — the site swaps content in without reloading.    │
    │  A debounced observer repaints cards as they appear/scroll in, and a    │
    │  light interval both catches navigations and refreshes relative times.  │
    ╚───────────────────────────────────────────────────────────────────────*/
    let pending = null;
    function scheduleApply() {
        if (pending) return;
        pending = setTimeout(() => {
            pending = null;
            recordVisit();
            applyToCards();
        }, 150);
    }

    new MutationObserver(scheduleApply).observe(document.documentElement, {
        childList: true,
        subtree: true,
    });

    // URL-change watcher + timestamp refresher (relative times drift over time).
    // Also re-reads the store each tick as a safety net for cross-tab updates
    // (in case the manager doesn't support GM_addValueChangeListener).
    let lastPath = location.pathname;
    setInterval(() => {
        if (location.pathname !== lastPath) {
            lastPath = location.pathname;
            recordVisit();
        }
        store = loadStore();
        applyToCards();
    }, 1000);

    // First run.
    recordVisit();
    applyToCards();
})();
