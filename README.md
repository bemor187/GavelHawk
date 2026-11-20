# 🦅 GavelHawk

A Chrome extension that cuts the time you spend on [GovDeals](https://www.govdeals.com).

| Feature | What it does |
|---|---|
| **Watchlist dashboard** | One page with every watched listing: current bid, true cost, distance, time left, status. |
| **Saved-search alerts** | Checks your saved searches in the background and notifies you when new listings appear. |
| **True cost** | Bid + buyer's premium + sales tax + travel, shown on listings, results and the dashboard. |
| **Outbid alerts** | Desktop notification when the price passes your bid, plus an "ending soon" alert. |
| **Quick filters** | Hide listings past your travel limit or marked pickup-only, right on the results page. |
| **Private notes** | A note box on every listing; notes also show as badges on search results. |
| **Timed bids** | Schedule a bid for a set time; GavelHawk opens the listing and places it. |

## Install (developer mode)

1. Download this repo (Code → Download ZIP) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the `gavelhawk` folder.
4. Pin the 🦅 icon, click it, then **Open dashboard → Settings**.

## Settings

Everything is changeable in **Dashboard → Settings**:

| Setting | Default |
|---|---|
| Home ZIP | 34951 |
| Max travel | 80 miles |
| Buyer's premium | 10% (varies by seller, check the listing) |
| Sales tax | 6.5% |
| Cost per mile | $0.70, round trip |
| Check every | 30 minutes |

Distances are estimated from ZIP codes (straight line × 1.2) using the free [Zippopotam.us](https://zippopotam.us) lookup, cached locally. Settings and data can be exported and imported as JSON.

## How it reads GovDeals

GovDeals is a JavaScript app, so GavelHawk reads the rendered page. By default it finds values by their labels ("Current Bid", "Auction Close", "Location"). If GovDeals changes its layout, set exact CSS selectors in [`src/content/selectors.js`](src/content/selectors.js); it's the only file that knows about the page layout.

Background checks open the listing or search in an inactive tab for a few seconds, read it, and close it.

## Timed bids: read this

- Chrome must be running and you must be logged in to GovDeals when the bid fires.
- Schedule it a minute or two before close to allow for page load.
- Test it once on a low-stakes item before trusting it.
- GovDeals already offers proxy (max) bidding, and its terms may restrict automated bidding tools. Check them; you're responsible for your account.

## Project layout

```
manifest.json
icons/
src/
  background.js        alarms, background checks, notifications, timed bids
  shared/cost.js       settings, true-cost math, ZIP distance
  content/             runs on govdeals.com: panel, badges, filters, page parsing
  popup/               toolbar popup: quick bid scheduling
  dashboard/           full dashboard + settings
```

## License

MIT. Not affiliated with GovDeals or Liquidity Services.
