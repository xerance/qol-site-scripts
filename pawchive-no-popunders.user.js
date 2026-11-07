// ==UserScript==
// @name         PawchiveNoPopunders
// @namespace    https://github.com/xerance/qol-site-scripts
// @version      1.0.0
// @description  pawchive.pw: stops the popunder ad window that opens when you click a card, and any other script-driven off-site window or redirect.
// @match        *://pawchive.pw/*
// @match        *://*.pawchive.pw/*
// @author       xerance
// @license      MIT
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /*───────────────────────────────────────────────────────────────────────╗
    │  Settings                                                                │
    ╚───────────────────────────────────────────────────────────────────────*/
    // Last resort. Cuts every other click listener off a click on a site link
    // and navigates there itself. It works, but it also takes the site's own
    // in-page navigation (hx-boost) out of the loop, so every click becomes a
    // full page load. Only turn it on if an ad still gets through.
    const HARD_CLICK_SHIELD = false;
    const LOG = false; // console.debug what was blocked

    const SITE   = /(^|\.)pawchive\.pw$/i;
    // The ad domains are throwaway names that rotate, so these are a
    // convenience, not the defence — see `data-clocid` below and the
    // window.open gate, which don't care what the domain is called.
    const AD_SRC = /excavatenearbywand|clotion\.shop|exoclick|exosrv|exacdn|realsrv|magsrv|popunder|popmagic|tsyndicate|juicyads|adsterra|trafficjunky|propeller|onclickads/i;

    const isSiteUrl = u => {
        try {
            const url = new URL(u, location.href);
            return url.protocol === 'javascript:' ? false : SITE.test(url.hostname);
        } catch (e) { return false; }
    };
    const log = (...a) => { if (LOG) console.debug('[pawchive-nopop]', ...a); };

    /*───────────────────────────────────────────────────────────────────────╗
    │  1. The loader                                                           │
    │                                                                          │
    │  The page carries a small inline injector that does, in effect:          │
    │                                                                          │
    │      var sc = document.createElement('script');                          │
    │      sc.async = true;                                                    │
    │      sc.setAttribute('data-cfasync', 'false');                           │
    │      sc.setAttribute('data-clocid', '…');                                │
    │      sc.src = '//<throwaway-domain>/on.js';                              │
    │      sc.onload = sc.onerror = function () { <fallback>(15) };            │
    │      parent.insertBefore(sc, …);                                         │
    │                                                                          │
    │  Two things follow. First, it's inserted by script, not by the parser,   │
    │  so it can be caught before it ever loads. Second — and this is why a    │
    │  plain blocklist isn't enough — the fallback runs from `onerror` too, so │
    │  merely blocking the REQUEST still starts the ad engine. Dropping the    │
    │  element before it's inserted fires neither handler.                     │
    ╚───────────────────────────────────────────────────────────────────────*/
    const isAdScript = el => {
        if (!el || el.tagName !== 'SCRIPT') return false;
        // The site's own injector stamps this on the ad script and nothing
        // else, so it keeps working when the domain changes next week.
        if (el.hasAttribute && el.hasAttribute('data-clocid')) return true;
        const src = el.src || (el.getAttribute && el.getAttribute('src')) || '';
        return !!src && AD_SRC.test(src);
    };

    const neuter = el => {
        if (!isAdScript(el)) return false;
        const what = el.src || el.getAttribute('src') || '[inline]';
        // Clear the handlers first: `onerror` is the fallback's second way in,
        // and removing a half-inserted script can fire it.
        try { el.onload = null; el.onerror = null; } catch (e) {}
        try { el.type = 'javascript/blocked'; } catch (e) {}
        try { el.removeAttribute('src'); } catch (e) {}
        try { el.remove(); } catch (e) {}
        log('blocked script', what);
        return true;
    };

    new MutationObserver(muts => {
        for (const m of muts) for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            neuter(n);
            if (n.querySelectorAll) n.querySelectorAll('script').forEach(neuter);
        }
    }).observe(document.documentElement, { childList: true, subtree: true });

    // The observer only runs after the node is in the document, which for a
    // script with a src is already too late to stop the fetch — so intercept
    // the insertion itself and drop the node before it lands.
    for (const fn of ['appendChild', 'insertBefore', 'append', 'prepend', 'replaceChild']) {
        const proto = Node.prototype[fn] ? Node.prototype : Element.prototype;
        const orig = proto[fn];
        if (!orig) continue;
        proto[fn] = function (...args) {
            let blocked = false;
            for (const a of args) if (a && a.nodeType === 1 && isAdScript(a)) { neuter(a); blocked = true; }
            if (!blocked) return orig.apply(this, args);
            // insertBefore/replaceChild are contracted to return the node, and
            // the injector ignores it, so hand back the (now inert) script.
            const kept = args.filter(a => !(a && a.nodeType === 1 && a.type === 'javascript/blocked'));
            if (!kept.length) return args[0];
            try { return orig.apply(this, kept); } catch (e) { return args[0]; }
        };
    }

    /*───────────────────────────────────────────────────────────────────────╗
    │  2. window.open — the popunder itself.                                   │
    │                                                                          │
    │  This is the part that actually matters. The inline bootstrap that       │
    │  defines the fallback engine is written into the HTML by the server, so  │
    │  it runs no matter what gets blocked above; what it can't do is open a   │
    │  window. Only same-site URLs get through, and everything else is handed  │
    │  a dummy window object so the caller carries on without throwing.        │
    ╚───────────────────────────────────────────────────────────────────────*/
    const fakeWin = () => {
        const w = {
            closed: true, close() {}, focus() {}, blur() {}, postMessage() {},
            document: { write() {}, writeln() {}, close() {}, open() {} }
        };
        w.location = { href: 'about:blank', replace() {}, assign() {}, reload() {}, toString: () => 'about:blank' };
        w.opener = null;
        w.open = () => fakeWin();
        return w;
    };

    const patchOpen = win => {
        try {
            const origOpen = win.open;
            if (!origOpen || origOpen.__nopop) return;
            const wrapped = function (url, ...rest) {
                if (url && isSiteUrl(url)) return origOpen.call(this, url, ...rest);
                log('blocked window.open', url);
                return fakeWin();
            };
            wrapped.__nopop = true;
            wrapped.toString = () => 'function open() { [native code] }';
            win.open = wrapped;
        } catch (e) {}
    };
    patchOpen(window);

    // Ad scripts routinely reach into a fresh iframe for an unpatched
    // window.open, so patch it on the way out of contentWindow too.
    try {
        const cwDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
        if (cwDesc && cwDesc.get) {
            Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', Object.assign({}, cwDesc, {
                get() { const w = cwDesc.get.call(this); if (w) patchOpen(w); return w; }
            }));
        }
    } catch (e) {}

    /*───────────────────────────────────────────────────────────────────────╗
    │  3. The other ways a script can send you off-site: clicking a link or    │
    │     submitting a form it made itself, or assigning to location.          │
    ╚───────────────────────────────────────────────────────────────────────*/
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
        if (this.href && !isSiteUrl(this.href)) { log('blocked anchor.click', this.href); return; }
        return origClick.call(this);
    };

    const origSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
        if (this.action && !isSiteUrl(this.action)) { log('blocked form.submit', this.action); return; }
        return origSubmit.call(this);
    };

    /*───────────────────────────────────────────────────────────────────────╗
    │  4. Clicks.                                                              │
    │                                                                          │
    │  A synthetic click on an off-site link is never something you did, so    │
    │  it's cancelled outright. Your own clicks are left alone by default:     │
    │  the gates above already cover the popunder, and the site navigates with │
    │  hx-boost, which a heavier shield would break. HARD_CLICK_SHIELD turns   │
    │  the heavier version on.                                                 │
    ╚───────────────────────────────────────────────────────────────────────*/
    const shield = e => {
        const a = e.target && e.target.closest && e.target.closest('a[href]');
        if (!a) return;

        if (!e.isTrusted) {
            if (!isSiteUrl(a.href)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                log('blocked synthetic click', a.href);
            }
            return;
        }

        if (!HARD_CLICK_SHIELD) return;
        if (!isSiteUrl(a.href)) return;                                  // a real external link you clicked
        if (e.target.closest('button, [role="button"], input, label')) return; // in-card controls
        e.stopImmediatePropagation();
        if (e.type === 'click' && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            location.assign(a.href); // same tab, even if something set target=_blank
        }
    };
    for (const t of ['click', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) {
        window.addEventListener(t, shield, { capture: true, passive: false });
    }
})();
