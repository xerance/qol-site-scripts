# qol-site-scripts

A small collection of quality-of-life userscripts for a few sites — tracking **what you've
already seen** (visited items, timestamps, update flags, a personal tag system) and getting
rid of annoyances like popunder ads.

All are plain userscripts for **Violentmonkey / Tampermonkey**. They store everything
client-side (your userscript manager / the site's `localStorage`) and need no account or
server of their own.

## Scripts

### NiyaVisited — `niya-visited.user.js`
For **niyaniya.moe / hdoujin.org / shupogaki.moe**. Highlights galleries you've opened and
shows a "last viewed" timestamp on each card. History is shared across the niyaniya/shupogaki
mirrors (hdoujin is tracked separately, as it has its own ids).
→ details in [README-niya.md](README-niya.md)

### NiyaTags — `niya-tags.user.js`
Companion to NiyaVisited: your own "My Tags" system. Organize tags into any number of
**highlight** and **warn** groups (each with a colour), and matching galleries get coloured
chips + a ring. Includes on-page tagging, a searchable picker backed by the site's tag API,
and visible-first loading.
→ details in [README-niya.md](README-niya.md)

### F95Visited — `f95-visited.user.js`
For **f95zone.to** (the Latest Updates / SAM grid). **Fades games you've opened** so unseen
ones pop, shows a "last viewed" timestamp, and flags games with an **⬆ UPDATE** badge when
their version is newer than the one you last saw.
→ details in [README-f95.md](README-f95.md)

### CumstVisited — `cumst-visited.user.js`
For **cum.st** (OnlyHaven). **Fades posts, DMs and creators you've opened** so unseen ones pop
out of the grid, and shows a "last viewed" timestamp on each card. Posts and DMs are keyed by
their own ids, so they stay marked wherever they turn up (global feed, creator page, tags,
search). A **"Hide visited" button** in the site's own toolbar (or `Alt`+`V`) hides them
entirely, leaving only what you haven't opened.
→ details in [README-cumst.md](README-cumst.md)

### CumstNoPopunders — `cumst-no-popunders.user.js`
For **cum.st** (OnlyHaven). Stops the ExoClick "popMagic" popunder that opens an ad window
when you click a gallery card. It blocks the ad loader script, only lets `window.open` open
cum.st URLs, cancels script-generated clicks/form submits to other sites, and keeps your real
clicks on site links away from the ad script's listeners so galleries open in the same tab
(Ctrl/middle-click still open a new tab). Trade-off: navigation does full page loads instead of
the site's in-page routing.

### CumstVideoViewer — `cumst-video-viewer.user.js`
For **cum.st** (OnlyHaven) post pages. In the video viewer, **double-click toggles
fullscreen**, and the viewer **only closes with its X button**: clicks on the dark margin
around the player and the Escape key no longer close it (Escape still leaves fullscreen).
A single click still plays/pauses. On desktop, double-clicking the left/right side no longer
seeks ±10s; double-tap seeking on touch screens is unchanged.

## Install

1. Install **Violentmonkey** or **Tampermonkey**.
2. For each script you want: open its `.user.js`, copy the contents into a new script in the
   manager, and save. (They're independent — install any subset.)
3. Visit the relevant site; the features appear on the listing pages.

See each script's README for settings, storage keys, and how to clear history.
