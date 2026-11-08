# F95Visited

A userscript for **f95zone.to** — "last viewed" tracking for the **Latest Updates (SAM)**
game grid, in the spirit of NiyaVisited.

## What it does

- **Fades games you've opened** — visited covers are dimmed + desaturated so unseen games
  pop. Hovering a faded card eases it back so you can still look. Each shows an eye badge.
- **"Last viewed" timestamp** on each visited card (`👁 3h`).
- **"⬆ UPDATE" flag** — if a game's version on the Latest page is newer than the version you
  saw last time, the card **stays full colour** with an **orange ring + UPDATE badge** so it
  stands out among the faded ones. Opening it again clears it.

## How it works

- Each game is keyed by its **thread id** (the stable number, e.g. `281153`), so it keeps
  working even though the thread URL's title/version slug changes on every update.
- A visit is recorded **two ways**: when you **click a card** on the Latest page (instant),
  and when you **open a thread page** `/threads/…` from anywhere (so it's marked however you
  got there). Threads open in new tabs — the two tabs stay in sync via the browser's storage
  events.
- At each visit it also stores the **version** you saw (from the card's version label, or the
  thread title's `[v…]`). The UPDATE flag compares that to the version currently shown.
- Data lives in `localStorage` under `f95-visited` (`{ threadId: { t: lastViewed, v:
  version } }`) — purely client-side. It needs you logged in only because the pages do; the
  script itself never touches your login.

## Install

[**Install F95Visited**](https://raw.githubusercontent.com/xerance/qol-site-scripts/master/f95-visited.user.js) — open that link with Violentmonkey or Tampermonkey
installed and it will offer to install the script. Installing from the link registers
the script's update URL, so later fixes show up as an update prompt rather than needing a re-paste.

You can also save the file and use your manager's "install from file" option, or paste the
contents into a new script.

Then log into f95zone, open **Latest Updates** and click some games — they'll be highlighted
with timestamps, and ones that have updated since you saw them get the UPDATE flag.

## Clearing history

Open the console (F12) on f95zone and run:

```js
localStorage.removeItem('f95-visited')
```

## Notes / limits

- Covers the SAM pages (`/sam/*`) for display and `/threads/*` for recording.
- The UPDATE flag matches the version string as shown. If the Latest card and the thread
  title format a version differently, it could briefly show UPDATE once — it self‑clears the
  next time you open that game. Fade strength / colours are editable in the Settings block at
  the top (`FADE_FILTER`, `HOVER_FILTER`, `UPDATE_BG`). The fade uses `!important` because the
  site transitions the thumb's own filter.
- If the site changes its HTML, the card selector (`.resource-tile` /
  `a.resource-tile_link`) or version label (`.resource-tile_label-version`) may need updating.
