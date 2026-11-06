// ==UserScript==
// @name         CumstVisited
// @namespace    https://github.com/xerance/qol-site-scripts
// @version      1.2.0
// @description  cum.st (OnlyHaven): fade posts, DMs and creators you've already opened and show a "last viewed" timestamp on each, so unseen ones pop out of the grid. A floating button (or Alt+V) hides visited cards entirely.
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
    const HIDE_KEY       = 'v';  // Alt + this key hides/shows visited cards ('' disables it)
    const SHOW_BUTTON    = true; // the floating hide/show button (the shortcut works either way)
    const STORAGE_KEY    = 'cumst-visited';
    const HIDE_STATE_KEY = 'cumst-visited-hide'; // remembers the hide toggle between pages

    /*───────────────────────────────────────────────────────────────────────╗
    │  Storage — a { "kind:platform:id": lastVisitedTimestamp } map.           │
    │                                                                          │
    │  Kept in the userscript manager's OWN storage (GM_setValue/GM_getValue)  │
    │  when available, so the history survives the site clearing its storage   │
    │  and is shared across cum.st subdomains. Falls back to localStorage if   │
    │  the script is installed without the GM grants.                          │
    ╚───────────────────────────────────────────────────────────────────────*/
    const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

    function read(key, fallback) {
        try {
            if (hasGM) {
                const v = GM_getValue(key, fallback);
                return v === undefined || v === null ? fallback : v;
            }
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (e) {
            console.warn('CumstVisited: could not read storage, using the default.', e);
            return fallback;
        }
    }

    function write(key, value) {
        try {
            if (hasGM) GM_setValue(key, value);
            else localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.warn('CumstVisited: could not write storage.', e);
        }
    }

    const loadStore = () => read(STORAGE_KEY, {}) || {};
    const writeStore = s => write(STORAGE_KEY, s);

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
        let visitedHere = 0;
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

            visitedHere++;
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
        updateButton(visitedHere);
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
    │  "Hide visited" toggle — Alt+V collapses every visited card out of the  │
    │  listing, leaving only what you haven't opened. The state is remembered │
    │  (and shared across tabs), so it survives paging and navigation.        │
    │                                                                          │
    │  It's a plain CSS class on <html>, so hiding and showing costs nothing  │
    │  and doesn't need a repaint.                                            │
    ╚───────────────────────────────────────────────────────────────────────*/
    let hideVisited = read(HIDE_STATE_KEY, false) === true;

    function applyHide() {
        document.documentElement.classList.toggle('cumst-hide-visited', hideVisited);
    }

    function toggleHide(fromKeyboard) {
        hideVisited = !hideVisited;
        write(HIDE_STATE_KEY, hideVisited);
        applyHide();
        paint(); // refresh the button's label and count
        // The button shows the new state itself, so only the shortcut needs a
        // toast — and only when the button isn't there to answer for it.
        if (fromKeyboard && (!btn || btn.hidden)) {
            toast(hideVisited ? 'Visited hidden' : 'Visited shown');
        }
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  The floating button. It's parked in the bottom-right corner rather     │
    │  than wedged into the site's own toolbar, which is a Svelte component   │
    │  that re-renders (and would throw the button away) on every page and    │
    │  filter change.                                                         │
    │                                                                          │
    │  Its label says what a click will DO, and carries the number of visited │
    │  cards on the page. With nothing visited here and nothing hidden, there │
    │  is nothing to toggle, so it stays out of the way.                      │
    ╚───────────────────────────────────────────────────────────────────────*/
    let btn = null;

    function updateButton(visitedHere) {
        if (!SHOW_BUTTON || !document.body) return;
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cumst-toggle';
            btn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                toggleHide(false);
            });
            document.body.appendChild(btn);
        }

        const useful = hideVisited || visitedHere > 0;
        if (btn.hidden !== !useful) btn.hidden = !useful;
        if (!useful) return;

        const label = (hideVisited ? 'Show visited' : 'Hide visited') +
                      (visitedHere ? ' (' + visitedHere + ')' : '');
        // Same idempotence rule as the badges: only write on a real change,
        // or every paint wakes the observer that triggered it.
        if (btn.textContent !== label) btn.textContent = label;
        const pressed = hideVisited ? 'true' : 'false';
        if (btn.getAttribute('aria-pressed') !== pressed) btn.setAttribute('aria-pressed', pressed);
        btn.classList.toggle('cumst-toggle-on', hideVisited);
        const tip = (hideVisited ? 'Show the cards you\'ve already opened' : 'Hide the cards you\'ve already opened') +
                    (HIDE_KEY ? ' (Alt+' + HIDE_KEY.toUpperCase() + ')' : '');
        if (btn.title !== tip) btn.title = tip;
    }

    // Brief confirmation, so the shortcut isn't a silent no-op when a listing
    // happens to have nothing visited in it.
    let toastEl = null, toastTimer = null;
    function toast(text) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.className = 'cumst-toast';
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = text;
        toastEl.classList.add('cumst-toast-on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('cumst-toast-on'), 1400);
    }

    function onKeyDown(e) {
        if (!HIDE_KEY || !e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key.toLowerCase() !== HIDE_KEY.toLowerCase()) return;
        // Don't steal the key while you're typing in the search box.
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        e.preventDefault();
        toggleHide(true);
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

            /* Alt+V: drop visited cards out of the listing entirely. The grid
               and the row list both reflow on their own. */
            html.cumst-hide-visited a.cumst-visited { display: none !important; }

            /* The floating hide/show button. Pinned bottom-right, above the
               toast, and above the site's own overlays. */
            .cumst-toggle {
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: 2147483646;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                margin: 0;
                padding: 8px 12px;
                border: 1px solid rgba(255, 255, 255, .18);
                border-radius: 999px;
                background: rgba(20, 20, 24, .82);
                color: #fff;
                font: 600 12px/1 system-ui, sans-serif;
                cursor: pointer;
                backdrop-filter: blur(6px);
                box-shadow: 0 2px 10px rgba(0, 0, 0, .45);
                transition: background .15s ease, border-color .15s ease, transform .1s ease;
            }
            .cumst-toggle::before { content: '\\1F441 '; font-size: 13px; line-height: 1; }
            .cumst-toggle:hover { background: rgba(32, 32, 38, .92); border-color: rgba(255, 255, 255, .3); }
            .cumst-toggle:active { transform: translateY(1px); }
            /* Pressed state: the site's accent, so "hiding is on" reads at a glance. */
            .cumst-toggle-on {
                background: ${BADGE_BG};
                border-color: ${BADGE_BG};
                color: ${BADGE_FG};
            }
            .cumst-toggle-on:hover { background: ${BADGE_BG}; filter: brightness(1.1); }
            /* display:inline-flex would otherwise beat the hidden attribute. */
            .cumst-toggle[hidden] { display: none !important; }

            .cumst-toast {
                position: fixed;
                right: 16px;
                bottom: 64px;
                z-index: 2147483647;
                padding: 8px 12px;
                border-radius: 6px;
                background: ${BADGE_BG};
                color: ${BADGE_FG};
                font: 600 12px/1 system-ui, sans-serif;
                pointer-events: none;
                opacity: 0;
                transform: translateY(6px);
                transition: opacity .15s ease, transform .15s ease;
                box-shadow: 0 2px 10px rgba(0, 0, 0, .5);
            }
            .cumst-toast-on { opacity: 1; transform: translateY(0); }
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
        GM_addValueChangeListener(HIDE_STATE_KEY, (name, oldValue, newValue) => {
            hideVisited = newValue === true;
            applyHide();
        });
    }
    window.addEventListener('storage', e => {
        if (e.key === STORAGE_KEY) { store = loadStore(); paint(); }
        if (e.key === HIDE_STATE_KEY) { hideVisited = read(HIDE_STATE_KEY, false) === true; applyHide(); }
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
    applyHide();
    document.addEventListener('click', onCardClick, true);
    document.addEventListener('auxclick', onCardClick, true);
    document.addEventListener('keydown', onKeyDown, true);

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
