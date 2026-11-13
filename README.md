# qol-site-scripts

A small collection of quality-of-life userscripts for a few sites — tracking **what you've
already seen** (visited items, timestamps, update flags, a personal tag system), cutting
long lists down to **what you actually want**, and getting rid of annoyances like popunder
ads.

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

### PawchiveVisited — `pawchive-visited.user.js`
For **pawchive.pw**. **Fades posts and creators you've opened** so unseen ones pop out of
the grid, and shows a "last viewed" timestamp on each card. Posts are keyed by their own
service id, so they stay marked wherever they turn up (global feed, a creator's page, tags,
search). A **"Hide visited" button** above the listing (or `Alt`+`V`) hides them entirely,
leaving only what you haven't opened.
→ details in [README-pawchive.md](README-pawchive.md)

### PawchiveNoPopunders — `pawchive-no-popunders.user.js`
For **pawchive.pw**. Stops the popunder ad window that opens when you click a card. The page
injects its ad loader itself and runs a fallback engine from the script's `onerror`, so
blocking the request alone doesn't help — this drops the script element *before* it's
inserted, so neither handler ever fires, and gates `window.open`, `anchor.click()` and
`form.submit()` to same-site URLs as a backstop that doesn't care what the ad domain is
called this week. Your own clicks are left alone, so the site's in-page navigation still
works; a heavier click shield is there behind a setting if an ad ever gets through.

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

### SubtitleCatLangFilter — `subtitlecat-lang-filter.user.js`
For **subtitlecat.com** subtitle pages. Adds a **floating "🌐 Languages" button in the
bottom-right corner** that opens a filter panel: tick the languages you want and the ~150-row
grid shows only those, or flip **"only languages with a subtitle"** to hide every row that
still needs translating. Your picks are remembered across pages and visits, and the button
shows how many of the languages are still on screen.
→ details in [README-subtitlecat.md](README-subtitlecat.md)

## Install

1. Install **Violentmonkey** or **Tampermonkey**.
2. Click the install link for each script you want. Your manager will offer to install it.

| Script | Site | Version | |
| --- | --- | --- | --- |
| NiyaVisited | niyaniya.moe / hdoujin.org / shupogaki.moe | 2.1.3 | [install](https://raw.githubusercontent.com/xerance/qol-site-scripts/master/niya-visited.user.js) |
| NiyaTags | niyaniya.moe / hdoujin.org / shupogaki.moe | 2.3.3 | [install](https://raw.githubusercontent.com/xerance/qol-site-scripts/master/niya-tags.user.js) |
| F95Visited | f95zone.to | 1.1.0 | [install](https://raw.githubusercontent.com/xerance/qol-site-scripts/master/f95-visited.user.js) |
| CumstVisited | cum.st | 1.3.4 | [install](https://raw.githubusercontent.com/xerance/qol-site-scripts/master/cumst-visited.user.js) |
| CumstNoPopunders | cum.st | 1.0.0 | [install](https://raw.githubusercontent.com/xerance/qol-site-scripts/master/cumst-no-popunders.user.js) |
| CumstVideoViewer | cum.st | 1.0.0 | [install](https://raw.githubusercontent.com/xerance/qol-site-scripts/master/cumst-video-viewer.user.js) |
| PawchiveVisited | pawchive.pw | 1.0.2 | [install](https://raw.githubusercontent.com/xerance/qol-site-scripts/master/pawchive-visited.user.js) |
| PawchiveNoPopunders | pawchive.pw | 1.0.0 | [install](https://raw.githubusercontent.com/xerance/qol-site-scripts/master/pawchive-no-popunders.user.js) |
| SubtitleCatLangFilter | subtitlecat.com | 1.2.0 | [install](https://raw.githubusercontent.com/xerance/qol-site-scripts/master/subtitlecat-lang-filter.user.js) |

They're independent — install any subset. Installing from these links registers each
script's update URL, so later fixes arrive as an update prompt; saving the file and using your
manager's "install from file" option, or pasting the contents into a new script, works too.

See each script's README for settings, storage keys, and how to clear history.

## Maintaining

A version shows up in two places: the table above, and the line under each script's own
README heading. Both are generated from the `@version` headers, so after bumping a script
run:

```sh
node tools/sync-readme-versions.js
```

It rewrites whatever drifted and says what it touched; a run on an already-current tree
changes nothing. `--check` reports drift without writing and exits non-zero. Nothing is
hand-listed — scripts are found by globbing `*.user.js` and matched to a README heading by
their `@name`, so a new script is picked up as soon as it exists.

To have the check run on every commit:

```sh
cp tools/pre-commit .git/hooks/pre-commit
```

It only ever refuses a commit, never edits or stages anything for you: fix it with the
sync command above, or pass `git commit --no-verify` to skip it once.
