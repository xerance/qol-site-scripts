// ==UserScript==
// @name         CumstVisited
// @namespace    https://github.com/xerance/qol-site-scripts
// @version      1.0.0
// @description  cum.st (OnlyHaven): fade posts, DMs and creators you've already opened and show a "last viewed" timestamp on each, so unseen ones pop out of the grid.
// @author       xerance
// @match        *://cum.st/*
// @match        *://*.cum.st/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    /*───────────────────────────────────────────────────────────────────────╗
    │  Settings — tweak these if you want a different look.                    │
    ╚───────────────────────────────────────────────────────────────────────*/
    const FADE_FILTER    = 'grayscale(0.75) brightness(0.45)'; // visited post/DM thumbnails
    const HOVER_FILTER   = 'grayscale(0.15) brightness(0.9)';  // eased back on hover so you can look
    const ROW_OPACITY    = 0.5;  // visited creator rows (text-heavy, so opacity reads better)
    const ROW_HOVER      = 0.9;
    const BADGE_BG       = 'rgba(1, 173, 238, 0.9)'; // the site's own accent blue
    const BADGE_FG       = '#ffffff';
    const TRACK_CREATORS = true; // set false to track only posts/DMs, not creator profiles
    const STORAGE_KEY    = 'cumst-visited';

    /*───────────────────────────────────────────────────────────────────────╗
    │  Storage — a { "kind:platform:id": lastVisitedTimestamp } map.           │
    │                                                                          │
    │  Kept in the userscript manager's OWN storage (GM_setValue/GM_getValue)  │
    │  when available, so the history survives the site clearing its storage   │
    │  and is shared across cum.st subdomains. Falls back to localStorage if   │
    │  the script is installed without the GM grants.                          │
    ╚───────────────────────────────────────────────────────────────────────*/
    const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

    function loadStore() {
        try {
            if (hasGM) return GM_getValue(STORAGE_KEY, {}) || {};
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        } catch (e) {
            console.warn('CumstVisited: could not read storage, starting fresh.', e);
            return {};
        }
    }

    function writeStore(s) {
        try {
            if (hasGM) GM_setValue(STORAGE_KEY, s);
            else localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
        } catch (e) {
            console.warn('CumstVisited: could not write storage.', e);
        }
    }

    let store = loadStore();

    // Re-read -> merge -> write, so a write from another tab at the same moment
    // isn't clobbered.
    function record(key) {
        if (!key) return;
        const s = loadStore();
        s[key] = Date.now();
        writeStore(s);
        store = s;
        paint();
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Keys — everything tracked lives under /creators/… :                     │
    │    /creators/{platform}/{creatorId}               -> creator:onlyfans:32696630
    │    /creators/{platform}/{creatorId}/post/{postId} -> post:onlyfans:2870973120
    │    /creators/{platform}/{creatorId}/dm/{uuid}     -> dm:onlyfans:a4753473-…
    │                                                                          │
    │  Post/DM ids are already unique, so they're keyed without the creator —  │
    │  the same post stays marked wherever it shows up (/posts, a creator      │
    │  page, a tag listing, search results).                                   │
    │                                                                          │
    │  The creator id must be numeric, which keeps the nav links (/creators/   │
    │  recent, /creators/tags, /creators/random) out of the regex.             │
    ╚───────────────────────────────────────────────────────────────────────*/
    const PATH_RE = /\/creators\/([a-z0-9]+)\/(\d+)(?:\/(post|dm)\/([\w-]+))?(?:[/?#]|$)/i;

    function keyFromHref(href) {
        const m = PATH_RE.exec(String(href || ''));
        if (!m) return null;
        const platform = m[1].toLowerCase();
        if (m[3]) return m[3].toLowerCase() + ':' + platform + ':' + m[4];
        return TRACK_CREATORS ? 'creator:' + platform + ':' + m[2] : null;
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Helpers                                                                 │
    ╚───────────────────────────────────────────────────────────────────────*/

    // Turn a past timestamp into a short "3h", "2d", "just now" style string.
    function relTime(then) {
        const s = Math.round((Date.now() - then) / 1000);
        if (s < 60) return 'just now';
        const m = Math.round(s / 60);
        if (m < 60) return m + 'm';
        const h = Math.round(m / 60);
        if (h < 24) return h + 'h';
        const d = Math.round(h / 24);
        if (d < 30) return d + 'd';
        const mo = Math.round(d / 30);
        if (mo < 12) return mo + 'mo';
        return Math.round(mo / 12) + 'y';
    }

    const fullTime = then => new Date(then).toLocaleString();

    /*───────────────────────────────────────────────────────────────────────╗
    │  Painting the listings                                                   │
    │                                                                          │
    │  Both listing shapes are plain <a> cards that already have their own     │
    │  `position: relative`, so the badge can simply be appended to them:      │
    │    • a.cv-cell — the 3:4 post / DM thumbnails (grid)                     │
    │    • a.cv-row  — the 3:1 creator rows (list)                             │
    │  The selector also accepts any other link to a tracked URL, so cards     │
    │  the site renders differently elsewhere still get marked.                │
    ╚───────────────────────────────────────────────────────────────────────*/
    const CARD_SEL = 'a.cv-cell[href], a.cv-row[href], a[href*="/post/"], a[href*="/dm/"]';

    function paint() {
        document.querySelectorAll(CARD_SEL).forEach(a => {
            const key = keyFromHref(a.getAttribute('href'));
            // Only mark real cards: a bare text link (a creator name inside a
            // paragraph, say) has no thumbnail, and a badge would land on text.
            if (!key || (!a.querySelector('img') && !a.classList.contains('cv-cell'))) {
                clear(a);
                return;
            }

            const ts = store[key];
            if (!ts) { clear(a); return; }

            a.classList.add('cumst-visited');
            a.classList.toggle('cumst-visited-row', a.classList.contains('cv-row'));

            let badge = a.querySelector(':scope > .cumst-badge');
            if (!badge) {
                badge = document.createElement('div');
                badge.className = 'cumst-badge';
                a.appendChild(badge);
            }
            // Only write when the text actually changes — otherwise every paint
            // mutates the DOM, which wakes the observer below, forever.
            const label = '\u{1F441} ' + relTime(ts);
            if (badge.textContent !== label) badge.textContent = label;
            const title = 'Last viewed ' + fullTime(ts);
            if (badge.title !== title) badge.title = title;
        });
    }

    function clear(a) {
        if (!a.classList.contains('cumst-visited')) return;
        a.classList.remove('cumst-visited', 'cumst-visited-row');
        const badge = a.querySelector(':scope > .cumst-badge');
        if (badge) badge.remove();
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Recording a visit                                                       │
    │                                                                          │
    │  Two ways, so something is marked however you got to it:                 │
    │   1. optimistically on click — the mark is already there when you come   │
    │      back, and it covers new tabs (middle / ctrl-click);                 │
    │   2. on landing on a post / DM / creator page, including the site's      │
    │      in-page (SPA) navigation and links opened from outside the site.    │
    ╚───────────────────────────────────────────────────────────────────────*/
    function onCardClick(e) {
        if (e.button === 2) return; // ignore right-click
        const a = e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        record(keyFromHref(a.getAttribute('href')));
    }

    let lastRecordedPath = '';
    function recordVisit() {
        const path = location.pathname;
        if (path === lastRecordedPath) return; // already handled this page view
        lastRecordedPath = path;
        record(keyFromHref(path));
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Styles                                                                  │
    ╚───────────────────────────────────────────────────────────────────────*/
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Post / DM thumbnails: dim + desaturate, eased back on hover. The
               filter sits on the <img> so the site's own gradient overlay and
               caption stay readable. */
            a.cumst-visited img { filter: ${FADE_FILTER}; transition: filter .15s ease; }
            a.cumst-visited:hover img { filter: ${HOVER_FILTER}; }

            /* Creator rows are mostly text over a header image, so fade the
               whole row instead of filtering its pictures. */
            a.cumst-visited-row { opacity: ${ROW_OPACITY}; transition: opacity .15s ease; }
            a.cumst-visited-row:hover { opacity: ${ROW_HOVER}; }
            a.cumst-visited-row img { filter: none; }

            /* Top-RIGHT: the site puts its own platform badge (OnlyFans /
               Fansly) at the top-left of every card. */
            .cumst-badge {
                position: absolute;
                top: 6px;
                right: 6px;
                z-index: 3;
                padding: 3px 6px;
                border-radius: 4px;
                background: ${BADGE_BG};
                color: ${BADGE_FG};
                font: 600 11px/1 system-ui, sans-serif;
                white-space: nowrap;
                pointer-events: none;
                box-shadow: 0 1px 4px rgba(0, 0, 0, .5);
            }
        `;
        document.head.appendChild(style);
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Cross-tab sync — posts open in new tabs a lot here, so pick up writes   │
    │  from other tabs and repaint without a reload.                           │
    ╚───────────────────────────────────────────────────────────────────────*/
    if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(STORAGE_KEY, (name, oldValue, newValue) => {
            store = newValue || {};
            paint();
        });
    }
    window.addEventListener('storage', e => {
        if (e.key === STORAGE_KEY) { store = loadStore(); paint(); }
    });

    /*───────────────────────────────────────────────────────────────────────╗
    │  Boot + keeping up with the SPA                                          │
    │                                                                          │
    │  The site is a Svelte app: the grid is swapped in on paging, filtering   │
    │  and navigation with no reload, and it re-renders cards (dropping our    │
    │  badges) as you go. A debounced observer repaints them, and a light      │
    │  interval catches navigations and refreshes the relative times.          │
    ╚───────────────────────────────────────────────────────────────────────*/
    injectStyles();
    document.addEventListener('click', onCardClick, true);
    document.addEventListener('auxclick', onCardClick, true);

    let pending = null;
    new MutationObserver(() => {
        if (pending) return;
        pending = setTimeout(() => { pending = null; recordVisit(); paint(); }, 150);
    }).observe(document.documentElement, { childList: true, subtree: true });

    let lastPath = location.pathname;
    setInterval(() => {
        if (location.pathname !== lastPath) { lastPath = location.pathname; recordVisit(); }
        store = loadStore();
        paint();
    }, 1000);

    recordVisit();
    paint();
})();
