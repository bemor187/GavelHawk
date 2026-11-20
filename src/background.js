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
    // Relative paths resolve from src/, so build the full extension URL.
    type: "basic", iconUrl: chrome.runtime.getURL("icons/icon128.png"), title, message, priority: 2,
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
// Bids with leadSec are "N seconds before close": the alarm fires ARM_MS
// early, we open the listing, and the content script reports the exact close
// time over a port while we time the stage and fire steps here.
const ARM_MS = 75000, STAGE_MS = 6000;
const snipes = new Map(); // bid id -> { b, staged, fired }

async function fireBid(alarmId) {
  const { bids = {} } = await local.get("bids");
  const b = bids[alarmId];
  if (!b) return;
  if (b.leadSec) {
    // Stays listed (and cancellable) until it finishes.
    bids[alarmId] = { ...b, armed: true };
    await local.set({ bids });
    return armSnipe(alarmId, b);
  }
  delete bids[alarmId];
  await local.set({ bids });
  const tab = await chrome.tabs.create({ url: b.url, active: true });
  await waitLoaded(tab.id);
  const res = await ask(tab.id, { type: "placeBid", amount: b.amount });
  if (res?.ok) notify("Bid placed", `${money(b.amount)} on ${b.title || "listing"}` +
    (res.autoBid ? " (as Autobid max)" : ""), b.url);
  else notify("Bid FAILED", (res && res.error) || "Couldn't reach the page. Are you logged in?", b.url);
}

async function armSnipe(id, b) {
  snipes.set(id, { b, staged: false, fired: false, done: false });
  const tab = await chrome.tabs.create({ url: b.url, active: true });
  await waitLoaded(tab.id);
  const res = await ask(tab.id, { type: "armSnipe", bidId: id, amount: b.amount, dryRun: !!b.dryRun });
  if (!res?.ok) {
    snipes.delete(id);
    notify("Bid FAILED", "Couldn't reach the listing page to arm the bid.", b.url);
  }
}

async function finishSnipe(id, title, message) {
  const sn = snipes.get(id);
  if (!sn || sn.done) return;
  sn.done = true;
  clearTimeout(sn.stageT); clearTimeout(sn.fireT);
  snipes.delete(id);
  try { sn.port?.disconnect(); } catch {}
  const { bids = {} } = await local.get("bids");
  delete bids[id];
  await local.set({ bids, lastBidResult: { title, message, url: sn.b.url, at: Date.now() } });
  notify(title, message, sn.b.url);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "snipe") return;
  let id = null;
  port.onMessage.addListener((m) => {
    if (m.hello) { id = m.hello; const s0 = snipes.get(id); if (s0) s0.port = port; return; }
    const sn = snipes.get(id);
    if (!sn) return;
    const { b } = sn, leadMs = b.leadSec * 1000;
    if (m.endLocal !== undefined) {
      const now = Date.now();
      if (m.endLocal == null) return finishSnipe(id, "Bid FAILED", "Couldn't read the closing time on the page.");
      if (m.endLocal <= now) return finishSnipe(id, "Bid FAILED", `Auction already closed: ${b.title || b.url}`);
      // Re-plan on every report, so an auto-extension moves the bid with it.
      const fireAt = m.endLocal - leadMs;
      if (!sn.staged) {
        clearTimeout(sn.stageT);
        sn.stageT = setTimeout(() => { sn.staged = true; port.postMessage({ stage: true }); }, Math.max(0, fireAt - STAGE_MS - now));
      }
      if (!sn.fired) {
        clearTimeout(sn.fireT);
        sn.fireT = setTimeout(() => { sn.fired = true; port.postMessage({ fire: true }); }, Math.max(0, fireAt - now));
      }
    }
    if (m.done) {
      const when = m.firedBeforeEndMs == null ? "" : ` ${(m.firedBeforeEndMs / 1000).toFixed(1)}s before close`;
      if (m.dry) return finishSnipe(id, "Dry run OK", `Would have bid ${money(b.amount)}${when}`);
      if (m.ok) finishSnipe(id, "Bid placed", `${money(b.amount)}${when} on ${b.title || "listing"}` +
        (m.autoBid ? " (as Autobid max)" : "") + (m.highBidder ? ". You're the high bidder." : ""));
      else finishSnipe(id, "Bid FAILED", m.error || "Unknown error. Check the tab.");
    }
  });
  port.onDisconnect.addListener(() => {
    if (id) finishSnipe(id, "Bid FAILED", "The listing tab closed or reloaded before the bid went in.");
  });
});

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
        const leadSec = msg.leadSec && msg.endsAt ? +msg.leadSec : null;
        const when = leadSec ? msg.endsAt - leadSec * 1000 : msg.when;
        bids[id] = { url: msg.url, amount: msg.amount, when, title: msg.title || "",
          ...(leadSec ? { leadSec, endsAt: msg.endsAt } : {}), ...(msg.dryRun ? { dryRun: true } : {}) };
        await local.set({ bids });
        chrome.alarms.create(id, { when: leadSec ? Math.max(Date.now() + 500, when - ARM_MS) : when });
        return { id };
      }
      case "getEnd": {
        // For a listing URL that isn't open: read it in a hidden tab.
        return await readPage(msg.url, { type: "getEnd" });
      }
      case "cancelBid": {
        if (snipes.has(msg.id)) await finishSnipe(msg.id, "Bid cancelled", "Nothing was bid.");
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
