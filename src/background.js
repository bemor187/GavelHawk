// GavelHawk background worker: timed bids, watchlist refresh, outbid and
// ending-soon alerts, and saved-search alerts.
import "./shared/cost.js";
const { getSettings, DEFAULT_SETTINGS, listingKey, milesBetween, money } = globalThis.GH;

const local = chrome.storage.local, session = chrome.storage.session;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- setup ----------
async function ensurePollAlarm() {
  const s = await getSettings();
  await chrome.alarms.clear("poll");
  chrome.alarms.create("poll", { periodInMinutes: Math.max(5, +s.pollMinutes || 30) });
}
chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await local.get("settings");
  await local.set({ settings: { ...DEFAULT_SETTINGS, ...(settings || {}) } });
  ensurePollAlarm();
});
chrome.runtime.onStartup.addListener(ensurePollAlarm);
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && ch.settings &&
      ch.settings.oldValue?.pollMinutes !== ch.settings.newValue?.pollMinutes) ensurePollAlarm();
});
chrome.action.setBadgeBackgroundColor?.({ color: "#e8a33d" });

// ---------- notifications ----------
async function notify(title, message, url) {
  const id = "n-" + Date.now() + Math.random().toString(36).slice(2, 6);
  if (url) {
    const { notifUrls = {} } = await session.get("notifUrls");
    notifUrls[id] = url;
    await session.set({ notifUrls });
  }
  chrome.notifications.create(id, {
    type: "basic", iconUrl: "icons/icon128.png", title, message, priority: 2,
    buttons: url ? [{ title: "Open listing" }] : []
  });
}
async function openFromNotification(id) {
  const { notifUrls = {} } = await session.get("notifUrls");
  if (notifUrls[id]) chrome.tabs.create({ url: notifUrls[id] });
  chrome.notifications.clear(id);
}
chrome.notifications.onClicked.addListener(openFromNotification);
chrome.notifications.onButtonClicked.addListener(openFromNotification);

// ---------- background tabs used to read pages ----------
async function workerTabs() { return (await session.get("workerTabs")).workerTabs || []; }

function waitLoaded(tabId, ms = 30000) {
  return new Promise((resolve) => {
    const done = (id, info) => { if (id === tabId && info.status === "complete") finish(); };
    const finish = () => { chrome.tabs.onUpdated.removeListener(done); clearTimeout(t); resolve(); };
    const t = setTimeout(finish, ms);
    chrome.tabs.onUpdated.addListener(done);
  });
}

async function ask(tabId, msg, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try { return await chrome.tabs.sendMessage(tabId, msg); } catch { await sleep(750); }
  }
  return null;
}

// Open a page out of sight, let the content script read it, close it.
async function readPage(url, msg) {
  const tab = await chrome.tabs.create({ url, active: false });
  await session.set({ workerTabs: [...(await workerTabs()), tab.id] });
  try {
    await waitLoaded(tab.id);
    return await ask(tab.id, msg);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
    await session.set({ workerTabs: (await workerTabs()).filter((t) => t !== tab.id) });
  }
}

// ---------- watchlist refresh + outbid / ending-soon alerts ----------
async function refreshWatchlist() {
  const { watchlist = {} } = await local.get("watchlist");
  const s = await getSettings();
  for (const [key, it] of Object.entries(watchlist)) {
    if (it.endsAt && it.endsAt < Date.now() - 86400000) continue; // ended over a day ago
    const d = await readPage(it.url, { type: "scrapeListing" });
    if (!d) continue;
    const prev = { ...it };
    Object.assign(it, {
      title: d.title || it.title, price: d.price ?? it.price, endsAt: d.endsAt ?? it.endsAt,
      location: d.location || it.location, zip: d.zip || it.zip,
      highBidder: d.highBidder, pickupOnly: d.pickupOnly, lastChecked: Date.now()
    });
    if ((it.zip || it.location) && it.miles == null) it.miles = await milesBetween(s.homeZip, it.zip || it.location);

    const outbid = it.myBid && it.price > it.myBid && !it.highBidder;
    if (outbid && prev.alertedOutbidAt !== it.price) {
      it.alertedOutbidAt = it.price;
      notify("Outbid", `${it.title}\nNow ${money(it.price)} (your bid ${money(it.myBid)})`, it.url);
    }
    const minsLeft = it.endsAt ? (it.endsAt - Date.now()) / 60000 : null;
    if (minsLeft != null && minsLeft > 0 && minsLeft <= Math.max(15, s.pollMinutes) && !it.alertedEnding) {
      it.alertedEnding = true;
      notify("Ending soon", `${it.title}\n${Math.round(minsLeft)} min left at ${money(it.price)}`, it.url);
    }
    watchlist[key] = it;
    await local.set({ watchlist });
  }
}

// ---------- saved-search alerts ----------
async function checkSearches(onlyId) {
  const { searches = {} } = await local.get("searches");
  const s = await getSettings();
  for (const [id, srch] of Object.entries(searches)) {
    if (onlyId && id !== onlyId) continue;
    const results = await readPage(srch.url, { type: "scrapeResults" });
    if (!results) continue;
    const seen = new Set(srch.seen || []);
    const firstRun = !srch.lastChecked;
    const fresh = [];
    for (const r of results) {
      const key = listingKey(r.url);
      if (seen.has(key)) continue;
      seen.add(key);
      if (srch.maxPrice && r.price != null && r.price > srch.maxPrice) continue;
      if (s.hidePickupOnly && r.pickupOnly) continue;
      if (s.hideTooFar && (r.zip || r.location)) {
        const mi = await milesBetween(s.homeZip, r.zip || r.location);
        if (mi != null && mi > s.maxMiles) continue;
      }
      fresh.push(r);
    }
    srch.seen = [...seen].slice(-1000);
    srch.lastChecked = Date.now();
    srch.newCount = (srch.newCount || 0) + (firstRun ? 0 : fresh.length);
    if (!firstRun && fresh.length) {
      const top = fresh[0];
      notify(`${fresh.length} new: ${srch.name}`,
        `${top.title}${top.price != null ? " — " + money(top.price) : ""}`,
        fresh.length === 1 ? top.url : srch.url);
    }
    searches[id] = srch;
    await local.set({ searches });
  }
  updateBadge();
}

async function updateBadge() {
  const { searches = {} } = await local.get("searches");
  const n = Object.values(searches).reduce((a, x) => a + (x.newCount || 0), 0);
  chrome.action.setBadgeText({ text: n ? String(n) : "" });
}

// ---------- timed bids ----------
async function fireBid(alarmId) {
  const { bids = {} } = await local.get("bids");
  const b = bids[alarmId];
  if (!b) return;
  delete bids[alarmId];
  await local.set({ bids });
  const tab = await chrome.tabs.create({ url: b.url, active: true });
  await waitLoaded(tab.id);
  const res = await ask(tab.id, { type: "placeBid", amount: b.amount });
  if (res?.ok) notify("Bid placed", `${money(b.amount)} on ${b.title || "listing"}` +
    (res.autoBid ? " (as Autobid max)" : ""), b.url);
  else notify("Bid FAILED", (res && res.error) || "Couldn't reach the page. Are you logged in?", b.url);
}

// ---------- alarms ----------
let polling = false;
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name.startsWith("bid-")) return fireBid(a.name);
  if (a.name === "poll" && !polling) {
    polling = true;
    try { await refreshWatchlist(); await checkSearches(); } finally { polling = false; }
  }
});

// ---------- messages from content script, popup and dashboard ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    switch (msg.type) {
      case "isWorkerTab":
        return (await workerTabs()).includes(sender.tab?.id);
      case "toggleWatch": {
        const { watchlist = {} } = await local.get("watchlist");
        const k = msg.item.key || listingKey(msg.item.url);
        if (watchlist[k]) { delete watchlist[k]; await local.set({ watchlist }); return { watching: false }; }
        watchlist[k] = { ...msg.item, key: k, added: Date.now(), lastChecked: Date.now() };
        await local.set({ watchlist });
        return { watching: true };
      }
      case "saveSearch": {
        const { searches = {} } = await local.get("searches");
        const id = "s-" + Date.now();
        searches[id] = { ...msg.search, id, seen: [], newCount: 0 };
        await local.set({ searches });
        checkSearches(id); // first run just records what's already there
        return { id };
      }
      case "scheduleBid": {
        const { bids = {} } = await local.get("bids");
        const id = "bid-" + Date.now();
        bids[id] = { url: msg.url, amount: msg.amount, when: msg.when, title: msg.title || "" };
        await local.set({ bids });
        chrome.alarms.create(id, { when: msg.when });
        return { id };
      }
      case "cancelBid": {
        const { bids = {} } = await local.get("bids");
        delete bids[msg.id];
        await local.set({ bids });
        await chrome.alarms.clear(msg.id);
        return true;
      }
      case "checkNow":
        if (polling) return "busy";
        polling = true;
        try { await refreshWatchlist(); await checkSearches(); } finally { polling = false; }
        return "done";
      case "clearNew": {
        const { searches = {} } = await local.get("searches");
        Object.values(searches).forEach((x) => (x.newCount = 0));
        await local.set({ searches });
        updateBadge();
        return true;
      }
    }
  })().then(reply);
  return true;
});
