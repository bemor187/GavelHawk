# GavelHawk Handoff

Read this first. It's written so a new agent can act from this file alone.

## What this is

GavelHawk is a Chrome MV3 extension that cuts time spent on GovDeals (govdeals.com):
watchlist dashboard, saved-search alerts, true cost (bid + premium + tax + travel),
outbid / ending-soon alerts, distance and pickup-only filters, private notes, and timed bids.
Plain JS, no build step, no dependencies. Load unpacked from the repo root.

Owner's defaults: home ZIP 34951, max travel 80 mi. These must stay user-editable
(Dashboard → Settings) because the extension will be distributed.

## Completed

**v0.1.0 (commit f608266)**: all six features written, loads cleanly, mock-page parser tests. README, MIT license.

**v0.1.1: parser verified on live govdeals.com (2026-11-20, logged out)**
- `SEL` in `src/content/selectors.js` now has real selectors for listing pages (`h1.product-title`,
  `#currentBid`, `.product-details app-ux-timer`, `#lnkAssetDetailLocation`, `#seller_information` map link
  for the ZIP, `#lblBuyerPremium`) and search results (`.card-search`, excluding `.swiper` carousels;
  `[name=pAssetCurrentBid]`, `[name=pAssetLocation]`, `a.link-click`).
- `parseListing()` on https://www.govdeals.com/en/asset/433/3298 returns every field, including
  `zip` 55987, `premiumPct` 12.5 and `pickupOnly` true ("SHIPPING IS NOT AVAILABLE").
- End times: `parseWhen()` reads the "(Nov 21, 2026 12:22 PM EST)" part and maps EST/EDT/etc. to an
  offset, so they're correct in any zone.
- `parseResults()`: 24/24 cards with title, price, endsAt and location on `/en/search?kWord=truck`,
  `/en/closing-today` and `/en/new-listings`. Hidden recommendation widgets and carousels are skipped.
- Result cards show only "City, State, USA" with no ZIP, so `milesBetween()` in `cost.js` now takes
  a ZIP *or* "City, State" (zippopotam `/us/<st>/<city>`). Callers pass `zip || location`.
- The listing panel uses the listing's own buyer's premium when shown, falling back to Settings.
- End-to-end check with the real extension in headless Chrome: the panel renders on the listing, and the
  results page shows 24 badges, the filter bar and the "N hidden" count.

**v0.1.2: bid controls verified signed in (2026-11-20, web session in the owner's Chrome)**
- `SEL.bidInput` `#bid-box-input-bid-amount`, `SEL.bidButton` `#btnPostBid` (an `<a>`, so the old
  button-only fallback missed it), `SEL.confirmButton` `#btnAcceptbid` (hidden in `#onlineAuctionBidBox`
  until Bid Now), `SEL.autoBid` `#isAutoBid` (checked by default).
- `findConfirm()` returns the confirm button only once visible. `placeBid()` reports failure if Accept Bid
  never appears, and the "Bid placed" notification says when Autobid was on.
- Results: "Free" cards have plain `p.card-amount` with no `name` attr, so `resultPrice`/`resultLocation`
  now list class fallbacks; Free = $0. The ZIP is read only from the location line, never the whole card
  (lot numbers look like ZIPs). Live `/en/closing-today`: 24/24 cards with price and location, 0 fake ZIPs.
- `cost.js`: city lookups retry with St./Ft./Mt. spelled out (zippopotam needs "port saint lucie").
- Click sequence (type amount → Bid Now → Accept Bid) passes on a mock of the live markup. No real bid placed.

How it was tested (reusable): branded Chrome 137+ ignores `--load-extension`. Launch Chrome with
`--headless=new --remote-debugging-pipe --enable-unsafe-extension-debugging`, then send the CDP command
`Extensions.loadUnpacked {path}`, open the page and `Runtime.evaluate`. Harness scripts were in the
session scratchpad, not committed.

## Current blockers

1. **No real bid placed yet.** Selectors are verified; needs the owner's OK and a cheap item.
2. **Autobid decision.** `#isAutoBid` is checked by default, so a scheduled bid becomes a proxy max bid.
   Ask the owner whether GavelHawk should leave it or uncheck it for exact-amount bids.
3. **Background checks untested** (outbid and saved-search alerts). The parsers they use now work.
4. Only grid view is verified. If GovDeals has a list view toggle, check that `.card-search` still matches.

## Next steps

1. Load the extension: `chrome://extensions` → Developer mode → **Load unpacked** → repo root.
   After any code change, click the reload icon on the extension card and refresh the GovDeals tab.
2. Real bid test, only with the owner's explicit OK on item and amount: open the popup on a cheap
   listing, schedule the minimum bid 2 min out, watch the tab do Bid Now → Accept Bid, and check the
   notification. If GovDeals shows any extra step, add its selector to `SEL`.
3. Background checks: watch an item with a "My bid" below the current price, then click
   **Check now** in the dashboard. Expect an "Outbid" notification. Save a search and confirm
   a second check notifies only on new listings.
4. Optional: the listing's map link carries lat/lon (`maps.google.com/maps?q=44.05,-91.63`), which could
   replace the ZIP lookup on listing pages.
5. Commit per fix, push to `main`, bump `version` in `manifest.json` when a round of fixes is done.

## Key files and functions

| File | What lives there |
|---|---|
| `src/content/selectors.js` | **Only file that knows GovDeals' layout.** `SEL` selectors, `LABELS` regexes, `parseWhen`, `parseListing`, `parseResults`, `climbToCard`, `findBidControls`, `findConfirm` |
| `src/content/content.js` | Listing panel (`renderPanel`), results badges/filters (`decorateResults`, `ensureToolbar`), `placeBid`, SPA routing via MutationObserver |
| `src/background.js` | `readPage` (opens inactive tab, asks content script, closes), `refreshWatchlist`, `checkSearches`, `fireBid`, message handlers, `poll` alarm |
| `src/shared/cost.js` | `DEFAULT_SETTINGS`, `trueCost`, `milesBetween` (ZIP or "City, State" via zippopotam.us + cache, ×1.2 road factor), `listingKey` |
| `src/dashboard/dashboard.js` | Watchlist, searches, bids, notes, settings, export/import |

Storage (`chrome.storage.local`): `settings`, `watchlist{key}`, `searches{id}`, `notes{key}`,
`bids{bid-*}`, `zipCache` (keyed by ZIP or `st/city` path). `listingKey` = `<account>-<asset>` from `/asset/<account>/<asset>`.
Worker tab ids live in `chrome.storage.session.workerTabs`; content.js skips its UI in those tabs.

## Notes

- GovDeals has built-in proxy bidding, and its terms may restrict automated bidding. The README says so; keep that warning.
- Commits end with the Co-Authored-By / session lines the owner's tooling adds.
