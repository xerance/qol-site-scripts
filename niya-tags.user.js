// ==UserScript==
// @name         NiyaTags
// @namespace    https://github.com/polo2005x/niya-visited
// @version      2.3.1
// @description  Your own "My Tags" for niyaniya.moe / hdoujin.org / shupogaki.moe — group tags into any number of highlight/warn groups, each with its own color; matching galleries get colored chips + ring. Settings window + on-page tagging included.
// @author       you
// @match        *://niyaniya.moe/*
// @match        *://hdoujin.org/*
// @match        *://shupogaki.moe/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    /*───────────────────────────────────────────────────────────────────────╗
    │  Tunables & constants                                                    │
    ╚───────────────────────────────────────────────────────────────────────*/
    const RETRY_COOLDOWN = 60000;  // ms before re-trying a gallery whose fetch returned no tags
    const MASTER_TTL     = 7 * 864e5; // re-fetch the suggestion vocab weekly

    const CFG_KEY   = 'niya-tags-config'; // { enabled, groups:[{id,kind,name,color,tags[]}] }
    const CACHE_KEY = 'niya-tags-cache';  // { "grp:id": { tags:[...], ts } }
    const VOCAB_KEY = 'niya-tags-vocab';  // { [grp]: { tags:[...], ts } }

    const API_BASE = location.hostname.includes('hdoujin')
        ? 'https://api.hdoujin.org'
        : 'https://api.schale.network';
    const NS_MAP = {
        1: 'artist', 2: 'circle', 3: 'parody', 5: 'character', 7: 'uploader',
        8: 'male', 9: 'female', 10: 'mixed', 11: 'language', 12: 'other', 13: 'category',
    };
    const NS_COLORS = {
        artist: '#8e44ad', circle: '#16a085', parody: '#27ae60', character: '#2980b9',
        male: '#2d6cdf', female: '#d6336c', mixed: '#e08a1e', tag: '#5a6272',
        other: '#5a6272', language: '#7f8c8d', cosplayer: '#c0392b', magazine: '#8d6e63',
        any: '#4a5060', _default: '#5a6272',
    };

    // Chip prefix abbreviations (when "show namespace initial" is on). One letter
    // where it's unique; longer only for first-letter collisions. female=f, male=m.
    const NS_ABBR = {
        artist: 'a', female: 'f', male: 'm', language: 'l', other: 'o', parody: 'p',
        tag: 't', uploader: 'u', magazine: 'mag', mixed: 'mix',
        character: 'char', circle: 'circ', category: 'cat', cosplayer: 'cos',
    };

    const DEFAULT_HI = '#25c05a', DEFAULT_WARN = '#e23b3b';
    const HI_PALETTE   = ['#25c05a', '#2d9cdb', '#9b59b6', '#16a085', '#f39c12', '#1abc9c'];
    const WARN_PALETTE = ['#e23b3b', '#e67e22', '#c0392b', '#d81b60', '#7f8c8d'];

    const GROUP = location.hostname.includes('hdoujin') ? 'hd' : 'ny'; // gallery-id space
    const gkey = id => GROUP + ':' + id;

    /*───────────────────────────────────────────────────────────────────────╗
    │  Small helpers                                                           │
    ╚───────────────────────────────────────────────────────────────────────*/
    const norm = s => String(s).trim().toLowerCase();
    const isGalleryPage = () => /^\/g\//.test(location.pathname);
    const idFromHref = href => { const m = (href || '').match(/\/g\/(\d+)/); return m ? m[1] : null; };
    const newId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    function hexToRgba(hex, a) {
        const h = String(hex).replace('#', '');
        const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
        const n = parseInt(f, 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }
    function parseTagsFromDoc(doc) {
        const out = new Set();
        doc.querySelectorAll('a[href^="/tag/"]').forEach(a => {
            const m = a.getAttribute('href').match(/^\/tag\/([^:]+):(.+)$/);
            if (m) out.add((m[1] + ':' + decodeURIComponent(m[2]).replace(/\+/g, ' ')).toLowerCase());
        });
        return [...out];
    }
    const parseTagsFromHTML = html => parseTagsFromDoc(new DOMParser().parseFromString(html, 'text/html'));
    // Tags from a /books/detail API response → ["namespace:name", …] (lowercased).
    function tagsFromDetail(d) {
        if (!d || !Array.isArray(d.tags)) return [];
        const out = [];
        for (const t of d.tags) { if (t && t.name) out.push((NS_MAP[t.namespace] || 'tag') + ':' + String(t.name).toLowerCase()); }
        return [...new Set(out)];
    }
    function tagFromHref(href) {
        const m = (href || '').match(/^\/tag\/([^:]+):(.+)$/);
        return m ? (m[1] + ':' + decodeURIComponent(m[2]).replace(/\+/g, ' ')).toLowerCase() : null;
    }
    // Does a user entry match a gallery tag?  "ns:name" = exact; bare "name" = any namespace.
    function entryMatchesTag(entry, tag) {
        const e = norm(entry);
        return e.includes(':') ? e === tag : e === tag.slice(tag.indexOf(':') + 1);
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Config — groups model, with migration from the old 2-list shape.       │
    ╚───────────────────────────────────────────────────────────────────────*/
    function normalizeCfg(raw) {
        raw = raw && typeof raw === 'object' ? raw : {};
        const enabled = !!raw.enabled;
        let groups = Array.isArray(raw.groups) ? raw.groups : null;
        if (!groups) {
            // migrate v1.x: { highlightColor, warnColor, highlight[], warn[] }
            groups = [
                { id: newId(), kind: 'hi',   name: 'Highlight 1', color: raw.highlightColor || DEFAULT_HI,   tags: Array.isArray(raw.highlight) ? raw.highlight.map(norm) : [] },
                { id: newId(), kind: 'warn', name: 'Warn 1',      color: raw.warnColor || DEFAULT_WARN,      tags: Array.isArray(raw.warn) ? raw.warn.map(norm) : [] },
            ];
        } else {
            groups = groups.map(g => ({
                id: g.id || newId(),
                kind: g.kind === 'warn' ? 'warn' : 'hi',
                name: typeof g.name === 'string' ? g.name : 'Group',
                color: typeof g.color === 'string' ? g.color : DEFAULT_HI,
                tags: Array.isArray(g.tags) ? g.tags.map(norm) : [],
            }));
        }
        return {
            enabled,
            visibleFirst: raw.visibleFirst !== false, // default: load on-screen first
            showNsPrefix: !!raw.showNsPrefix,         // default: off (chip shows bare name)
            groups,
        };
    }
    function loadCfg() { try { return normalizeCfg(GM_getValue(CFG_KEY, {})); } catch (e) { return normalizeCfg({}); } }
    function saveCfg() { GM_setValue(CFG_KEY, cfg); }
    function loadCache() { try { return GM_getValue(CACHE_KEY, {}) || {}; } catch (e) { return {}; } }
    function saveCache() { GM_setValue(CACHE_KEY, cache); }

    let cfg = loadCfg();
    let cache = loadCache();
    let modalRefresh = null; // set while settings is open, so on-page edits refresh it
    let gear = null;         // floating settings button (hidden on /g/ pages)

    /*───────────────────────────────────────────────────────────────────────╗
    │  Group matching & precedence                                             │
    │  Precedence: warn groups beat highlight groups; within a kind, the       │
    │  group earlier in the list wins.                                         │
    ╚───────────────────────────────────────────────────────────────────────*/
    const groupRank = (g, idx) => (g.kind === 'warn' ? 0 : 1e6) + idx;

    function matchGroups(tags) { // → [{group, matched:[galleryTags], rank}] sorted by precedence
        const res = [];
        cfg.groups.forEach((g, idx) => {
            const matched = tags.filter(t => g.tags.some(e => entryMatchesTag(e, t)));
            if (matched.length) res.push({ group: g, matched, rank: groupRank(g, idx) });
        });
        res.sort((a, b) => a.rank - b.rank);
        return res;
    }
    function primaryGroup(tag) { // highest-precedence group a single tag belongs to
        let best = null, bestRank = Infinity;
        cfg.groups.forEach((g, idx) => {
            if (g.tags.some(e => entryMatchesTag(e, tag))) {
                const r = groupRank(g, idx);
                if (r < bestRank) { bestRank = r; best = g; }
            }
        });
        return best;
    }
    function toggleTagInGroup(tag, groupId) {
        tag = norm(tag);
        const g = cfg.groups.find(x => x.id === groupId);
        if (!g) return;
        const i = g.tags.indexOf(tag);
        if (i > -1) g.tags.splice(i, 1); else g.tags.push(tag);
        saveCfg();
        if (isGalleryPage()) decorateGalleryTags();
        applyToCards();
        if (modalRefresh && document.querySelector('.niyat-overlay')) modalRefresh();
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Throttled fetch queue for gallery tags — uses the JSON detail API       │
    │  (/books/detail/{id}/{key}); reliable & complete, unlike scraping the    │
    │  /g/ HTML page (which can come back partial behind Cloudflare).          │
    ╚───────────────────────────────────────────────────────────────────────*/
    const queue = [];
    const queued = new Set();
    const failAt = {}; // k -> last time a fetch came back empty/failed (for retry cooldown)
    let active = 0;

    // The detail API is strictly rate-limited (x-ratelimit-limit: 5). So we go ONE
    // request at a time and honor the response headers: when tokens run low we back
    // off until x-ratelimit-reset, leaving one token for the site's own requests.
    // A 429 is re-queued (not a failure) so cards further down the page still load.
    let rlRemaining = Infinity, rlResetMs = 0;
    const RL_BUFFER = 1;

    // A cache entry is only "good" if it actually has tags; empty ones are treated
    // as missing so they re-fetch.
    const cacheHit = k => { const e = cache[k]; return !!(e && e.tags && e.tags.length); };
    const inCooldown = k => failAt[k] && Date.now() - failAt[k] < RETRY_COOLDOWN;

    function enqueue(id, key) {
        const k = gkey(id);
        if (cacheHit(k) || queued.has(k) || inCooldown(k)) return;
        queued.add(k); queue.push({ k, id, key }); pump();
    }
    // Visible-first priority: on-screen cards first (ordered top→down), then cards
    // just below the viewport, then ones already scrolled past. Re-evaluated on
    // every pick, so what you're looking at loads first as you scroll.
    function jobPriority(job) {
        const a = document.querySelector('a[href^="/g/' + job.id + '/"]');
        if (!a) return 1e9;
        const r = a.getBoundingClientRect();
        const vh = window.innerHeight || document.documentElement.clientHeight;
        if (r.bottom >= 0 && r.top <= vh) return Math.max(0, r.top); // visible
        if (r.top > vh) return 1e5 + (r.top - vh);                   // below the fold
        return 1e7 + (-r.bottom);                                    // above (scrolled past)
    }

    function pump() {
        if (active || !queue.length) return;
        const now = Date.now();
        if (rlRemaining <= RL_BUFFER && rlResetMs > now) { setTimeout(pump, rlResetMs - now + 150); return; }
        let job;
        if (cfg.visibleFirst) {
            let bi = 0, bk = Infinity;
            for (let i = 0; i < queue.length; i++) { const p = jobPriority(queue[i]); if (p < bk) { bk = p; bi = i; } }
            job = queue.splice(bi, 1)[0];
        } else {
            job = queue.shift(); // top-to-bottom (order enqueued)
        }
        active++;
        let requeued = false;
        fetch(API_BASE + '/books/detail/' + job.id + '/' + job.key, { credentials: 'omit' })
            .then(async r => {
                const rem = r.headers.get('x-ratelimit-remaining'), rst = r.headers.get('x-ratelimit-reset');
                if (rem !== null) rlRemaining = parseInt(rem, 10);
                if (rst !== null) rlResetMs = parseInt(rst, 10) * 1000;
                if (r.status === 429) { requeued = true; queue.push(job); return; } // throttled → retry after reset
                let d = null; try { d = await r.json(); } catch (e) {}
                const tags = tagsFromDetail(d);
                if (tags.length) { cache[job.k] = { tags, ts: Date.now() }; delete failAt[job.k]; }
                else { failAt[job.k] = Date.now(); }
            })
            .catch(() => { failAt[job.k] = Date.now(); })
            .finally(() => {
                if (!requeued) queued.delete(job.k);
                active--;
                scheduleFlush();
                setTimeout(pump, 40);
            });
    }
    let flushTimer = null;
    function scheduleFlush() {
        if (flushTimer) return;
        flushTimer = setTimeout(() => { flushTimer = null; saveCache(); applyToCards(); }, 250);
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Card painting                                                           │
    ╚───────────────────────────────────────────────────────────────────────*/
    function clearDecorations(root = document) {
        root.querySelectorAll('.niya-tagged').forEach(c => c.classList.remove('niya-tagged'));
        root.querySelectorAll('.niya-tags-ring, .niya-tags-chips').forEach(el => el.remove());
    }
    function decorate(card, matches) {
        if (!matches.length) {
            card.classList.remove('niya-tagged');
            card.querySelector('.niya-tags-ring')?.remove();
            card.querySelector('.niya-tags-chips')?.remove();
            return;
        }
        card.classList.add('niya-tagged');

        let ring = card.querySelector(':scope > .niya-tags-ring');
        if (!ring) { ring = document.createElement('div'); ring.className = 'niya-tags-ring'; card.appendChild(ring); }
        ring.style.boxShadow = 'inset 0 0 0 3px ' + matches[0].group.color;

        const imgArea = card.querySelector('.grow') || card;
        if (getComputedStyle(imgArea).position === 'static') imgArea.style.position = 'relative';
        let chips = card.querySelector('.niya-tags-chips');
        if (!chips) { chips = document.createElement('div'); chips.className = 'niya-tags-chips'; imgArea.appendChild(chips); }
        chips.innerHTML = '';
        for (const m of matches) {
            for (const t of m.matched) {
                const span = document.createElement('span');
                span.className = 'niya-tag-chip';
                span.style.background = m.group.color;
                let label = t.includes(':') ? t.slice(t.indexOf(':') + 1) : t;
                if (cfg.showNsPrefix && t.includes(':')) {
                    const ns = t.slice(0, t.indexOf(':'));
                    label = (NS_ABBR[ns] || ns[0]) + ':' + label; // e.g. f:tanned, mix:incest
                }
                span.textContent = (m.group.kind === 'warn' ? '⚠ ' : '') + label;
                span.title = m.group.name + ' · ' + t;
                chips.appendChild(span);
            }
        }
    }
    function cacheCurrentGallery() {
        const m = location.pathname.match(/^\/g\/(\d+)/);
        if (!m) return;
        const k = gkey(m[1]);
        const tags = parseTagsFromDoc(document);
        if (!tags.length) return;
        // The page you actually loaded is authoritative — (re)cache it, overwriting
        // any missing/empty/shorter entry from an earlier failed listing fetch.
        const e = cache[k];
        if (e && e.tags && e.tags.length >= tags.length) return;
        cache[k] = { tags, ts: Date.now() }; delete failAt[k]; scheduleFlush();
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  /g/ page: per-tag ＋ that opens a mini group menu, and group tinting.   │
    ╚───────────────────────────────────────────────────────────────────────*/
    let gmenu = null, gmenuTag = null;
    function closeGroupMenu() {
        if (!gmenu) return;
        gmenu.remove(); gmenu = null; gmenuTag = null;
        document.removeEventListener('mousedown', gmenuOutside, true);
    }
    function gmenuOutside(e) { if (gmenu && !gmenu.contains(e.target)) closeGroupMenu(); }
    function renderGroupMenu() {
        gmenu.innerHTML = '';
        if (!cfg.groups.length) {
            const d = document.createElement('div');
            d.className = 'niyat-gmenu-empty'; d.textContent = 'No groups — add some in settings';
            gmenu.appendChild(d); return;
        }
        cfg.groups.forEach(g => {
            const inG = g.tags.includes(gmenuTag);
            const row = document.createElement('div');
            row.className = 'niyat-gmenu-row' + (inG ? ' active' : '');
            const dot = document.createElement('span'); dot.className = 'niyat-gmenu-dot'; dot.style.background = g.color;
            const nm = document.createElement('span'); nm.className = 'niyat-gmenu-name'; nm.textContent = (g.kind === 'warn' ? '⚠ ' : '') + (g.name || '(unnamed)');
            const ck = document.createElement('span'); ck.className = 'niyat-gmenu-check'; ck.textContent = inG ? '✓' : '';
            row.append(dot, nm, ck);
            const stop = e => { e.preventDefault(); e.stopPropagation(); };
            row.addEventListener('mousedown', stop);
            row.addEventListener('click', e => { stop(e); toggleTagInGroup(gmenuTag, g.id); renderGroupMenu(); });
            gmenu.appendChild(row);
        });
    }
    function openGroupMenu(anchor, tag) {
        closeGroupMenu();
        gmenuTag = norm(tag);
        gmenu = document.createElement('div');
        gmenu.className = 'niyat-gmenu';
        renderGroupMenu();
        document.body.appendChild(gmenu);
        const r = anchor.getBoundingClientRect();
        gmenu.style.top = (r.bottom + 4) + 'px';
        gmenu.style.left = Math.max(6, Math.min(r.left, innerWidth - gmenu.offsetWidth - 6)) + 'px';
        setTimeout(() => document.addEventListener('mousedown', gmenuOutside, true), 0);
    }
    function decorateGalleryTags() {
        document.querySelectorAll('a[href^="/tag/"]').forEach(a => {
            const tag = tagFromHref(a.getAttribute('href'));
            if (!tag) return;

            let ctl = a.querySelector(':scope > .niyat-g-ctl');
            if (!ctl) {
                ctl = document.createElement('span');
                ctl.className = 'niyat-g-ctl';
                const btn = document.createElement('b');
                btn.className = 'niyat-g-btn'; btn.title = 'Add to a group';
                const stop = e => { e.preventDefault(); e.stopPropagation(); };
                btn.addEventListener('mousedown', stop);
                btn.addEventListener('click', e => { stop(e); openGroupMenu(btn, tag); });
                ctl.appendChild(btn);
                a.appendChild(ctl);
            }

            const pg = primaryGroup(tag);
            const n = cfg.groups.filter(g => g.tags.includes(tag)).length;
            if (pg) { a.style.boxShadow = 'inset 0 0 0 2px ' + pg.color; a.style.background = hexToRgba(pg.color, 0.18); a.classList.add('niyat-g-on'); }
            else { a.style.boxShadow = ''; a.style.background = ''; a.classList.remove('niyat-g-on'); }

            const btn = ctl.querySelector('.niyat-g-btn');
            btn.textContent = n ? '✓' : '+';
            btn.classList.toggle('active', n > 0);
            btn.style.background = n && pg ? pg.color : '';
        });
    }
    function clearGalleryTagDecor() {
        closeGroupMenu();
        document.querySelectorAll('.niyat-g-ctl').forEach(e => e.remove());
        document.querySelectorAll('a.niyat-g-on').forEach(a => { a.classList.remove('niyat-g-on'); a.style.boxShadow = ''; a.style.background = ''; });
    }

    // NiyaTags button in the gallery's Copy Tags / Copy Link / Source row (right-aligned).
    function injectGallerySettingsButton() {
        const anchor = [...document.querySelectorAll('.actions button, .actions a')]
            .find(e => /^\s*(copy tags|copy link|source)\s*$/i.test(e.textContent.trim()));
        const row = anchor ? (anchor.closest('.actions') || anchor.parentElement) : null;
        if (!row) return false;
        let btn = row.querySelector('.niyat-g-settings');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'niyat-g-settings border rounded flex items-center gap-5 py-4 px-10';
            btn.style.marginLeft = 'auto';
            btn.title = 'NiyaTags settings';
            btn.innerHTML = '<span class="uppercase">🏷 NiyaTags</span>';
            btn.addEventListener('click', openSettings);
        }
        if (row.lastElementChild !== btn) row.appendChild(btn); // keep last so Source doesn't shift
        return true;
    }

    function applyToCards() {
        if (isGalleryPage()) {
            cacheCurrentGallery();
            clearDecorations();
            const inlined = injectGallerySettingsButton();
            if (gear) gear.style.display = inlined ? 'none' : '';
            if (cfg.enabled) decorateGalleryTags(); else clearGalleryTagDecor();
            return;
        }
        if (gear) gear.style.display = '';

        if (!cfg.enabled || !cfg.groups.some(g => g.tags.length)) { clearDecorations(); return; }

        const seen = new Set();
        document.querySelectorAll('a[href^="/g/"]').forEach(a => {
            const m = (a.getAttribute('href') || '').match(/\/g\/(\d+)\/(\w+)/);
            if (!m) return;
            const id = m[1], key = m[2];
            const card = a.closest('article') || a;
            if (seen.has(card)) return;
            seen.add(card);
            const k = gkey(id);
            if (!cacheHit(k)) { enqueue(id, key); return; } // missing or empty → (re)fetch via API
            decorate(card, matchGroups(cache[k].tags));
        });
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Suggestion vocabulary (API + /tags + browsed cache)                     │
    ╚───────────────────────────────────────────────────────────────────────*/
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    async function fetchApiTags() {
        const out = [];
        for (const n of [0, 1, 2]) { // 0=male/female/mixed, 1=artist, 2=circle
            try {
                const url = API_BASE + '/books/tags' + (n ? '?namespace=' + n : '');
                const arr = await fetch(url, { credentials: 'omit' }).then(r => r.json());
                if (Array.isArray(arr)) for (const t of arr) {
                    const ns = NS_MAP[t.namespace];
                    if (ns && t.name) out.push(ns + ':' + String(t.name).toLowerCase());
                }
            } catch (e) {}
            await sleep(500);
        }
        return out;
    }
    async function fetchFilterNames() {
        try {
            const arr = await fetch(API_BASE + '/books/tags/filters', { credentials: 'omit' }).then(r => r.json());
            return Array.isArray(arr) ? arr.map(t => String(t.name || '').toLowerCase()).filter(Boolean) : [];
        } catch (e) { return []; }
    }
    async function fetchHtmlTags() {
        try {
            const html = await fetch(location.origin + '/tags', { credentials: 'omit' }).then(r => r.text());
            return parseTagsFromHTML(html);
        } catch (e) { return []; }
    }
    async function buildVocab() {
        let store = {};
        try { store = GM_getValue(VOCAB_KEY, {}) || {}; } catch (e) {}
        const cached = store[GROUP];
        if (cached && Array.isArray(cached.tags) && Date.now() - cached.ts < MASTER_TTL) return cached.tags;
        const api = await fetchApiTags(); await sleep(500);
        const names = await fetchFilterNames(); await sleep(500);
        const html = await fetchHtmlTags();
        const tags = [...new Set([...api, ...names, ...html])];
        if (tags.length) { store[GROUP] = { tags, ts: Date.now() }; GM_setValue(VOCAB_KEY, store); return tags; }
        return cached ? cached.tags : [];
    }
    async function getVocab() {
        const set = new Set(await buildVocab());
        for (const k in cache) { const e = cache[k]; if (e && Array.isArray(e.tags)) e.tags.forEach(t => set.add(t)); }
        return [...set].sort();
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Settings window                                                         │
    ╚───────────────────────────────────────────────────────────────────────*/
    let vocab = null;
    const SYNTH_NS = ['female', 'male', 'tag'];

    function openSettings() {
        if (document.querySelector('.niyat-overlay')) return;

        const overlay = document.createElement('div');
        overlay.className = 'niyat-overlay';
        overlay.innerHTML = `
        <div class="niyat-panel">
            <div class="niyat-head"><span>NiyaTags</span><button class="niyat-close" title="Close">✕</button></div>
            <div class="niyat-body">
                <label class="niyat-row"><input type="checkbox" class="niyat-enabled"> <b>Enable tag highlighting</b></label>
                <p class="niyat-hint">Cards are checked against your groups below. First view of a page fetches each gallery's tags (throttled) and caches them.</p>
                <label class="niyat-row niyat-opt"><input type="checkbox" class="niyat-visfirst"> Load on‑screen galleries first <span class="niyat-opthint">(off = top to bottom)</span></label>
                <label class="niyat-row niyat-opt"><input type="checkbox" class="niyat-nsprefix"> Show namespace initial on chips <span class="niyat-opthint">(e.g. <code>f:tanned</code>)</span></label>

                <div class="niyat-add">
                    <div class="niyat-addrow">
                        <input type="text" class="niyat-search" placeholder="Search tags (or type any namespace:tag)…" autocomplete="off">
                        <label class="niyat-targetlabel">Add to <select class="niyat-target"></select></label>
                    </div>
                    <div class="niyat-results"></div>
                </div>

                <div class="niyat-section">
                    <div class="niyat-sechead"><h4>Highlight groups</h4><button class="niyat-addhi">+ Add group</button></div>
                    <div class="niyat-higroups"></div>
                </div>
                <div class="niyat-section">
                    <div class="niyat-sechead"><h4>Warn groups</h4><button class="niyat-addwarn">+ Add group</button></div>
                    <div class="niyat-warngroups"></div>
                </div>
            </div>
            <div class="niyat-foot"><button class="niyat-clearcache">Clear tag cache</button><span class="niyat-status"></span></div>
        </div>`;
        document.body.appendChild(overlay);

        const $ = sel => overlay.querySelector(sel);
        const enabled = $('.niyat-enabled');
        const search = $('.niyat-search');
        const target = $('.niyat-target');
        const results = $('.niyat-results');
        const status = $('.niyat-status');
        enabled.checked = cfg.enabled;
        const visfirst = $('.niyat-visfirst'); visfirst.checked = cfg.visibleFirst;
        const nsprefix = $('.niyat-nsprefix'); nsprefix.checked = cfg.showNsPrefix;

        const commit = () => { saveCfg(); applyToCards(); };
        const refreshGallery = () => { if (isGalleryPage()) decorateGalleryTags(); };

        function renderTarget() {
            const prev = target.value;
            target.innerHTML = '';
            for (const [kind, label] of [['hi', 'Highlight'], ['warn', 'Warn']]) {
                const gs = cfg.groups.filter(g => g.kind === kind);
                if (!gs.length) continue;
                const og = document.createElement('optgroup'); og.label = label;
                gs.forEach(g => { const o = document.createElement('option'); o.value = g.id; o.textContent = g.name; og.appendChild(o); });
                target.appendChild(og);
            }
            if ([...target.options].some(o => o.value === prev)) target.value = prev;
        }

        function groupBox(g) {
            const wrap = document.createElement('div'); wrap.className = 'niyat-group';
            const head = document.createElement('div'); head.className = 'niyat-group-head';
            const color = document.createElement('input'); color.type = 'color'; color.value = g.color;
            const name = document.createElement('input'); name.type = 'text'; name.className = 'niyat-group-name'; name.value = g.name;
            const del = document.createElement('button'); del.className = 'niyat-group-del'; del.textContent = '✕'; del.title = 'Delete group';
            head.append(color, name, del);

            const tagbox = document.createElement('div'); tagbox.className = 'niyat-group-tags';
            if (!g.tags.length) tagbox.innerHTML = '<span class="niyat-empty">no tags — add from the search above</span>';
            else g.tags.forEach(tag => {
                const chip = document.createElement('span'); chip.className = 'niyat-editchip'; chip.style.background = g.color;
                const s = document.createElement('span'); s.textContent = tag;
                const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Remove';
                x.onclick = () => { const i = g.tags.indexOf(tag); if (i > -1) g.tags.splice(i, 1); commit(); renderGroups(); refreshGallery(); };
                chip.append(s, x); tagbox.appendChild(chip);
            });

            color.oninput = () => { g.color = color.value; commit(); renderGroups(); refreshGallery(); };
            name.oninput = () => { g.name = name.value; saveCfg(); renderTarget(); };
            del.onclick = () => { if (confirm('Delete group "' + g.name + '"? Its tags are removed.')) { const i = cfg.groups.indexOf(g); if (i > -1) cfg.groups.splice(i, 1); commit(); renderGroups(); refreshGallery(); } };
            wrap.append(head, tagbox);
            return wrap;
        }

        function renderGroups() {
            for (const [sel, kind] of [['.niyat-higroups', 'hi'], ['.niyat-warngroups', 'warn']]) {
                const box = $(sel); box.innerHTML = '';
                const gs = cfg.groups.filter(g => g.kind === kind);
                if (!gs.length) { box.innerHTML = '<div class="niyat-empty">no groups yet</div>'; continue; }
                gs.forEach(g => box.appendChild(groupBox(g)));
            }
            renderTarget();
        }

        function addGroup(kind) {
            const gs = cfg.groups.filter(g => g.kind === kind);
            const palette = kind === 'warn' ? WARN_PALETTE : HI_PALETTE;
            cfg.groups.push({ id: newId(), kind, name: (kind === 'warn' ? 'Warn ' : 'Highlight ') + (gs.length + 1), color: palette[gs.length % palette.length], tags: [] });
            commit(); renderGroups();
        }

        function addTagToTarget(tag) {
            tag = norm(tag); if (!tag) return;
            const g = cfg.groups.find(x => x.id === target.value);
            if (!g) { status.textContent = 'add a group first'; return; }
            if (!g.tags.includes(tag)) g.tags.push(tag);
            commit(); renderGroups(); refreshGallery();
            status.textContent = 'added “' + tag + '” to ' + g.name;
        }

        function renderRows(rows) {
            rows.forEach(t => {
                const hasNs = t.includes(':');
                const ns = hasNs ? t.slice(0, t.indexOf(':')) : 'any';
                const name = hasNs ? t.slice(t.indexOf(':') + 1) : t;
                const row = document.createElement('div'); row.className = 'niyat-result';
                const badge = document.createElement('span'); badge.className = 'niyat-nsbadge'; badge.textContent = ns; badge.style.background = NS_COLORS[ns] || NS_COLORS._default;
                const label = document.createElement('span'); label.className = 'niyat-restag'; label.textContent = name;
                const left = document.createElement('span'); left.className = 'niyat-resleft'; left.append(badge, label);
                const add = document.createElement('button'); add.className = 'niyat-addbtn'; add.textContent = '+'; add.title = 'Add to selected group';
                add.onclick = () => addTagToTarget(t);
                row.append(left, add);
                results.appendChild(row);
            });
        }

        async function renderResults() {
            const q = norm(search.value);
            results.innerHTML = '';
            if (!q) return;
            if (!vocab) { status.textContent = 'loading tags…'; vocab = await getVocab(); status.textContent = ''; }

            if (q.includes(':')) {
                const pref = [], sub = [];
                for (const t of vocab) { if (t.startsWith(q)) pref.push(t); else if (t.includes(q)) sub.push(t); }
                let rows = [...pref, ...sub];
                if (!rows.includes(q)) rows = [q, ...rows];
                return renderRows(rows.slice(0, 50));
            }

            const namePref = [], nameSub = [], nameSeen = new Set();
            for (const t of vocab) {
                const name = t.slice(t.indexOf(':') + 1);
                if (nameSeen.has(name)) continue;
                if (name.startsWith(q)) { namePref.push(name); nameSeen.add(name); }
                else if (name.includes(q)) { nameSub.push(name); nameSeen.add(name); }
            }
            namePref.sort(); nameSub.sort();
            const names = [...namePref, ...nameSub].slice(0, 15);

            const rows = [], seen = new Set();
            if (names.length) {
                const byName = {};
                for (const t of vocab) { const nm = t.slice(t.indexOf(':') + 1); (byName[nm] || (byName[nm] = [])).push(t); }
                for (const name of names) {
                    if (!seen.has(name)) { seen.add(name); rows.push(name); }
                    for (const t of (byName[name] || []).sort()) if (!seen.has(t)) { seen.add(t); rows.push(t); }
                }
            } else {
                for (const v of [q, ...SYNTH_NS.map(ns => ns + ':' + q)]) if (!seen.has(v)) { seen.add(v); rows.push(v); }
            }
            renderRows(rows.slice(0, 60));
        }

        enabled.onchange = () => { cfg.enabled = enabled.checked; commit(); refreshGallery(); };
        visfirst.onchange = () => { cfg.visibleFirst = visfirst.checked; saveCfg(); };
        nsprefix.onchange = () => { cfg.showNsPrefix = nsprefix.checked; commit(); };
        search.oninput = renderResults;
        search.onkeydown = e => { if (e.key === 'Enter') { addTagToTarget(search.value); search.value = ''; renderResults(); } };
        $('.niyat-addhi').onclick = () => addGroup('hi');
        $('.niyat-addwarn').onclick = () => addGroup('warn');
        $('.niyat-clearcache').onclick = () => { cache = {}; for (const k in failAt) delete failAt[k]; saveCache(); status.textContent = 'cache cleared'; applyToCards(); };
        const closeModal = () => { overlay.remove(); modalRefresh = null; };
        $('.niyat-close').onclick = closeModal;
        overlay.onclick = e => { if (e.target === overlay) closeModal(); };

        renderGroups();
        modalRefresh = renderGroups; // on-page ＋ edits refresh the group boxes
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  Gear button + styles                                                    │
    ╚───────────────────────────────────────────────────────────────────────*/
    gear = document.createElement('button');
    gear.className = 'niyat-gear';
    gear.textContent = '🏷';
    gear.title = 'NiyaTags settings';
    gear.onclick = openSettings;
    document.body.appendChild(gear);

    const style = document.createElement('style');
    style.textContent = `
        .niya-tags-ring { position:absolute; inset:0; border-radius:inherit; pointer-events:none; z-index:1; }
        .niya-tags-chips { position:absolute; bottom:0; left:0; right:0; z-index:3; display:flex; flex-wrap:wrap; gap:3px;
            padding:4px; pointer-events:none; background:linear-gradient(transparent, rgba(0,0,0,.55)); }
        .niya-tag-chip { font:600 10px/1.2 system-ui,sans-serif; color:#fff; padding:2px 5px; border-radius:3px;
            white-space:nowrap; text-shadow:0 1px 1px rgba(0,0,0,.4); }

        /* /g/ tag control */
        .niyat-g-ctl { display:inline-flex; align-items:stretch; margin-left:4px; }
        .niyat-g-btn { display:flex; align-items:center; padding:0 7px; cursor:pointer; font-weight:800; line-height:1;
            color:#8aa; opacity:.6; user-select:none; border-radius:3px; }
        .niyat-g-btn:hover { opacity:1; }
        .niyat-g-btn.active { color:#fff; opacity:1; }

        /* group menu */
        .niyat-gmenu { position:fixed; z-index:2147483002; background:#1f2230; border:1px solid #3a3f52; border-radius:8px;
            box-shadow:0 8px 24px rgba(0,0,0,.5); padding:4px; min-width:180px; font:12px/1.3 system-ui,sans-serif; color:#eee; }
        .niyat-gmenu-row { display:flex; align-items:center; gap:8px; padding:5px 8px; border-radius:5px; cursor:pointer; }
        .niyat-gmenu-row:hover { background:#2a2e40; }
        .niyat-gmenu-row.active { background:rgba(255,255,255,.06); }
        .niyat-gmenu-dot { width:12px; height:12px; border-radius:50%; flex:none; }
        .niyat-gmenu-name { flex:1; white-space:nowrap; }
        .niyat-gmenu-check { color:#5fd67a; font-weight:700; }
        .niyat-gmenu-empty { padding:8px; color:#889; font-style:italic; }

        /* gear (above the site's own Filters button) */
        .niyat-gear { position:fixed; right:14px; bottom:70px; z-index:2147483000; width:40px; height:40px;
            border:none; border-radius:50%; background:rgba(30,30,40,.85); color:#fff; font-size:18px; cursor:pointer;
            box-shadow:0 2px 8px rgba(0,0,0,.4); }
        .niyat-gear:hover { background:rgba(50,50,70,.95); }

        /* modal */
        .niyat-overlay { position:fixed; inset:0; z-index:2147483001; background:rgba(0,0,0,.55);
            display:flex; align-items:center; justify-content:center; font:13px/1.4 system-ui,sans-serif; color:#eee; }
        .niyat-panel { width:660px; max-width:94vw; max-height:88vh; overflow:auto; background:#1f2230; border:1px solid #3a3f52;
            border-radius:10px; box-shadow:0 10px 40px rgba(0,0,0,.5); }
        .niyat-head { display:flex; justify-content:space-between; align-items:center; padding:12px 16px;
            border-bottom:1px solid #3a3f52; font-weight:700; font-size:15px; }
        .niyat-close { background:none; border:none; color:#aaa; font-size:16px; cursor:pointer; }
        .niyat-body { padding:14px 16px; }
        .niyat-row { display:flex; align-items:center; gap:8px; }
        .niyat-hint { color:#9aa; font-size:11px; margin:4px 0 12px; }
        .niyat-opt { font-size:12px; margin:4px 0; }
        .niyat-opthint { color:#889; font-size:11px; }
        .niyat-opthint code { background:#171923; padding:0 3px; border-radius:3px; }
        .niyat-addrow { display:flex; gap:8px; align-items:center; }
        .niyat-search { flex:1; min-width:0; box-sizing:border-box; padding:7px 9px; border-radius:6px; border:1px solid #3a3f52; background:#171923; color:#eee; }
        .niyat-targetlabel { flex:none; color:#9aa; font-size:11px; display:flex; align-items:center; gap:5px; }
        .niyat-target { max-width:170px; background:#171923; color:#eee; border:1px solid #3a3f52; border-radius:6px; padding:6px; }
        .niyat-results { max-height:200px; overflow:auto; margin-top:6px; }
        .niyat-result { display:flex; justify-content:space-between; align-items:center; padding:4px 6px; border-radius:5px; }
        .niyat-result:hover { background:#2a2e40; }
        .niyat-resleft { display:flex; align-items:center; gap:8px; min-width:0; }
        .niyat-restag { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .niyat-nsbadge { flex:none; font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.03em;
            color:#fff; padding:2px 5px; border-radius:3px; min-width:38px; text-align:center; }
        .niyat-addbtn { flex:none; font-size:14px; font-weight:800; padding:1px 11px; border-radius:4px; border:1px solid #3a3f52;
            background:#2a2e40; color:#eee; cursor:pointer; }
        .niyat-addbtn:hover { background:#3a4a6a; }
        .niyat-section { margin-top:16px; }
        .niyat-sechead { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
        .niyat-sechead h4 { margin:0; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:#ccd; }
        .niyat-sechead button, .niyat-foot button { font-size:12px; padding:4px 11px; border-radius:5px; border:1px solid #3a3f52;
            background:#2a2e40; color:#eee; cursor:pointer; }
        .niyat-sechead button:hover, .niyat-foot button:hover { background:#3a4a6a; }
        .niyat-group { border:1px solid #3a3f52; border-radius:8px; padding:8px; margin-bottom:8px; }
        .niyat-group-head { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
        .niyat-group-head input[type=color] { width:28px; height:24px; border:none; background:none; cursor:pointer; flex:none; padding:0; }
        .niyat-group-name { flex:1; min-width:0; background:#171923; color:#eee; border:1px solid #3a3f52; border-radius:5px; padding:4px 8px; }
        .niyat-group-del { flex:none; background:none; border:none; color:#c66; font-size:13px; cursor:pointer; }
        .niyat-group-tags { display:flex; flex-wrap:wrap; gap:5px; }
        .niyat-empty { color:#778; font-style:italic; }
        .niyat-editchip { display:inline-flex; align-items:center; gap:5px; color:#fff; padding:2px 4px 2px 7px; border-radius:4px; font-size:11px; font-weight:600; }
        .niyat-editchip button { background:rgba(0,0,0,.25); border:none; color:#fff; cursor:pointer; border-radius:3px; line-height:1; padding:1px 4px; }
        .niyat-foot { display:flex; align-items:center; gap:12px; padding:10px 16px; border-top:1px solid #3a3f52; }
        .niyat-status { color:#9aa; font-size:11px; }
    `;
    document.head.appendChild(style);

    /*───────────────────────────────────────────────────────────────────────╗
    │  Cross-tab sync + SPA keep-up                                            │
    ╚───────────────────────────────────────────────────────────────────────*/
    if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(CFG_KEY, (name, oldV, newV, remote) => {
            if (!remote) return;
            cfg = loadCfg();
            applyToCards();
            if (isGalleryPage() && cfg.enabled) decorateGalleryTags();
        });
    }

    let pending = null;
    function scheduleApply() {
        if (pending) return;
        pending = setTimeout(() => { pending = null; applyToCards(); }, 200);
    }
    new MutationObserver(scheduleApply).observe(document.documentElement, { childList: true, subtree: true });

    let lastPath = location.pathname;
    setInterval(() => { if (location.pathname !== lastPath) { lastPath = location.pathname; applyToCards(); } }, 1200);

    applyToCards();
})();
