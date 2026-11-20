# GavelHawk Handoff

Read this first. It's written so a new agent can act from this file alone.

## What this is

GavelHawk is a Chrome MV3 extension that cuts time spent on GovDeals (govdeals.com):
watchlist dashboard, saved-search alerts, true cost (bid + premium + tax + travel),
outbid / ending-soon alerts, distance and pickup-only filters, private notes, and timed bids.
Plain JS, no build step, no dependencies. Load unpacked from the repo root.

Owner's defaults: home ZIP 34951, max travel 80 mi. These must stay user-editable
(Dashboard → Settings) because the extension will be distributed.

## Completed (v0.1.0, commit f608266)

- All six features written: `manifest.json`, `src/background.js`, `src/shared/cost.js`,
  `src/content/{selectors.js,content.js,content.css}`, `src/popup/*`, `src/dashboard/*`, `icons/`.
- Loaded in headless Chrome: service worker starts, no console errors.
- Dashboard settings save/load, bid scheduling creates a `bid-*` alarm, popup renders.
- Parser (`GHParse.parseListing`, `parseResults`, `findBidControls`) passes on **mock** pages only.
- README, MIT license, pushed to github.com/bemor187/GavelHawk.

## Current blockers

1. **Never run against live GovDeals.** The site is a JavaScript SPA; a plain fetch returns an
   empty shell, so the real DOM has never been inspected. Every selector in
   `src/content/selectors.js` is `null`, and parsing relies on label heuristics
   ("Current Bid", "Auction Close", "Location"). Expect some fields to show "—".
2. **Bid flow untested.** Bid input, Place Bid button and confirm dialog are found by guesses
   in `findBidControls()` / `findConfirm()`. Must be verified while logged in.
3. Background checks (outbid, saved-search alerts) depend on 1 working.

## Next steps

1. Load the extension: `chrome://extensions` → Developer mode → **Load unpacked** → repo root.
   After any code change, click the reload icon on the extension card and refresh the GovDeals tab.
2. Open a live listing, e.g. https://www.govdeals.com/en/asset/433/3298. Check the GavelHawk panel
   (bottom right). In DevTools console on that tab, choose the extension's content-script context
   and run `GHParse.parseListing()`. Every field (`title, price, endsAt, location, zip`) should be non-null.
3. Where a field is wrong, inspect the element and set an exact selector in the `SEL` object in
   `src/content/selectors.js`. Prefer stable ids / `data-*` attributes over generated class names.
   Also check `endsAt` time zone parsing (`Date.parse` with the ET suffix stripped, line in `parseListing`).
4. Open a search results page. Run `GHParse.parseResults().length` and compare with the visible count.
   If cards are wrong, set `SEL.resultCard`. Confirm badges and the bottom filter bar appear.
5. Bid flow: on a cheap listing, run `GHParse.findBidControls()` and confirm both `input` and
   `button` are the real elements. Set `SEL.bidInput`, `SEL.bidButton`, `SEL.confirmButton`.
   Then schedule a real low bid 2 min out from the popup and watch it fire. Only bid what the
   owner agrees to spend.
6. Background checks: watch an item with a "My bid" below the current price, then click
   **Check now** in the dashboard. Expect an "Outbid" notification. Save a search and confirm
   a second check notifies only on new listings.
7. Commit per fix, push to `main`, bump `version` in `manifest.json` when a round of fixes is done.

## Key files and functions

| File | What lives there |
|---|---|
| `src/content/selectors.js` | **Only file that knows GovDeals' layout.** `SEL` overrides, `LABELS` regexes, `parseListing`, `parseResults`, `climbToCard`, `findBidControls`, `findConfirm` |
| `src/content/content.js` | Listing panel (`renderPanel`), results badges/filters (`decorateResults`, `ensureToolbar`), `placeBid`, SPA routing via MutationObserver |
| `src/background.js` | `readPage` (opens inactive tab, asks content script, closes), `refreshWatchlist`, `checkSearches`, `fireBid`, message handlers, `poll` alarm |
| `src/shared/cost.js` | `DEFAULT_SETTINGS`, `trueCost`, `milesBetween` (zippopotam.us + cache, ×1.2 road factor), `listingKey` |
| `src/dashboard/dashboard.js` | Watchlist, searches, bids, notes, settings, export/import |

Storage (`chrome.storage.local`): `settings`, `watchlist{key}`, `searches{id}`, `notes{key}`,
`bids{bid-*}`, `zipCache`. `listingKey` = `<account>-<asset>` from `/asset/<account>/<asset>`.
Worker tab ids live in `chrome.storage.session.workerTabs`; content.js skips its UI in those tabs.

## Notes

- GovDeals has built-in proxy bidding, and its terms may restrict automated bidding. The README says so; keep that warning.
- Commits end with the Co-Authored-By / session lines the owner's tooling adds.
