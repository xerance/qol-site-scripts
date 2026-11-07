# SubtitleCatLangFilter — `subtitlecat-lang-filter.user.js`

For **subtitlecat.com** subtitle pages (e.g. `/subs/1324/<title>.html`), which list ~150
languages in one long grid. This adds a **floating "🌐 Languages" button in the bottom-right
corner**; it opens a filter panel that hides the languages you don't care about.

## What it does

- **Pick the languages you want.** Tick them in the panel and the grid shows only those.
  With nothing ticked the page is untouched — all languages visible, nothing to undo.
- **"Only languages with a subtitle"** hides every row that still says *Translate*, so you
  see just the ones with a ready **Download** (SRT). Works on its own or together with your
  language picks.
- **Your picks are remembered** across pages and visits (per browser), so every subtitle page
  opens already filtered.
- The button shows **`shown/total`** and turns yellow while a filter is active, so you always
  know the list is trimmed.

## The panel

| Control | What it does |
| --- | --- |
| Search box | Filters the language list in the panel (matches the name or the language code, e.g. `pt` or `Portuguese`). |
| Only languages with a subtitle | Hides rows that have no SRT yet. |
| **Pick listed** | Ticks every language the search currently shows — type `span`, click once, done. Note it's a plain substring match, so `eng` also matches *Bengali*. |
| **Pick all with SRT** | Ticks every language that already has a downloadable subtitle on this page. |
| **Show all** | Unticks everything — back to the full list. |
| `SRT` / `—` | Marks whether that language already has a subtitle, or still needs translating. |

Close the panel with its ×, with `Escape`, or by clicking anywhere outside it.

## Notes

- Hiding is pure CSS on the grid column, so nothing about the page's own behaviour changes:
  Translate and Download still work exactly as before on the rows you keep.
- When a translation finishes, the site turns that row's *Translate* button into a *Download*
  link. The script watches for that and re-applies the filter, so the SRT marker and the
  "only with a subtitle" option stay accurate without a reload.
- If you pick languages that this particular page doesn't list, nothing breaks — the picks
  are stored by language code and simply don't match here.

## Storage

Everything lives in `localStorage` on subtitlecat.com under one key:

| Key | Contents |
| --- | --- |
| `scLangFilter.v1` | `{"langs": ["en","ja"], "onlyTranslated": false}` |

To reset, click **Show all** and untick the SRT option, or run in the console on
subtitlecat.com:

```js
localStorage.removeItem('scLangFilter.v1');
```
