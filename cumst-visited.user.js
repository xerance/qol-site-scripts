// ==UserScript==
// @name         CumstVisited
// @namespace    https://github.com/xerance/qol-site-scripts
// @version      1.3.4
// @description  cum.st (OnlyHaven): fade posts, DMs and creators you've already opened and show a "last viewed" timestamp on each, so unseen ones pop out of the grid. A button in the site's toolbar (or Alt+V) hides visited cards entirely.
// @author       xerance
// @match        *://cum.st/*
// @match        *://*.cum.st/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @license      MIT
// @downloadURL https://raw.githubusercontent.com/xerance/qol-site-scripts/master/cumst-visited.user.js
// @updateURL   https://raw.githubusercontent.com/xerance/qol-site-scripts/master/cumst-visited.user.js
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
    const BADGE_PUSH     = '23px'; // how far the site's own top-right badges (video
                                   // duration, quality) slide down on a visited card:
                                   // the badge's 17px height plus a 6px gap
    const TRACK_CREATORS = true; // set false to track only posts/DMs, not creator profiles
    const HIDE_KEY       = 'v';  // Alt + this key hides/shows visited cards ('' disables it)
    const SHOW_BUTTON    = true; // the hide/show button (the shortcut works either way)
    const BUTTON_IN_BAR  = true; // sit in the site's own toolbar; false = floating corner pill
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
        // The site runs a popunder ad script, and those re-dispatch clicks of
        // their own. Only a click the user actually made counts as a visit.
        if (e.isTrusted === false) return;
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
    │  The button. It sits in the site's own toolbar, next to Filters, and    │
    │  is re-homed whenever Svelte rebuilds that toolbar underneath it (which │
    │  happens on every page and filter change). It borrows the site's theme  │
    │  tokens, so it matches in both light and dark.                          │
    │                                                                          │
    │  Its label says what a click will DO, and carries the number of visited │
    │  cards on the page. With nothing visited here and nothing hidden, there │
    │  is nothing to toggle, so it stays out of the way.                      │
    ╚───────────────────────────────────────────────────────────────────────*/
    let btn = null, btnText = null;

    // The site's own sticky toolbar, `div#grid-controls`, wrapping a `flex
    // gap-2` row that holds whatever controls the listing has: a search box and
    // Filters on /posts and /creators, a Day/Week/Month segment and Filters on
    // /posts/popular. The id is the reliable anchor — an earlier version looked
    // for a sticky bar containing an <input>, which missed every listing with
    // no search box. That search is kept as a fallback, and accepts a row of
    // buttons too, in case the id ever changes.
    function toolbarSlot() {
        if (!BUTTON_IN_BAR) return null;
        const byId = document.querySelector('div#grid-controls > div.flex.gap-2');
        if (byId) return byId;
        for (const bar of document.querySelectorAll('div.sticky.top-0')) {
            const row = bar.querySelector('div.flex.gap-2');
            if (row && row.querySelector('input, button')) return row;
        }
        return null;
    }

    function updateButton(visitedHere) {
        if (!SHOW_BUTTON || !document.body) return;
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cumst-toggle';
            const eye = document.createElement('span');
            eye.className = 'cumst-toggle-eye';
            eye.textContent = '\u{1F441}';
            btnText = document.createElement('span');
            btnText.className = 'cumst-toggle-text';
            btn.append(eye, btnText);
            btn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                // Same reason as onCardClick: the ad script's own synthetic
                // clicks shouldn't flip the toggle behind your back.
                if (e.isTrusted === false) return;
                toggleHide(false);
            });
        }

        // Svelte rebuilds the toolbar on every page and filter change, which
        // throws the button out with it — so re-home it whenever it's adrift.
        // Without a toolbar (an unexpected layout) it falls back to a floating
        // corner pill rather than disappearing.
        const slot = toolbarSlot();
        const parent = slot || document.body;
        if (btn.parentElement !== parent) parent.appendChild(btn);
        btn.classList.toggle('cumst-toggle-float', !slot);

        const useful = hideVisited || visitedHere > 0;
        if (btn.hidden !== !useful) btn.hidden = !useful;
        if (!useful) return;

        const label = (hideVisited ? 'Show visited' : 'Hide visited') +
                      (visitedHere ? ' (' + visitedHere + ')' : '');
        // Same idempotence rule as the badges: only write on a real change,
        // or every paint wakes the observer that triggered it.
        if (btnText.textContent !== label) btnText.textContent = label;
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
               Fansly) at the top-left of every card, so the right corner is
               the free one — except on video cards, where the site stacks its
               duration (and quality) badges there in an absolutely positioned
               flex column. On a visited card that stack slides down by the
               badge's height plus a gap, so the two read as one column instead
               of sitting on top of each other. The selector leans on the
               layout classes (absolute, flex column, right-aligned) rather
               than Tailwind's arbitrary spacing values, and pushes with
               margin-top so the site's own 'top' is left alone. */
            a.cumst-visited > div.absolute.flex.flex-col.items-end {
                margin-top: ${BADGE_PUSH};
            }

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
            /* Built out of the site's own theme tokens (--input, --foreground,
               --radius, --primary) so it matches the Filters button it sits
               next to, in light and dark alike. The fallbacks are the dark
               values, used only if the site ever drops a token. */
            .cumst-toggle {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                align-self: stretch;
                flex: none;
                margin: 0;
                padding: 0 10px;
                border: 1px solid var(--input, rgba(255, 255, 255, .15));
                border-radius: var(--radius, 10px);
                background: var(--background, #fff);
                color: var(--foreground, #fff);
                font-family: inherit;
                font-size: 14px;
                font-weight: 500;
                line-height: 20px;
                white-space: nowrap;
                cursor: pointer;
                transition: background .15s ease, border-color .15s ease;
            }
            .cumst-toggle-eye { font-size: 13px; line-height: 1; }
            .cumst-toggle:hover { background: color-mix(in oklab, var(--foreground, #000) 8%, var(--background, #fff)); }
            /* In dark mode the site's buttons aren't the page background —
               they're a 4.5% white wash over it, so match that instead. */
            html.dark .cumst-toggle { background: color-mix(in oklab, #fff 4.5%, transparent); }
            html.dark .cumst-toggle:hover { background: color-mix(in oklab, #fff 10%, transparent); }
            /* Pressed state: the site's accent, so "hiding is on" reads at a
               glance. Restated under html.dark so it isn't out-specified by
               the dark background rules above. */
            .cumst-toggle-on,
            html.dark .cumst-toggle-on {
                background: var(--primary, ${BADGE_BG});
                border-color: var(--primary, ${BADGE_BG});
                color: #fff;
            }
            .cumst-toggle-on:hover,
            html.dark .cumst-toggle-on:hover {
                background: var(--primary, ${BADGE_BG});
                filter: brightness(1.12);
            }
            /* Narrow screens: the toolbar row is tight, so keep just the eye. */
            @media (max-width: 560px) { .cumst-toggle-text { display: none; } }

            /* Fallback when no toolbar is found: a floating corner pill. */
            .cumst-toggle-float {
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: 2147483646;
                align-self: auto;
                padding: 8px 12px;
                border-radius: 999px;
                box-shadow: 0 2px 10px rgba(0, 0, 0, .45);
                backdrop-filter: blur(6px);
            }
            /* The dark-mode rule above is more specific than a lone
               .cumst-toggle-float, so the overlay restates it to win on order. */
            .cumst-toggle-float,
            html.dark .cumst-toggle-float {
                background: rgba(20, 20, 24, .82);
                color: #fff;
            }
            .cumst-toggle-float.cumst-toggle-on { background: var(--primary, ${BADGE_BG}); }
            /* display:inline-flex would otherwise beat the hidden attribute. */
            .cumst-toggle[hidden] { display: none !important; }

            /* Only ever shown when the button isn't, so the two can't collide. */
            .cumst-toast {
                position: fixed;
                right: 16px;
                bottom: 16px;
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
