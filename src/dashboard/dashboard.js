const { getSettings, trueCost, money, timeLeft } = GH;
const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage(m);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ago = (t) => (t ? Math.round((Date.now() - t) / 60000) + " min ago" : "never");

// ---------- tabs ----------
function showTab() {
  const id = (location.hash || "#watchlist").slice(1);
  document.querySelectorAll("section").forEach((s) => s.classList.toggle("active", s.id === id));
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.hash === "#" + id));
  if (id === "searches") send({ type: "clearNew" });
}
window.addEventListener("hashchange", showTab);

// ---------- watchlist ----------
async function renderWatchlist() {
  const s = await getSettings();
  const { watchlist = {} } = await chrome.storage.local.get("watchlist");
  const rows = Object.values(watchlist).sort((a, b) => (a.endsAt || 9e15) - (b.endsAt || 9e15));
  $("watchRows").innerHTML = rows.length ? rows.map((it) => {
    const c = trueCost(it.price || 0, s, it.miles);
    const out = it.myBid && it.price > it.myBid && !it.highBidder;
    const status = it.endsAt && it.endsAt < Date.now() ? "Ended"
      : it.highBidder ? '<span class="status-win">High bidder</span>'
      : out ? '<span class="status-out">Outbid</span>' : "—";
    return `<tr data-key="${esc(it.key)}">
      <td><a href="${esc(it.url)}" target="_blank">${esc(it.title || it.url)}</a><div class="hint">${esc(it.location || "")} · checked ${ago(it.lastChecked)}</div></td>
      <td class="num">${money(it.price)}</td>
      <td class="num"><b>${money(c.total)}</b></td>
      <td class="num ${it.miles > s.maxMiles ? "far" : ""}">${it.miles ?? "—"}</td>
      <td class="num">${timeLeft(it.endsAt)}</td>
      <td><input type="number" class="mybid" value="${it.myBid ?? ""}" placeholder="$"></td>
      <td>${status}</td>
      <td><button class="danger small rm">Remove</button></td></tr>`;
  }).join("") : `<tr><td colspan="8" class="empty">Nothing watched yet.</td></tr>`;
}
$("watchRows").addEventListener("click", async (e) => {
  if (!e.target.classList.contains("rm")) return;
  const key = e.target.closest("tr").dataset.key;
  const { watchlist = {} } = await chrome.storage.local.get("watchlist");
  delete watchlist[key];
  await chrome.storage.local.set({ watchlist });
});
$("watchRows").addEventListener("change", async (e) => {
  if (!e.target.classList.contains("mybid")) return;
  const key = e.target.closest("tr").dataset.key;
  const { watchlist = {} } = await chrome.storage.local.get("watchlist");
  if (watchlist[key]) { watchlist[key].myBid = parseFloat(e.target.value) || null; delete watchlist[key].alertedOutbidAt; }
  await chrome.storage.local.set({ watchlist });
});

// ---------- saved searches ----------
async function renderSearches() {
  const { searches = {} } = await chrome.storage.local.get("searches");
  const list = Object.values(searches);
  const n = list.reduce((a, x) => a + (x.newCount || 0), 0);
  $("newBadge").hidden = !n; $("newBadge").textContent = n;
  $("searchList").innerHTML = list.length ? list.map((x) => `
    <div class="card" data-id="${esc(x.id)}">
      <b>${esc(x.name)}</b>
      <div class="meta">${x.maxPrice ? "Under " + money(x.maxPrice) + " · " : ""}${(x.seen || []).length} seen · checked ${ago(x.lastChecked)}</div>
      <div class="row"><a href="${esc(x.url)}" target="_blank"><button class="secondary small">Open</button></a>
      <button class="danger small rm">Delete</button></div>
    </div>`).join("") : `<div class="empty">No saved searches yet.</div>`;
}
$("searchList").addEventListener("click", async (e) => {
  if (!e.target.classList.contains("rm")) return;
  const id = e.target.closest(".card").dataset.id;
  const { searches = {} } = await chrome.storage.local.get("searches");
  delete searches[id];
  await chrome.storage.local.set({ searches });
});
$("searchForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!/^https:\/\/www\.govdeals\.com\//.test($("sUrl").value)) return alert("Paste a GovDeals search URL");
  await send({ type: "saveSearch", search: { name: $("sName").value.trim(), url: $("sUrl").value.trim(), maxPrice: parseFloat($("sMax").value) || null } });
  e.target.reset();
};

// ---------- scheduled bids ----------
async function renderBids() {
  const { bids = {} } = await chrome.storage.local.get("bids");
  const rows = Object.entries(bids).sort((a, b) => a[1].when - b[1].when);
  $("bidRows").innerHTML = rows.length ? rows.map(([id, b]) => `
    <tr data-id="${esc(id)}"><td><a href="${esc(b.url)}" target="_blank">${esc(b.title || b.url)}</a></td>
    <td class="num">${money(b.amount)}</td><td class="num">${b.leadSec ? `${b.leadSec}s before close${b.armed ? " (armed)" : ""}<br>` : ""}${new Date(b.when).toLocaleString()}</td>
    <td><button class="danger small rm">Cancel</button></td></tr>`).join("")
    : `<tr><td colspan="4" class="empty">No bids scheduled.</td></tr>`;
}
$("bidRows").addEventListener("click", async (e) => {
  if (e.target.classList.contains("rm")) await send({ type: "cancelBid", id: e.target.closest("tr").dataset.id });
});
$("bidForm").onsubmit = async (e) => {
  e.preventDefault();
  const url = $("bUrl").value.trim(), amount = parseFloat($("bAmt").value), when = new Date($("bWhen").value).getTime();
  if (!/^https:\/\/www\.govdeals\.com\//.test(url)) return alert("Enter a GovDeals listing URL");
  if (!(when > Date.now())) return alert("Pick a future time");
  const { watchlist = {} } = await chrome.storage.local.get("watchlist");
  const title = Object.values(watchlist).find((w) => w.url === url)?.title || "";
  await send({ type: "scheduleBid", url, amount, when, title });
  e.target.reset();
};

// ---------- notes ----------
async function renderNotes() {
  const { notes = {} } = await chrome.storage.local.get("notes");
  const list = Object.entries(notes).sort((a, b) => b[1].updated - a[1].updated);
  $("noteList").innerHTML = list.length ? list.map(([k, n]) => `
    <div class="card" data-key="${esc(k)}">
      <a href="${esc(n.url)}" target="_blank"><b>${esc(n.title || n.url)}</b></a>
      <textarea class="note" rows="3">${esc(n.text)}</textarea>
      <div class="row"><span class="meta">Edited ${new Date(n.updated).toLocaleDateString()}</span>
      <button class="danger small rm">Delete</button></div>
    </div>`).join("") : `<div class="empty">No notes yet.</div>`;
}
$("noteList").addEventListener("change", async (e) => {
  if (!e.target.classList.contains("note")) return;
  const k = e.target.closest(".card").dataset.key;
  const { notes = {} } = await chrome.storage.local.get("notes");
  notes[k] = { ...notes[k], text: e.target.value, updated: Date.now() };
  await chrome.storage.local.set({ notes });
});
$("noteList").addEventListener("click", async (e) => {
  if (!e.target.classList.contains("rm")) return;
  const k = e.target.closest(".card").dataset.key;
  const { notes = {} } = await chrome.storage.local.get("notes");
  delete notes[k];
  await chrome.storage.local.set({ notes });
});

// ---------- settings ----------
async function loadSettings() {
  const s = await getSettings(), f = $("settingsForm");
  for (const [k, v] of Object.entries(s)) {
    const el = f.elements[k];
    if (!el) continue;
    if (el.type === "checkbox") el.checked = !!v; else el.value = v;
  }
}
$("settingsForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, cur = await getSettings(), next = { ...cur };
  for (const el of f.elements) {
    if (!el.name) continue;
    next[el.name] = el.type === "checkbox" ? el.checked : el.type === "number" ? parseFloat(el.value) || 0 : el.value.trim();
  }
  if (next.homeZip !== cur.homeZip) {
    // Distances are relative to home, so clear them to be recalculated.
    const { watchlist = {} } = await chrome.storage.local.get("watchlist");
    Object.values(watchlist).forEach((w) => (w.miles = null));
    await chrome.storage.local.set({ watchlist });
  }
  await chrome.storage.local.set({ settings: next });
  $("saved").textContent = "Saved ✓";
  setTimeout(() => ($("saved").textContent = ""), 2000);
};

$("export").onclick = async () => {
  const { settings, watchlist, searches, notes, bids } = await chrome.storage.local.get(null);
  const blob = new Blob([JSON.stringify({ settings, watchlist, searches, notes, bids }, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "gavelhawk-backup.json" });
  a.click();
};
$("import").onchange = async (e) => {
  try {
    const data = JSON.parse(await e.target.files[0].text());
    const keep = ["settings", "watchlist", "searches", "notes"];
    await chrome.storage.local.set(Object.fromEntries(keep.filter((k) => data[k]).map((k) => [k, data[k]])));
    alert("Imported. Scheduled bids aren't imported; set those again.");
    loadSettings();
  } catch { alert("That file isn't a GavelHawk backup."); }
};

$("checkNow").onclick = async (e) => {
  e.target.textContent = "Checking…"; e.target.disabled = true;
  await send({ type: "checkNow" });
  e.target.textContent = "Check now"; e.target.disabled = false;
};

// ---------- live updates ----------
function renderAll() { renderWatchlist(); renderSearches(); renderBids(); renderNotes(); }
chrome.storage.onChanged.addListener((ch) => {
  if (ch.watchlist || ch.settings) renderWatchlist();
  if (ch.searches) renderSearches();
  if (ch.bids) renderBids();
  if (ch.notes) renderNotes();
});
setInterval(renderWatchlist, 60000); // keep "time left" current
showTab(); loadSettings(); renderAll();
