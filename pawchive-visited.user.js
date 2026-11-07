// ==UserScript==
// @name         PawchiveVisited
// @namespace    https://github.com/xerance/qol-site-scripts
// @version      1.0.1
// @description  pawchive.pw: fade posts and creators you've already opened and show a "last viewed" timestamp on each, so unseen ones pop out of the grid. A button above the listing (or Alt+V) hides visited cards entirely.
// @author       xerance
// @match        *://pawchive.pw/*
// @match        *://*.pawchive.pw/*
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
    const FADE_FILTER    = 'grayscale(0.75) brightness(0.45)'; // visited post thumbnails
    const HOVER_FILTER   = 'grayscale(0.15) brightness(0.9)';  // eased back on hover so you can look
    const DIM_TITLE      = 0.55; // a visited post card's title/footer text
    const USER_OPACITY   = 0.45; // visited creator cards (a banner behind text, so opacity reads better)
    const USER_HOVER     = 0.9;
    const BADGE_BG       = 'rgba(32, 139, 207, 0.92)';
    const BADGE_FG       = '#ffffff';
    const TRACK_CREATORS = true; // set false to track only posts, not creator pages
    const HIDE_KEY       = 'v';  // Alt + this key hides/shows visited cards ('' disables it)
    const SHOW_BUTTON    = true; // the hide/show button (the shortcut works either way)
    const BUTTON_IN_BAR  = true; // sit above the listing; false = floating corner pill
    const STORAGE_KEY    = 'pawchive-visited';
    const HIDE_STATE_KEY = 'pawchive-visited-hide'; // remembers the hide toggle between pages

    /*───────────────────────────────────────────────────────────────────────╗
    │  Storage — a { "kind:service:id": lastVisitedTimestamp } map.            │
    │                                                                          │
    │  Kept in the userscript manager's OWN storage (GM_setValue/GM_getValue)  │
    │  when available, so the history survives the site clearing its storage,  │
    │  and falls back to localStorage without the GM grants.                   │
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
            console.warn('PawchiveVisited: could not read storage, using the default.', e);
            return fallback;
        }
    }

    function write(key, value) {
        try {
            if (hasGM) GM_setValue(key, value);
            else localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.warn('PawchiveVisited: could not write storage.', e);
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
    │  Keys — everything tracked lives under /{service}/user/… :               │
    │    /patreon/user/22721799              -> creator:patreon:22721799       │
    │    /patreon/user/22721799/post/1746785 -> post:patreon:1746785           │
    │                                                                          │
    │  A post is keyed WITHOUT its creator id: the id is already unique within │
    │  a service, so the same post stays marked wherever it turns up (/posts,  │
    │  /posts/popular, the creator's own page, a tag listing, search results). │
    │                                                                          │
    │  Anchoring at the start of the path keeps the site's own pages (/posts,  │
    │  /artists, /favorites, /importer…) out of it, and user ids are matched   │
    │  loosely because they're numeric on Patreon/Fanbox but not everywhere.   │
    ╚───────────────────────────────────────────────────────────────────────*/
    const PATH_RE = /^\/([a-z0-9_-]+)\/user\/([^/?#]+)(?:\/post\/([^/?#]+))?\/?$/i;

    // Normalise an href to a same-site path, so an absolute link to pawchive
    // works and a link off-site (patreon.com, the Telegram group) is ignored.
    function pathOf(href) {
        try {
            const u = new URL(String(href || ''), location.href);
            return u.hostname === location.hostname ? u.pathname : null;
        } catch (e) {
            return null;
        }
    }

    function keyFromHref(href) {
        const path = pathOf(href);
        if (!path) return null;
        const m = PATH_RE.exec(path);
        if (!m) return null;
        const service = m[1].toLowerCase();
        if (m[3]) return 'post:' + service + ':' + m[3];
        return TRACK_CREATORS ? 'creator:' + service + ':' + m[2] : null;
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
    │  Two card shapes, both already `position: relative`, so the badge can    │
    │  simply be appended:                                                     │
    │    • article.post-card — a thumbnail with a title bar and a footer       │
    │    • a.user-card       — a creator, text over a banner background        │
    ╚───────────────────────────────────────────────────────────────────────*/
    const POST_CARD = 'article.post-card';
    const USER_CARD = 'a.user-card[href]';

    function paint() {
        let visitedHere = 0;

        document.querySelectorAll(POST_CARD).forEach(card => {
            const a = card.querySelector('a[href]');
            const ts = a ? store[keyFromHref(a.getAttribute('href'))] : undefined;
            if (!ts) { clear(card); return; }
            visitedHere++;
            mark(card, 'pawv-visited', ts);
        });

        document.querySelectorAll(USER_CARD).forEach(a => {
            const ts = store[keyFromHref(a.getAttribute('href'))];
            if (!ts) { clear(a); return; }
            visitedHere++;
            mark(a, 'pawv-visited-user', ts);
        });

        updateButton(visitedHere);
    }

    function mark(el, kind, ts) {
        el.classList.add('pawv-visited', kind);
        let badge = el.querySelector(':scope > .pawv-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'pawv-badge';
            el.appendChild(badge);
        }
        // Only write when the value actually changes — otherwise every paint
        // mutates the DOM, which wakes the observer below, forever.
        const label = '\u{1F441} ' + relTime(ts);
        if (badge.textContent !== label) badge.textContent = label;
        const title = 'Last viewed ' + fullTime(ts);
        if (badge.title !== title) badge.title = title;
    }

    function clear(el) {
        if (!el.classList.contains('pawv-visited')) return;
        el.classList.remove('pawv-visited', 'pawv-visited-user');
        const badge = el.querySelector(':scope > .pawv-badge');
        if (badge) badge.remove();
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Recording a visit                                                       │
    │                                                                          │
    │  Two ways, so something is marked however you got to it:                 │
    │   1. optimistically on click — the mark is already there when you come   │
    │      back, and it covers new tabs (middle / ctrl-click);                 │
    │   2. on landing on a post or creator page, which also covers a link      │
    │      followed from outside the site.                                     │
    ╚───────────────────────────────────────────────────────────────────────*/
    function onCardClick(e) {
        if (e.button === 2) return; // ignore right-click
        // The site runs a popunder ad script, and those re-dispatch clicks of
        // their own. Only a click the user actually made counts as a visit.
        if (e.isTrusted === false) return;
        const a = e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        // Only cards, not the creator name printed inside a DM or a comment:
        // those are bare text links, and marking them would fade stray words.
        if (!a.matches(USER_CARD) && !a.closest(POST_CARD)) return;
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
    │  "Hide visited" — drop every visited card out of the listing, leaving   │
    │  only what you haven't opened. It's a plain class on <html>, so hiding  │
    │  and showing costs nothing and needs no repaint. The state is kept      │
    │  (and shared across tabs), so it survives paging and navigation.        │
    ╚───────────────────────────────────────────────────────────────────────*/
    let hideVisited = read(HIDE_STATE_KEY, false) === true;

    function applyHide() {
        document.documentElement.classList.toggle('pawv-hide-visited', hideVisited);
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
    │  The button.                                                             │
    │                                                                          │
    │  Pawchive's listings don't share a toolbar — /posts has a search bar,    │
    │  /artists a filter form, a creator's page neither — so instead of        │
    │  hunting for a different control row on every route, the button gets a   │
    │  slim right-aligned bar of its own, inserted directly above the top      │
    │  paginator (or the card list, if a page has no paginator). That anchor   │
    │  exists on every listing, so the button lands in the same place          │
    │  everywhere. It's styled after the site's own search box.                │
    │                                                                          │
    │  Its label says what a click will DO and carries the number of visited   │
    │  cards on the page. With nothing visited here and nothing hidden there   │
    │  is nothing to toggle, so the bar stays out of the way entirely.         │
    ╚───────────────────────────────────────────────────────────────────────*/
    let btn = null, btnText = null, bar = null;

    function listingAnchor() {
        if (!BUTTON_IN_BAR) return null;
        const list = document.querySelector('.card-list');
        if (!list) return null; // not a listing page — nothing to hide
        const pag = document.getElementById('paginator-top') ||
                    document.querySelector('.paginator');
        const anchor = pag && pag.parentElement === list.parentElement ? pag : list;
        return anchor.parentElement ? anchor : null;
    }

    function updateButton(visitedHere) {
        if (!SHOW_BUTTON || !document.body) return;
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pawv-toggle';
            const eye = document.createElement('span');
            eye.className = 'pawv-toggle-eye';
            eye.textContent = '\u{1F441}';
            btnText = document.createElement('span');
            btnText.className = 'pawv-toggle-text';
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

        // Re-home the button whenever it's adrift — a page that replaces its
        // listing (the creator search, the /artists loader) takes our bar with
        // it. Without an anchor it falls back to a floating corner pill rather
        // than disappearing.
        const anchor = listingAnchor();
        if (anchor) {
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'pawv-bar';
            }
            if (bar.nextElementSibling !== anchor || bar.parentElement !== anchor.parentElement) {
                anchor.parentElement.insertBefore(bar, anchor);
            }
            if (btn.parentElement !== bar) bar.appendChild(btn);
            btn.classList.remove('pawv-toggle-float');
        } else {
            if (bar && bar.parentElement) bar.remove();
            if (btn.parentElement !== document.body) document.body.appendChild(btn);
            btn.classList.add('pawv-toggle-float');
        }

        const useful = hideVisited || visitedHere > 0;
        if (btn.hidden !== !useful) btn.hidden = !useful;
        if (bar && bar.hidden !== !useful) bar.hidden = !useful;
        if (!useful) return;

        const label = (hideVisited ? 'Show visited' : 'Hide visited') +
                      (visitedHere ? ' (' + visitedHere + ')' : '');
        // Same idempotence rule as the badges: only write on a real change,
        // or every paint wakes the observer that triggered it.
        if (btnText.textContent !== label) btnText.textContent = label;
        const pressed = hideVisited ? 'true' : 'false';
        if (btn.getAttribute('aria-pressed') !== pressed) btn.setAttribute('aria-pressed', pressed);
        btn.classList.toggle('pawv-toggle-on', hideVisited);
        const tip = (hideVisited ? 'Show the cards you\'ve already opened' : 'Hide the cards you\'ve already opened') +
                    (HIDE_KEY ? ' (Alt+' + HIDE_KEY.toUpperCase() + ')' : '');
        if (btn.title !== tip) btn.title = tip;
    }

    // Brief confirmation, so the shortcut isn't a silent no-op on a listing
    // that happens to have nothing visited in it.
    let toastEl = null, toastTimer = null;
    function toast(text) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.className = 'pawv-toast';
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = text;
        toastEl.classList.add('pawv-toast-on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('pawv-toast-on'), 1400);
    }

    function onKeyDown(e) {
        if (!HIDE_KEY || !e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key.toLowerCase() !== HIDE_KEY.toLowerCase()) return;
        // Don't steal the key while you're typing in a search box.
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        e.preventDefault();
        toggleHide(true);
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Styles                                                                  │
    ╚───────────────────────────────────────────────────────────────────────*/
    let styleEl = null;
    function injectStyles() {
        const style = document.createElement('style');
        styleEl = style;
        // The site sweeps every <style>/<script> in <head> that isn't marked
        // `data-keep` whenever it swaps a page in (hx-boost / htmx:beforeSwap),
        // which would take our styles with it. Carry the same marker — and the
        // interval below puts the element back if it ever goes missing anyway.
        style.setAttribute('data-keep', '');
        style.textContent = `
            /* Post cards: dim + desaturate the thumbnail, eased back on hover.
               The filter sits on the <img> so the title bar and footer stay
               readable; they're dimmed separately and more gently. */
            article.pawv-visited .post-card__image { filter: ${FADE_FILTER}; transition: filter .15s ease; }
            article.pawv-visited:hover .post-card__image { filter: ${HOVER_FILTER}; }
            article.pawv-visited .post-card__header,
            article.pawv-visited .post-card__footer { opacity: ${DIM_TITLE}; transition: opacity .15s ease; }
            article.pawv-visited:hover .post-card__header,
            article.pawv-visited:hover .post-card__footer { opacity: 1; }

            /* Creator cards are text over a banner background-image, which no
               filter on an <img> would touch, so fade the whole card. */
            a.pawv-visited-user { opacity: ${USER_OPACITY}; transition: opacity .15s ease; }
            a.pawv-visited-user:hover { opacity: ${USER_HOVER}; }

            /* Top-right: a post card's title sits top-left, its date and
               service icon along the bottom. */
            .pawv-badge {
                position: absolute;
                top: 4px;
                right: 4px;
                z-index: 3;
                padding: 3px 6px;
                border-radius: 4px;
                background: ${BADGE_BG};
                color: ${BADGE_FG};
                font: 600 11px/1 Helvetica, sans-serif;
                white-space: nowrap;
                pointer-events: none;
                box-shadow: 0 1px 4px rgba(0, 0, 0, .5);
            }

            /* Alt+V: drop visited cards out of the listing entirely. Both card
               lists reflow on their own. */
            html.pawv-hide-visited article.pawv-visited,
            html.pawv-hide-visited a.pawv-visited-user { display: none !important; }

            /* The button's own bar, directly above the listing. */
            .pawv-bar {
                display: flex;
                justify-content: flex-end;
                margin: 0 0 8px;
            }
            .pawv-bar[hidden] { display: none; }

            /* Styled after the site's own search box (same surface, border,
               radius and type) so it reads as part of the page. */
            .pawv-toggle {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                margin: 0;
                padding: 7px 12px;
                border: 1px solid #464a53;
                border-radius: 8px;
                background: #1a1c1c;
                color: #f2f2f2;
                font-family: Helvetica, sans-serif;
                font-size: 14px;
                line-height: 20px;
                white-space: nowrap;
                cursor: pointer;
                transition: background .15s ease, border-color .15s ease;
            }
            .pawv-toggle-eye { font-size: 13px; line-height: 1; }
            .pawv-toggle:hover { background: #25282a; border-color: #5c616c; }
            /* Pressed: a clear "hiding is on" that isn't just a darker grey. */
            .pawv-toggle-on {
                background: ${BADGE_BG};
                border-color: ${BADGE_BG};
                color: #fff;
            }
            .pawv-toggle-on:hover { background: ${BADGE_BG}; border-color: ${BADGE_BG}; filter: brightness(1.12); }
            /* Narrow screens: the row is tight, so keep just the eye. */
            @media (max-width: 560px) { .pawv-toggle-text { display: none; } }

            /* Fallback when a page has no listing to sit above. */
            .pawv-toggle-float {
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: 2147483646;
                border-radius: 999px;
                background: rgba(20, 20, 24, .88);
                box-shadow: 0 2px 10px rgba(0, 0, 0, .45);
                backdrop-filter: blur(6px);
            }
            .pawv-toggle-float.pawv-toggle-on { background: ${BADGE_BG}; }
            /* display:inline-flex would otherwise beat the hidden attribute. */
            .pawv-toggle[hidden] { display: none !important; }

            /* Only ever shown when the button isn't, so the two can't collide. */
            .pawv-toast {
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: 2147483647;
                padding: 8px 12px;
                border-radius: 6px;
                background: ${BADGE_BG};
                color: ${BADGE_FG};
                font: 600 12px/1 Helvetica, sans-serif;
                pointer-events: none;
                opacity: 0;
                transform: translateY(6px);
                transition: opacity .15s ease, transform .15s ease;
                box-shadow: 0 2px 10px rgba(0, 0, 0, .5);
            }
            .pawv-toast-on { opacity: 1; transform: translateY(0); }
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
    │  Boot + keeping up with the page                                         │
    │                                                                          │
    │  Pawchive is server-rendered, so most navigation is a full page load —   │
    │  but /artists builds its grid in the browser and a creator's search      │
    │  swaps its card list out, so a debounced observer repaints, and a light  │
    │  interval refreshes the relative times.                                  │
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
        // Put the stylesheet back if the site's head sweep took it anyway.
        if (styleEl && !styleEl.isConnected) document.head.appendChild(styleEl);
        store = loadStore();
        paint();
    }, 1000);

    recordVisit();
    paint();
})();
