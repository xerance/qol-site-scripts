# CumstVisited

A userscript for **cum.st** (OnlyHaven) — "last viewed" tracking for the post, DM and creator
listings, in the spirit of NiyaVisited and F95Visited.

## What it does

- **Fades posts and DMs you've already opened** — visited thumbnails are dimmed +
  desaturated so unseen ones pop out of the grid. Hovering a faded card eases it back so you
  can still look.
- **Fades creator rows you've already opened** on `/creators` (the rows are mostly text over a
  header image, so they're faded with opacity rather than a filter).
- **"Last viewed" timestamp** on every visited card (`👁 3h`), in the top-right corner — the
  site's own OnlyFans/Fansly badge sits at the top-left. Hover it for the full date.
- **A "Hide visited" button hides them entirely**, leaving only what you haven't opened. It
  sits in the site's own toolbar, right next to **Filters**, built from the site's theme
  tokens so it matches that button in both light and dark. Its label says what a click will
  do and how many visited cards are on the page (`👁 Hide visited (12)`), it turns the site's
  accent blue while hiding is on, and it stays out of the way when there's nothing visited to
  hide. On narrow screens it shrinks to just the eye.
- **`Alt`+`V` does the same from the keyboard** (ignored while you're typing in the search
  box). Either way the setting is remembered across pages and tabs.

Works on every listing that shows these cards: `/posts`, `/posts/popular`, `/posts/tags`,
`/dms`, `/dms/popular`, `/creators`, `/creators/recent`, a creator's own page, search results
and tag pages.

## How it works

- Everything tracked lives under `/creators/…`, and each is keyed by its **stable id**:

  | URL | key |
  | --- | --- |
  | `/creators/onlyfans/32696630` | `creator:onlyfans:32696630` |
  | `/creators/onlyfans/85427154/post/2870973120` | `post:onlyfans:2870973120` |
  | `/creators/onlyfans/563628960/dm/a4753473-…` | `dm:onlyfans:a4753473-…` |

  Posts and DMs are keyed **without** the creator id, since their own ids are already unique —
  so a post stays marked wherever it turns up (the global feed, the creator's page, a tag
  listing, search).
- A visit is recorded **two ways**: when you **click a card** (instant, and it covers
  middle/ctrl-clicks into a new tab), and when you **land on** a post / DM / creator page from
  anywhere, including the site's own in-page navigation.
- Data lives in your **userscript manager's** storage (`GM_setValue`) under `cumst-visited`, as
  a `{ "kind:platform:id": timestamp }` map — so it survives the site clearing its own storage
  and is shared across `cum.st` subdomains. Without the GM grants it falls back to the site's
  `localStorage` under the same key. The hide toggle is a second, separate value,
  `cumst-visited-hide`.
- Tabs stay in sync: a post opened in a second tab records there, and the listing behind it
  repaints without a reload.
- The site is a Svelte app that re-renders the grid on paging and filtering, so a debounced
  `MutationObserver` repaints the marks, and a 1s interval keeps the relative times fresh.
  That re-render also rebuilds the toolbar and throws the button out with it, so the button is
  re-homed whenever it's found adrift. If the toolbar ever isn't there, it falls back to a
  floating pill in the bottom-right corner rather than disappearing.

## Settings

At the top of the script:

| Constant | Default | What it does |
| --- | --- | --- |
| `FADE_FILTER` | `grayscale(0.75) brightness(0.45)` | how much visited thumbnails are dimmed |
| `HOVER_FILTER` | `grayscale(0.15) brightness(0.9)` | eased-back filter on hover |
| `ROW_OPACITY` / `ROW_HOVER` | `0.5` / `0.9` | fade for visited creator rows |
| `BADGE_BG` / `BADGE_FG` | the site's accent blue / white | the timestamp pill's colours |
| `TRACK_CREATORS` | `true` | set `false` to track only posts and DMs |
| `SHOW_BUTTON` | `true` | set `false` to drop the button and use only the shortcut |
| `BUTTON_IN_BAR` | `true` | set `false` to float the button in the bottom-right corner instead of putting it in the site's toolbar |
| `HIDE_KEY` | `'v'` | the key `Alt` is held with to hide/show visited cards; `''` disables the shortcut |

## Install

[**Install CumstVisited**](https://raw.githubusercontent.com/xerance/qol-site-scripts/master/cumst-visited.user.js) — open that link with Violentmonkey or Tampermonkey
installed and it will offer to install the script. Installing from the link registers
the script's update URL, so later fixes show up as an update prompt rather than needing a re-paste.

You can also save the file and use your manager's "install from file" option, or paste the
contents into a new script.

Then open `/posts` and click around — cards you've opened come back faded with a timestamp.

Pairs well with [**CumstNoPopunders**](https://raw.githubusercontent.com/xerance/qol-site-scripts/master/cumst-no-popunders.user.js) — without it, a click
on a card can be stolen by the site's popunder ad. Either way, only a click you
actually made counts: the synthetic clicks that ad script dispatches are ignored,
so they can't record a visit or flip the hide toggle on you.

## Clearing history

Open the console (F12) on cum.st and run:

```js
// if installed with the GM grants (the normal case), clear it from the
// userscript manager's own storage: Violentmonkey/Tampermonkey → the script →
// "Values" / "Storage" tab → delete the `cumst-visited` entry.

// if it fell back to localStorage:
localStorage.removeItem('cumst-visited');
```

To forget a single item instead, delete just its key from that map.
