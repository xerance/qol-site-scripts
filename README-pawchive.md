# PawchiveVisited

A userscript for **pawchive.pw** — "last viewed" tracking for the post and creator
listings, in the spirit of NiyaVisited, F95Visited and CumstVisited.

## What it does

- **Fades posts you've already opened** — visited thumbnails are dimmed + desaturated so
  unseen ones pop out of the grid, and the card's title bar and footer are dimmed more
  gently so they stay readable. Hovering a faded card eases it all back so you can still
  look.
- **Fades creator cards you've already opened** on `/artists`. They're text over a banner
  *background image*, which no filter on an `<img>` would touch, so the whole card is faded
  with opacity instead.
- **"Last viewed" timestamp** on every visited card (`👁 3h`), in the top-right corner — a
  post card's title sits top-left and its date and service icon run along the bottom. Hover
  it for the full date.
- **A "Hide visited" button hides them entirely**, leaving only what you haven't opened.
  Its label says what a click will do and how many visited cards are on the page
  (`👁 Hide visited (12)`), it turns blue while hiding is on, and it stays out of the way
  when there's nothing visited to hide. On narrow screens it shrinks to just the eye.
- **`Alt`+`V` does the same from the keyboard** (ignored while you're typing in a search
  box). Either way the setting is remembered across pages and tabs.

Works on every listing that shows these cards: `/posts`, `/posts/popular`, `/posts/tags`,
`/artists`, `/artists/updated`, `/artists/random`, `/favorites`, a creator's own page, and
search results.

## How it works

- Everything tracked lives under `/{service}/user/…`, and each is keyed by its **stable id**:

  | URL | key |
  | --- | --- |
  | `/patreon/user/22721799` | `creator:patreon:22721799` |
  | `/patreon/user/22721799/post/174678536` | `post:patreon:174678536` |
  | `/fanbox/user/37736420` | `creator:fanbox:37736420` |

  A post is keyed **without** its creator id, since the id is already unique within a
  service — so a post stays marked wherever it turns up (the global feed, the creator's
  page, a tag listing, search). The pattern is anchored to the start of the path, which
  keeps the site's own pages (`/posts`, `/artists`, `/favorites`, `/importer` …) out of it,
  and user ids are matched loosely because they're numeric on Patreon and Fanbox but not on
  every service.
- A visit is recorded **two ways**: when you **click a card** (instant, and it covers
  middle/ctrl-clicks into a new tab), and when you **land on** a post or creator page,
  including a link followed from outside the site. Only real cards count — the creator name
  printed inside a DM or a comment is a bare text link and is left alone, and so are clicks
  the site's popunder ad script dispatches by itself.
- Data lives in your **userscript manager's** storage (`GM_setValue`) under
  `pawchive-visited`, as a `{ "kind:service:id": timestamp }` map — so it survives the site
  clearing its own storage. Without the GM grants it falls back to the site's `localStorage`
  under the same key. The hide toggle is a second, separate value, `pawchive-visited-hide`.
- Tabs stay in sync: a post opened in a second tab records there, and the listing behind it
  repaints without a reload.
- **Where the button goes.** Pawchive's listings don't share a toolbar — `/posts` has a
  search bar, `/artists` a filter form, a creator's page neither — so rather than hunting for
  a different control row on every route, the button gets a slim right-aligned bar of its
  own, inserted directly above the top paginator (or the card list, on a page with no
  paginator). That anchor exists on every listing, so the button lands in the same place
  everywhere. It's styled after the site's own search box. On a page with no listing at all
  (a post page, say) it falls back to a floating pill in the bottom-right corner, and since
  there's nothing there to hide, it stays hidden unless hiding is already on.
- The site is mostly server-rendered, so navigation is a full page load — but `/artists`
  builds its grid in the browser and a creator's search swaps its card list out, so a
  debounced `MutationObserver` repaints the marks and re-homes the button, and a 1s interval
  keeps the relative times fresh.

## Settings

At the top of the script:

| Constant | Default | What it does |
| --- | --- | --- |
| `FADE_FILTER` | `grayscale(0.75) brightness(0.45)` | how much visited thumbnails are dimmed |
| `HOVER_FILTER` | `grayscale(0.15) brightness(0.9)` | eased-back filter on hover |
| `DIM_TITLE` | `0.55` | fade for a visited post card's title and footer |
| `USER_OPACITY` / `USER_HOVER` | `0.45` / `0.9` | fade for visited creator cards |
| `BADGE_BG` / `BADGE_FG` | blue / white | the timestamp pill's colours |
| `TRACK_CREATORS` | `true` | set `false` to track only posts, not creator pages |
| `SHOW_BUTTON` | `true` | set `false` to drop the button and use only the shortcut |
| `BUTTON_IN_BAR` | `true` | set `false` to float the button in the bottom-right corner instead of putting it above the listing |
| `HIDE_KEY` | `'v'` | the key `Alt` is held with to hide/show visited cards; `''` disables the shortcut |

## Install

1. Have Violentmonkey/Tampermonkey installed.
2. Add `pawchive-visited.user.js` as a new script and save.
3. Open `/posts` and click around — cards you've opened come back faded with a timestamp.

Note that pawchive runs a popunder ad script, so a click on a card can open an ad window.
The script ignores the synthetic clicks that script makes, but it doesn't block the ads
themselves — an ad blocker, or something like **CumstNoPopunders** adapted to this site,
handles that side.

## Clearing history

Open the console (F12) on pawchive.pw and run:

```js
// if installed with the GM grants (the normal case), clear it from the
// userscript manager's own storage: Violentmonkey/Tampermonkey → the script →
// "Values" / "Storage" tab → delete the `pawchive-visited` entry.

// if it fell back to localStorage:
localStorage.removeItem('pawchive-visited');
```

To forget a single item instead, delete just its key from that map.
