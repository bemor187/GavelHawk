// Runs on every GovDeals page: adds the GavelHawk panel to listings,
// cost/distance badges and filters to search results, and does the
// scraping and bid clicks that the background worker asks for.
(function () {
  const { parseListing, parseResults, findBidControls, findConfirm } = GHParse;
  const { getSettings, trueCost, money, timeLeft, listingKey, milesBetween } = GH;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isListing = () => /\/asset\//i.test(location.pathname);

  async function waitFor(fn, ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(400); }
    return fn();
  }

  // ---------- requests from the background worker ----------
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "scrapeListing") {
      waitFor(() => { const d = parseListing(); return d.price != null ? d : null; })
        .then((d) => reply(d || parseListing()));
      return true;
    }
    if (msg.type === "scrapeResults") {
      waitFor(() => { const r = parseResults(); return r.length ? r : null; })
        .then((r) => reply((r || []).map(({ card, ...rest }) => rest)));
      return true;
    }
    if (msg.type === "placeBid") { placeBid(msg.amount).then(reply); return true; }
  });

  async function placeBid(amount) {
    const c = await waitFor(() => { const x = findBidControls(); return x.input && x.button ? x : null; });
    if (!c) return { ok: false, error: "Bid box or button not found. Set bidInput/bidButton in selectors.js." };
    // Set the value the way a framework-driven page (Angular/React) will notice.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    c.input.focus();
    setter.call(c.input, String(amount));
    c.input.dispatchEvent(new Event("input", { bubbles: true }));
    c.input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(300);
    c.button.click();
    const confirm = await waitFor(findConfirm, 5000);
    if (confirm) { confirm.click(); await sleep(1500); }
    return { ok: true, confirmed: !!confirm };
  }

  // ---------- listing page panel ----------
  async function renderPanel() {
    document.getElementById("gh-panel")?.remove();
    const s = await getSettings();
    const d = await waitFor(() => { const x = parseListing(); return x.price != null ? x : null; }, 10000) || parseListing();
    const key = listingKey(d.url);
    const { watchlist = {}, notes = {} } = await chrome.storage.local.get(["watchlist", "notes"]);
    const where = d.zip || d.location;
    const miles = where ? await milesBetween(s.homeZip, where) : null;
    // Use the listing's own buyer's premium when the page shows one.
    const sc = d.premiumPct != null ? { ...s, buyerPremiumPct: d.premiumPct } : s;
    const c = trueCost(d.price || 0, sc, miles);

    const el = document.createElement("div");
    el.id = "gh-panel";
    el.innerHTML = `
      <div class="gh-head"><b>GavelHawk</b><button class="gh-x" title="Collapse">–</button></div>
      <div class="gh-body">
        <div class="gh-total">${money(c.total)} <span>true cost</span></div>
        <div class="gh-rows">
          <div>Bid</div><div>${money(c.price)}</div>
          <div>Premium ${sc.buyerPremiumPct}%</div><div>${money(c.premium)}</div>
          <div>Tax ${s.salesTaxPct}%</div><div>${money(c.tax)}</div>
          <div>Travel ${miles == null ? "(no location found)" : miles + " mi" + (s.roundTrip ? " ×2" : "")}</div><div>${money(c.travel)}</div>
          <div>Time left</div><div>${timeLeft(d.endsAt)}</div>
        </div>
        ${miles != null && miles > s.maxMiles ? `<div class="gh-warn">Past your ${s.maxMiles} mi limit</div>` : ""}
        <div class="gh-line">
          <input class="gh-mybid" type="number" min="0" step="1" placeholder="My bid / max $" value="${watchlist[key]?.myBid ?? ""}">
          <button class="gh-watch">${watchlist[key] ? "Watching ✓" : "Watch"}</button>
        </div>
        <textarea class="gh-note" placeholder="Private note, e.g. rust on frame, max $800">${(notes[key]?.text || "").replace(/</g, "&lt;")}</textarea>
      </div>`;
    document.body.appendChild(el);

    el.querySelector(".gh-x").onclick = () => el.classList.toggle("gh-min");
    el.querySelector(".gh-watch").onclick = async (e) => {
      const myBid = parseFloat(el.querySelector(".gh-mybid").value) || null;
      const res = await chrome.runtime.sendMessage({ type: "toggleWatch", item: { ...d, key, miles, myBid } });
      e.target.textContent = res.watching ? "Watching ✓" : "Watch";
    };
    el.querySelector(".gh-mybid").onchange = async (e) => {
      const { watchlist = {} } = await chrome.storage.local.get("watchlist");
      if (watchlist[key]) { watchlist[key].myBid = parseFloat(e.target.value) || null; await chrome.storage.local.set({ watchlist }); }
    };
    let t;
    el.querySelector(".gh-note").oninput = (e) => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const { notes = {} } = await chrome.storage.local.get("notes");
        const v = e.target.value.trim();
        if (v) notes[key] = { text: v, title: d.title, url: d.url, updated: Date.now() }; else delete notes[key];
        await chrome.storage.local.set({ notes });
      }, 500);
    };
  }

  // ---------- search results: badges + filters ----------
  async function decorateResults() {
    const items = parseResults();
    if (!items.length) return;
    const s = await getSettings();
    const { notes = {}, watchlist = {} } = await chrome.storage.local.get(["notes", "watchlist"]);
    ensureToolbar(s);
    let hidden = 0;
    for (const it of items) {
      const key = listingKey(it.url);
      const where = it.zip || it.location;
      const miles = where ? await milesBetween(s.homeZip, where) : null;
      const c = trueCost(it.price || 0, s, miles);
      let badge = it.card.querySelector(".gh-badge");
      if (!badge) { badge = document.createElement("div"); badge.className = "gh-badge"; it.card.prepend(badge); }
      const html = `${it.price != null ? money(c.total) + " true" : ""}${miles != null ? ` · ${miles} mi` : ""}` +
        `${watchlist[key] ? " · ★" : ""}${notes[key] ? ` · 📝 ${notes[key].text.slice(0, 40).replace(/</g, "&lt;")}` : ""}`;
      // Only touch the DOM when something changed, so our own edits don't
      // retrigger the page observer in a loop.
      if (badge.innerHTML !== html) badge.innerHTML = html;
      const tooFar = s.hideTooFar && miles != null && miles > s.maxMiles;
      const pickup = s.hidePickupOnly && it.pickupOnly;
      const hide = tooFar || pickup;
      it.card.classList.toggle("gh-hidden", hide);
      if (hide) hidden++;
    }
    const n = document.getElementById("gh-hidden-count");
    const label = hidden ? `${hidden} hidden` : "";
    if (n && n.textContent !== label) n.textContent = label;
  }

  function ensureToolbar(s) {
    if (document.getElementById("gh-bar")) return;
    const bar = document.createElement("div");
    bar.id = "gh-bar";
    bar.innerHTML = `<b>GavelHawk</b>
      <label><input type="checkbox" data-k="hideTooFar" ${s.hideTooFar ? "checked" : ""}> Hide over ${s.maxMiles} mi</label>
      <label><input type="checkbox" data-k="hidePickupOnly" ${s.hidePickupOnly ? "checked" : ""}> Hide pickup-only</label>
      <span id="gh-hidden-count"></span>
      <button id="gh-save-search">Save this search</button>`;
    document.body.appendChild(bar);
    bar.querySelectorAll("input[data-k]").forEach((cb) => (cb.onchange = async () => {
      const cur = await getSettings();
      await chrome.storage.local.set({ settings: { ...cur, [cb.dataset.k]: cb.checked } });
      decorateResults();
    }));
    bar.querySelector("#gh-save-search").onclick = async () => {
      const name = prompt("Name this search (e.g. Pickups under $5k):", document.title.slice(0, 40));
      if (!name) return;
      const max = parseFloat(prompt("Alert only under this price? (leave blank for any)", "")) || null;
      await chrome.runtime.sendMessage({ type: "saveSearch", search: { name, url: location.href, maxPrice: max } });
      alert("Saved. You'll get a notification when new listings show up.");
    };
  }

  // ---------- page routing (GovDeals is a single-page app) ----------
  let lastUrl = "", timer;
  function route() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      document.getElementById("gh-panel")?.remove();
      document.getElementById("gh-bar")?.remove();
      if (isListing()) renderPanel();
    }
    if (!isListing()) { clearTimeout(timer); timer = setTimeout(decorateResults, 600); }
  }
  // Skip UI in tabs the background opened just to read data.
  chrome.runtime.sendMessage({ type: "isWorkerTab" }).then((isWorker) => {
    if (isWorker) return;
    route();
    new MutationObserver(route).observe(document.body, { childList: true, subtree: true });
    chrome.storage.onChanged.addListener((ch) => { if (ch.settings && isListing()) renderPanel(); });
  }).catch(() => {});
})();
