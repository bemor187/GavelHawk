// Everything that depends on GovDeals' page layout lives here, so a site
// redesign means editing one file.
//
// Each selector can be set to an exact CSS selector (right-click the element
// on GovDeals -> Inspect -> copy its id/class). Left as null, GavelHawk falls
// back to reading the page text by its labels ("Current Bid", "Location"...).
(function () {
  // Verified against live govdeals.com on 2026-11-20 (logged out).
  const SEL = {
    // listing page (/en/asset/<account>/<asset>)
    title: "h1.product-title",
    price: "#currentBid",                         // "$36.00 USD (10 Bids)"
    endsAt: ".product-details app-ux-timer",      // "21h50m(Nov 21, 2026 12:22 PM EST)"
    location: "#lnkAssetDetailLocation",          // "Winona, Minnesota, USA" (no ZIP)
    address: "#seller_information a[href*='maps.google']", // street address with ZIP
    premium: "#lblBuyerPremium",                  // data-value="12.5"
    // bid controls: only shown when signed in, not yet verified
    bidInput: null,       // the bid amount box
    bidButton: null,      // "Place Bid" button
    confirmButton: null,  // button in the confirm dialog, if any
    // search results (grid view)
    resultCard: ".card-search",
    resultExclude: ".swiper",                     // featured carousels reuse the card markup
    resultTitle: "a.link-click",                  // title attr holds the untruncated title
    resultPrice: "[name=pAssetCurrentBid]",       // title="275", text "USD 275.00"
    resultLocation: "[name=pAssetLocation]",      // "Nashville , Tennessee, USA" (no ZIP)
    resultEndsAt: "app-ux-timer"
  };

  const LABELS = {
    price: [/current\s*bid/i, /high\s*bid/i, /starting\s*bid/i],
    endsAt: [/auction\s*clos\w*/i, /closing\s*date/i, /end\s*date/i, /\bends\b/i],
    location: [/(item\s*|pickup\s*)?location/i],
    highBidder: [/you\s*are\s*(the\s*)?(current\s*)?high(est)?\s*bidder/i, /you('|’)re\s*winning/i],
    pickupOnly: [/pick\s*-?\s*up\s*only/i, /no\s*shipping/i, /shipping\s+is\s+not\s+available/i]
  };

  const text = (el) => (el ? el.innerText || el.textContent || "" : "").trim();
  const num = (s) => { const m = String(s).replace(/,/g, "").match(/\$?\s*(\d+(\.\d+)?)/); return m ? +m[1] : null; };
  // GovDeals shows "21h50m(Nov 21, 2026 12:22 PM EST)": take the part in
  // parentheses and turn the zone name into an offset, so the time is right
  // whatever zone the user's computer is in.
  const TZ = { EST: "-0500", EDT: "-0400", CST: "-0600", CDT: "-0500", MST: "-0700", MDT: "-0600",
    PST: "-0800", PDT: "-0700", AKST: "-0900", AKDT: "-0800", HST: "-1000",
    ET: "-0500", CT: "-0600", MT: "-0700", PT: "-0800" };
  function parseWhen(s) {
    if (!s) return null;
    let t = (String(s).match(/\(([^)]*\d{4}[^)]*)\)/) || [, s])[1].trim();
    const m = t.match(/^(.*?)\s+([A-Z]{2,4})$/);
    if (m && TZ[m[2]]) t = m[1] + " GMT" + TZ[m[2]];
    const ms = Date.parse(t);
    return isNaN(ms) ? null : ms;
  }

  const zipIn = (s) => (String(s).match(/\b(\d{5})(?:-\d{4})?\b/) || [])[1] || null;

  // Find the text that sits next to a label like "Current Bid".
  function byLabel(patterns, root = document) {
    const els = root.querySelectorAll("dt, th, label, span, div, p, strong, b, h3, h4, h5, li");
    for (const pat of patterns) {           // patterns are in priority order
      for (const el of els) {
        const t = text(el);
        if (t.length > 60 || !pat.test(t)) continue;
        // Use the innermost element holding the label, not its wrappers.
        if ([...el.children].some((c) => pat.test(text(c)))) continue;
        const after = t.replace(new RegExp("^.*?" + pat.source + "\\s*:?", "i"), "").trim();
        if (after) return after;
        const sib = el.nextElementSibling;
        if (sib && text(sib)) return text(sib);
        const parentText = text(el.parentElement);
        if (parentText.length < 200) {
          const rest = parentText.replace(t, "").trim();
          if (rest) return rest;
        }
      }
    }
    return null;
  }

  function pageHas(patterns) {
    const body = document.body ? document.body.innerText : "";
    return patterns.some((p) => p.test(body));
  }

  function parseListing() {
    const q = (s) => (s ? document.querySelector(s) : null);
    const title = text(q(SEL.title)) || text(document.querySelector("h1")) || document.title;
    const priceText = text(q(SEL.price)) || byLabel(LABELS.price);
    const endText = text(q(SEL.endsAt)) || byLabel(LABELS.endsAt);
    const locText = text(q(SEL.location)) || byLabel(LABELS.location);
    const addrText = text(q(SEL.address)) || byLabel([/item\s*location/i]) || "";
    const prem = q(SEL.premium);
    const premiumPct = prem ? parseFloat(prem.getAttribute("data-value") || text(prem)) : NaN;
    return {
      url: location.href.split("#")[0],
      title: title.slice(0, 140),
      price: num(priceText),
      endsAt: parseWhen(endText),
      location: locText ? locText.split("\n")[0].slice(0, 80) : null,
      zip: zipIn(addrText) || zipIn(locText || ""),
      premiumPct: isNaN(premiumPct) ? null : premiumPct,
      highBidder: pageHas(LABELS.highBidder),
      pickupOnly: pageHas(LABELS.pickupOnly)
    };
  }

  // Search results: every link to an asset page, grouped into its card.
  function parseResults() {
    const out = new Map();
    const links = document.querySelectorAll('a[href*="/asset/"]');
    for (const a of links) {
      if (SEL.resultExclude && a.closest(SEL.resultExclude)) continue;
      // With resultCard set, links outside a card (recommendation widgets,
      // nav) are skipped instead of guessed at.
      const card = SEL.resultCard ? a.closest(SEL.resultCard) : climbToCard(a);
      if (!card || out.has(card)) continue;
      const t = text(card);
      const q = (s) => (s ? card.querySelector(s) : null);
      const titleEl = q(SEL.resultTitle), priceEl = q(SEL.resultPrice), locEl = q(SEL.resultLocation);
      const loc = locEl ? (locEl.getAttribute("title") || text(locEl)).replace(/\s+,/g, ",").trim() : null;
      out.set(card, {
        card,
        url: a.href.split("#")[0],
        title: ((titleEl && (titleEl.getAttribute("title") || text(titleEl))) ||
          text(card.querySelector("h2,h3,h4,h5")) || text(a)).slice(0, 140),
        price: priceEl ? num(priceEl.getAttribute("title") || text(priceEl))
          : num((t.match(/\$\s*[\d,]+(\.\d+)?/) || [])[0] || ""),
        endsAt: parseWhen(text(q(SEL.resultEndsAt))),
        location: loc,
        // Cards carry no ZIP. Read one only from the location line, never the
        // whole card: lot numbers like "25917-1" look like ZIPs.
        zip: zipIn(loc || (locEl ? "" : t)),
        pickupOnly: LABELS.pickupOnly.some((p) => p.test(t))
      });
    }
    return [...out.values()];
  }

  // Walk up from a link until the next level up would include a different
  // listing; that last single-listing box is the card.
  const assetIds = (n) => new Set([...n.querySelectorAll('a[href*="/asset/"]')]
    .map((a) => (a.href.match(/asset\/\d+\/\d+/i) || [a.href])[0]));
  function climbToCard(el) {
    let n = el;
    for (let i = 0; i < 10 && n.parentElement && n.parentElement !== document.body; i++) {
      if (assetIds(n.parentElement).size > 1) break;
      n = n.parentElement;
    }
    return /(\$|USD)\s*\d/.test(text(n)) ? n : null;
  }

  function findBidControls() {
    const input = (SEL.bidInput && document.querySelector(SEL.bidInput)) ||
      [...document.querySelectorAll("input")].find((i) =>
        /bid/i.test([i.id, i.name, i.placeholder, i.getAttribute("aria-label")].join(" ")) && i.type !== "hidden");
    const button = (SEL.bidButton && document.querySelector(SEL.bidButton)) ||
      [...document.querySelectorAll("button, input[type=submit]")].find((b) => /place\s*bid|bid\s*now|submit\s*bid/i.test(text(b) || b.value));
    return { input, button };
  }

  function findConfirm() {
    return (SEL.confirmButton && document.querySelector(SEL.confirmButton)) ||
      [...document.querySelectorAll("[role=dialog] button, .modal button, mat-dialog-container button")]
        .find((b) => /confirm|yes|place\s*bid|submit/i.test(text(b)));
  }

  globalThis.GHParse = { SEL, parseWhen, parseListing, parseResults, findBidControls, findConfirm, num };
})();
