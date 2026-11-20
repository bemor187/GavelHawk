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

  const STATES = { alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca", colorado: "co",
    connecticut: "ct", delaware: "de", "district of columbia": "dc", florida: "fl", georgia: "ga", hawaii: "hi",
    idaho: "id", illinois: "il", indiana: "in", iowa: "ia", kansas: "ks", kentucky: "ky", louisiana: "la",
    maine: "me", maryland: "md", massachusetts: "ma", michigan: "mi", minnesota: "mn", mississippi: "ms",
    missouri: "mo", montana: "mt", nebraska: "ne", nevada: "nv", "new hampshire": "nh", "new jersey": "nj",
    "new mexico": "nm", "new york": "ny", "north carolina": "nc", "north dakota": "nd", ohio: "oh", oklahoma: "ok",
    oregon: "or", pennsylvania: "pa", "rhode island": "ri", "south carolina": "sc", "south dakota": "sd",
    tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt", virginia: "va", washington: "wa",
    "west virginia": "wv", wisconsin: "wi", wyoming: "wy", "puerto rico": "pr" };

  // A ZIP ("34951") or "City, State[, USA]" -> zippopotam.us lookup path.
  function placePath(place) {
    const p = String(place || "").trim();
    if (/^\d{5}$/.test(p)) return p;
    const [city, state] = p.split(",").map((x) => x.trim().toLowerCase());
    const st = state && (STATES[state] || (/^[a-z]{2}$/.test(state) ? state : null));
    return city && st ? `${st}/${encodeURIComponent(city)}` : null;
  }

  // Place -> lat/lon with a local cache, then straight-line miles.
  async function placeLatLon(place) {
    const path = placePath(place);
    if (!path) return null;
    const { zipCache = {} } = await chrome.storage.local.get("zipCache");
    if (zipCache[path]) return zipCache[path];
    try {
      const r = await fetch(`https://api.zippopotam.us/us/${path}`);
      if (!r.ok) return null;
      const p = (await r.json()).places[0];
      zipCache[path] = { lat: +p.latitude, lon: +p.longitude };
      await chrome.storage.local.set({ zipCache });
      return zipCache[path];
    } catch { return null; }
  }

  // Each argument is a ZIP or a "City, State" string.
  async function milesBetween(placeA, placeB) {
    const [a, b] = await Promise.all([placeLatLon(placeA), placeLatLon(placeB)]);
    if (!a || !b) return null;
    const R = 3958.8, rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    // Roads are longer than a straight line; 1.2 is a common rule of thumb.
    return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.2);
  }

  globalThis.GH = { DEFAULT_SETTINGS, getSettings, trueCost, money, timeLeft, listingKey, milesBetween };
})();
