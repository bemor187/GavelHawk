// Shared helpers. Plain script (no import/export) so it works both as a
// content script and as a side-effect import in module pages.
(function () {
  const DEFAULT_SETTINGS = {
    homeZip: "34951",        // where you pick up from
    maxMiles: 80,            // furthest you'll travel
    buyerPremiumPct: 10,     // varies by seller, check each listing
    salesTaxPct: 6.5,        // set to your local rate, 0 if exempt
    costPerMile: 0.7,        // fuel + wear, dollars per mile
    roundTrip: true,         // count the drive back
    pollMinutes: 30,         // how often to check watchlist and searches
    hideTooFar: true,        // filter: hide listings past maxMiles
    hideOverMax: false,      // filter: hide listings past a search's max price
    hidePickupOnly: false    // filter: hide "pickup only" listings
  };

  async function getSettings() {
    const { settings } = await chrome.storage.local.get("settings");
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
  }

  function trueCost(price, s, miles) {
    const premium = price * (s.buyerPremiumPct / 100);
    const tax = (price + premium) * (s.salesTaxPct / 100);
    const travel = miles == null ? 0 : miles * (s.roundTrip ? 2 : 1) * s.costPerMile;
    return { price, premium, tax, travel, total: price + premium + tax + travel };
  }

  const money = (n) =>
    n == null || isNaN(n) ? "—" : "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  function timeLeft(endsAt) {
    if (!endsAt) return "—";
    const ms = endsAt - Date.now();
    if (ms <= 0) return "Ended";
    const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
  }

  function listingKey(url) {
    // GovDeals asset URLs end in /asset/<account>/<asset>
    const m = String(url).match(/asset\/(\d+)\/(\d+)/i);
    return m ? `${m[1]}-${m[2]}` : String(url).split("?")[0];
  }

  // ZIP -> lat/lon with a local cache, then straight-line miles.
  async function zipLatLon(zip) {
    if (!/^\d{5}$/.test(zip || "")) return null;
    const { zipCache = {} } = await chrome.storage.local.get("zipCache");
    if (zipCache[zip]) return zipCache[zip];
    try {
      const r = await fetch(`https://api.zippopotam.us/us/${zip}`);
      if (!r.ok) return null;
      const p = (await r.json()).places[0];
      zipCache[zip] = { lat: +p.latitude, lon: +p.longitude };
      await chrome.storage.local.set({ zipCache });
      return zipCache[zip];
    } catch { return null; }
  }

  async function milesBetween(zipA, zipB) {
    const [a, b] = await Promise.all([zipLatLon(zipA), zipLatLon(zipB)]);
    if (!a || !b) return null;
    const R = 3958.8, rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    // Roads are longer than a straight line; 1.2 is a common rule of thumb.
    return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.2);
  }

  globalThis.GH = { DEFAULT_SETTINGS, getSettings, trueCost, money, timeLeft, listingKey, milesBetween };
})();
