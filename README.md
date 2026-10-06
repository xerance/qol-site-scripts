# visited-qol-site-scripts

A small collection of quality-of-life userscripts that track **what you've already seen**
on a few sites — visited items, timestamps, update flags, and a personal tag system.

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

## Install

1. Install **Violentmonkey** or **Tampermonkey**.
2. For each script you want: open its `.user.js`, copy the contents into a new script in the
   manager, and save. (They're independent — install any subset.)
3. Visit the relevant site; the features appear on the listing pages.

See each script's README for settings, storage keys, and how to clear history.
