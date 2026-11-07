// ==UserScript==
// @name         CumstVideoViewer
// @namespace    https://github.com/xerance/qol-site-scripts
// @version      1.0.0
// @description  cum.st video viewer: double-click toggles fullscreen, and the viewer only closes with its X button (no more closing on a stray click or Escape).
// @author       xerance
// @match        *://cum.st/*
// @match        *://*.cum.st/*
// @run-at       document-start
// @grant        none
// @license      MIT
// @downloadURL https://raw.githubusercontent.com/xerance/qol-site-scripts/master/cumst-video-viewer.user.js
// @updateURL   https://raw.githubusercontent.com/xerance/qol-site-scripts/master/cumst-video-viewer.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VIEWER = '[role="dialog"][aria-label="Video player"]';
  const viewerOf = (el) => (el && el.closest ? el.closest(VIEWER) : null);

  // The site closes the viewer when a click lands on the dark margin around the
  // player (target === the dialog itself). Swallow those before Svelte's
  // delegated handler sees them. The real X button lives outside the dialog,
  // so it is unaffected.
  window.addEventListener('click', (e) => {
    if (e.target && e.target.matches && e.target.matches(VIEWER)) e.stopImmediatePropagation();
  }, true);

  // Mouse clicks on the video: the site's double-tap-seek plugin would turn the
  // two clicks of a double-click on the left/right third into a ±10s seek, so
  // keep them from it and do video.js' click-to-play/pause ourselves. Both
  // clicks of a double-click toggle, so the play state ends up unchanged.
  // Touch taps are left alone (double-tap seek still works on phones).
  window.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || t.tagName !== 'VIDEO' || !viewerOf(t) || e.pointerType === 'touch') return;
    e.stopImmediatePropagation();
    const p = t.closest('.video-js') && t.closest('.video-js').player;
    const paused = p ? p.paused() : t.paused;
    if (paused) {
      const r = p ? p.play() : t.play();
      if (r && r.catch) r.catch(() => {});
    } else {
      p ? p.pause() : t.pause();
    }
  }, true);

  // Double-click anywhere in the viewer toggles fullscreen on the player
  // (the site disables video.js' own double-click and uses double-tap seek).
  window.addEventListener('dblclick', (e) => {
    const dlg = viewerOf(e.target);
    if (!dlg) return;
    if (e.target.closest('.vjs-control-bar, .vjs-menu, .vjs-modal-dialog')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const el = dlg.querySelector('.video-js');
    if (!el) return;
    const p = el.player;
    if (p && typeof p.isFullscreen === 'function') {
      p.isFullscreen() ? p.exitFullscreen() : p.requestFullscreen();
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  }, true);

  // Escape no longer closes the viewer (it still leaves fullscreen, which the
  // browser handles itself). Escape inside an open video.js menu still works.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || document.fullscreenElement) return;
    if (!document.querySelector(VIEWER)) return;
    if (e.target && e.target.closest && e.target.closest('.vjs-menu, .vjs-modal-dialog')) return;
    e.stopImmediatePropagation();
  }, true);
})();
