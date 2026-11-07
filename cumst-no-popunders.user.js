// ==UserScript==
// @name         CumstNoPopunders
// @namespace    https://github.com/xerance/qol-site-scripts
// @version      1.0.0
// @description  Stops the ExoClick "popMagic" popunder and any script-driven off-site windows/redirects when opening galleries.
// @match        *://cum.st/*
// @match        *://*.cum.st/*
// @author       xerance
// @license      MIT
// @run-at       document-start
// @grant        none
// @downloadURL https://raw.githubusercontent.com/xerance/qol-site-scripts/master/cumst-no-popunders.user.js
// @updateURL   https://raw.githubusercontent.com/xerance/qol-site-scripts/master/cumst-no-popunders.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SITE = /(^|\.)cum\.st$/i;
  const AD_SRC = /exacdn|exoclick|exosrv|realsrv|magsrv|popunder|popmagic|tsyndicate|juicyads|adsterra|trafficjunky/i;

  const isSiteUrl = (u) => {
    try {
      const url = new URL(u, location.href);
      return url.protocol === 'javascript:' ? false : SITE.test(url.hostname);
    } catch { return false; }
  };
  const log = (...a) => console.debug('[nopop]', ...a);

  // 1. Kill ad loader scripts before they execute (parser-inserted and dynamic).
  const neuter = (el) => {
    if (el.tagName !== 'SCRIPT') return;
    const src = el.src || el.getAttribute('src') || '';
    if ((src && AD_SRC.test(src)) || el.id === 'popmagicldr' || el.hasAttribute('data-msg-idzone')) {
      el.type = 'javascript/blocked';
      el.removeAttribute('src');
      el.remove();
      log('blocked script', src || el.id);
    }
  };
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      neuter(n);
      if (n.querySelectorAll) n.querySelectorAll('script').forEach(neuter);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  for (const fn of ['appendChild', 'insertBefore', 'append', 'prepend']) {
    const orig = Node.prototype[fn] || Element.prototype[fn];
    if (!orig) continue;
    const target = Node.prototype[fn] ? Node.prototype : Element.prototype;
    target[fn] = function (...args) {
      args.forEach((a) => a && a.tagName === 'SCRIPT' && neuter(a));
      return orig.apply(this, args.filter((a) => !(a && a.tagName === 'SCRIPT' && a.type === 'javascript/blocked')));
    };
  }

  // 2. window.open: only same-site URLs may open. Others get a harmless fake window.
  const fakeWin = () => {
    const w = { closed: true, close() {}, focus() {}, blur() {}, postMessage() {}, document: { write() {}, close() {} } };
    w.location = { href: 'about:blank', replace() {}, assign() {} };
    w.opener = null;
    return w;
  };
  const patchOpen = (win) => {
    try {
      const origOpen = win.open;
      if (origOpen.__nopop) return;
      const wrapped = function (url, ...rest) {
        if (url && isSiteUrl(url)) return origOpen.call(this, url, ...rest);
        log('blocked window.open', url);
        return fakeWin();
      };
      wrapped.__nopop = true;
      wrapped.toString = () => 'function open() { [native code] }';
      win.open = wrapped;
    } catch {}
  };
  patchOpen(window);

  // Ad scripts sometimes grab a clean window.open from a fresh iframe.
  const cwDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    ...cwDesc,
    get() { const w = cwDesc.get.call(this); if (w) patchOpen(w); return w; },
  });

  // 3. Block synthetic clicks / form submits to off-site _blank targets.
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

  // 4. Click shield: on real clicks on site links, stop every other click
  //    listener (the popunder hooks document/body) and let the browser follow
  //    the link natively. Untrusted clicks on off-site links are cancelled.
  const shield = (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    if (!e.isTrusted) {
      if (!isSiteUrl(a.href)) { e.preventDefault(); e.stopImmediatePropagation(); log('blocked synthetic click', a.href); }
      return;
    }
    if (!isSiteUrl(a.href)) return; // user clicked a real external link; leave it alone
    if (e.target.closest('button, [role="button"], input, label')) return; // in-card controls
    e.stopImmediatePropagation();
    if (e.type === 'click' && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      // Force same-tab navigation even if something set target=_blank.
      e.preventDefault();
      location.assign(a.href);
    }
  };
  for (const t of ['click', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) {
    window.addEventListener(t, shield, { capture: true, passive: false });
  }
})();
