# NiyaVisited

A small userscript for **niyaniya.moe**, **hdoujin.org**, and **shupogaki.moe** (same site, multiple mirror domains).

It does two things, ported from the much bigger *EhxVisited* script:

1. **Highlights galleries you've already opened** — visited cards get a blue tint.
2. **Shows a "last viewed" timestamp** on each visited card (e.g. `👁 3h`, `👁 2d`).

It works everywhere cards are *listed*: the homepage rows, `/browse`, and search results.
It intentionally does **not** highlight links on a gallery's own `/g/...` page (the cover /
related items there aren't a listing). (The original script had multiple "view modes" —
those are an E‑Hentai thing; this site uses one card layout everywhere, so one style covers it.)

## How it works (short version)

- When you open a gallery page (`/g/{id}/...`), the script saves that gallery's id and
  the current time.
- On any listing, it checks each card against that saved list and adds the tint + badge.
- It also marks a card the instant you click it (left **or** middle click), so the
  highlight is already there if you hit **Back** or open it in a new tab.

History lives in your userscript manager's own storage (via `GM_setValue`/`GM_getValue`),
not in any one website. How it's shared depends on the site:

- **niyaniya.moe ↔ shupogaki.moe** are true mirrors (same backend, same gallery ids), so
  they **share one history** — open a gallery on one and it shows visited on the other.
- **hdoujin.org** uses its **own separate gallery ids**, so it's tracked independently.
  (A gallery there just isn't the "same" numbered gallery as on the mirrors.)

Under the hood every saved id is tagged with its group (`ny:` for the mirrors, `hd:` for
hdoujin) inside one store, so the two never get confused. Updates sync live between open
tabs within the same group.

> **Upgrading from v1?** v1 stored history *per domain* in each site's `localStorage`. The
> first time v2 runs on a domain, it imports that domain's old history into the shared
> store under the right group, then clears the old copy. Just visit each site once and its
> old history carries over.

## Install

[**Install NiyaVisited**](https://raw.githubusercontent.com/xerance/qol-site-scripts/master/niya-visited.user.js) — open that link with Violentmonkey or Tampermonkey
installed and it will offer to install the script. Installing from the link registers
the script's update URL, so later fixes show up as an update prompt rather than needing a re-paste.

You can also save the file and use your manager's "install from file" option, or paste the
contents into a new script.

Its companion is [**NiyaTags**](https://raw.githubusercontent.com/xerance/qol-site-scripts/master/niya-tags.user.js), installed the same way.

Then visit niyaniya.moe or hdoujin.org, open a gallery and go back to the listing — it should
be highlighted with a timestamp.

## Customizing the look

Open the script and edit the **Settings** block near the top:

```js
const HIGHLIGHT = 'rgba(2, 129, 255, 0.20)'; // tint color over visited cards
const BADGE_BG   = 'rgba(2, 129, 255, 0.85)'; // timestamp pill background
const BADGE_FG   = '#ffffff';                 // timestamp pill text color
```

To move the badge, edit the `.niya-badge` rule in the styles section (it sits at
`top: 6px; left: 32px;`, just to the right of the language flag).

## Clearing your history

The history now lives in your userscript manager, not in the page, so clear it there:

- **Violentmonkey / Tampermonkey:** open the dashboard → **NiyaVisited** → the **Storage**
  (or **Values**) tab → delete the `niya-visited` entry.

## Notes / limits

- This is a **bare** version: no hiding, no filtering, no import/export, no settings panel —
  just highlight + timestamp. Those can be added later if you want them.
- If the site ever changes its HTML structure, the card selector
  (`article a[href^="/g/"]`) may need updating.

---

# NiyaTags (companion script)

`niya-tags.user.js` is a **separate** userscript in this folder — your own "My Tags"
system (like E‑Hentai's), independent of NiyaVisited so you can install/toggle it on its
own. It marks galleries whose tags match your lists, as colored chips on the card.

## What it does

- You organize tags into **groups**. There are two kinds — **Highlight** groups (things to
  spot) and **Warn** groups (things to flag/avoid) — and you can make **as many of each as
  you like**, each with its own **name and color**.
- On listings, each card is checked against every group and shows the matching tags as
  chips **in that group's color**, plus a ring. **Precedence** (used for the ring when a
  card matches several groups): warn groups beat highlight groups, and within a kind the
  group higher in the list wins.
- Tags come from the site's **JSON API** (`/books/detail/{id}/{key}`). Since listing cards
  don't include tags, the script looks each gallery up once and **caches** it. Galleries you
  open are cached for free. The API is **strictly rate‑limited (5 req/window)**, so lookups
  run **one at a time**, honoring the `x-ratelimit-*` headers (backing off until the window
  resets and leaving a token for the site itself). A full page therefore fills in **over
  ~20 s** — but it's **visible‑first**: whatever is on screen loads first, re‑prioritized
  as you scroll, so what you're looking at fills in quickly and off‑screen cards follow.
  Nothing gets stuck tagless: a throttled response is re‑queued, not cached as empty.

## Using it

- On **listing pages**, a floating **🏷 button** sits bottom‑right, just **above the site's
  own "Filters" button**.
- On a **gallery `/g/` page**, the button appears **right‑aligned in the action row** next
  to *Copy Tags / Copy Link / Source* (the floating one is hidden there).
- Either way, click it for the settings window.

### Settings window

- Highlighting is always on — there's no master switch to forget. A gallery is only
  marked once one of your groups actually has a tag in it, so an empty setup is quiet.
- **Load on‑screen galleries first** (default on): visible cards load before off‑screen ones,
  re‑prioritized as you scroll. Turn it **off** to load strictly top‑to‑bottom instead.
- **Show namespace initial on chips** (default off): card chips prefix the namespace, e.g.
  `f:tanned` for `female:tanned`, instead of just the name. One letter where it's unique,
  longer only for first-letter clashes: `f`=female, `m`=male, `a`=artist, `l`=language,
  `o`=other, `p`=parody, `t`=tag, `u`=uploader, `mag`=magazine, `mix`=mixed, `char`=character,
  `circ`=circle, `cat`=category, `cos`=cosplayer. The chip colour still shows its group.
- **Groups:** two sections, *Highlight groups* and *Warn groups*. Use **+ Add group** to
  make as many as you want; each group has a color swatch, an editable name, a delete (✕),
  and its tag chips. That's the "how many groups" control — add/remove freely.
- **Adding tags:** type in the search box, choose the destination group in the **“Add to”**
  dropdown, then hit **+** on a result (or press Enter). The search substring‑matches real
  tag names and lists the actual namespaced tags that exist — e.g. `film` → `filming` (any
  namespace), `female:filming`, `male:filming` — each with a colored **namespace badge**.
- **Matching rule:** an entry with a namespace (`female:lolicon`) matches that exact tag; a
  bare entry (`lolicon`) matches that tag in *any* namespace.
- Where suggestions come from (cached ~weekly, per site): the tag API
  (`api.hdoujin.org` / `api.schale.network`) for real `female:`/`male:`/`mixed:` content
  tags and `artist:`/`circle:` names; the API's flat filter list for every other name
  (parody, character, …) as bare suggestions; the `/tags` page for `tag:` names; and every
  tag on galleries you've browsed (which carry the real `parody:`/`character:` namespaces).

## Adding tags from a gallery page

On any gallery's `/g/` page, each tag gets a small **＋** button (it shows **✓** and turns
the group color once the tag is in a group):

- Click it to open a **mini menu** of your groups (each with its color dot). Click a group
  to add the tag there; click again to remove it. A tag can be in **multiple** groups.
- Tags already in a group are **tinted** with that group's color right on the page (the
  highest‑precedence group's color if it's in several), so you see your picks in context.
- The ＋ buttons are on every gallery page, always: tagging is never gated behind
  another setting.

## Storage / clearing

Stored in your userscript manager (like NiyaVisited). Keys:

- `niya-tags-config` — your groups (`{id, kind, name, color, tags[]}`) and the two display
  options. Upgrading from v1.x auto‑migrates your old highlight/warn lists into a
  **Highlight 1** and **Warn 1** group, keeping their colors and tags.
- `niya-tags-cache` — cached gallery→tags (grouped `ny:`/`hd:` like visited). Wipe it with
  the **Clear tag cache** button in settings.
- `niya-tags-vocab` — the cached tag vocabulary for the picker (real API tags + `/tags`),
  per site group, auto‑refreshes weekly.

## Notes / limits

- The chip strip sits along the **bottom of the thumbnail** (above the title), clear of the
  NiyaVisited badge up top. Reposition via the `.niya-tags-chips` rule if you like.
- Suggestions for namespaces other than `tag:` depend on what you've browsed (see "Where
  suggestions come from" above) — they're not all known up front.
