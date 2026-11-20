const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage(m);
const isListingUrl = (u) => /^https:\/\/www\.govdeals\.com\/.*asset\/\d+\/\d+/i.test(u || "");
const fmt = (ms) => new Date(ms).toLocaleString(undefined,
  { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

let end = null;        // { endsAt, exact, clockSkewMs, title, url } for the URL in the box

async function refresh() {
  const { bids = {} } = await chrome.storage.local.get("bids");
  const list = $("list");
  list.innerHTML = "";
  for (const [id, b] of Object.entries(bids).sort((a, z) => a[1].when - z[1].when)) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = `$${b.amount} · ` + (b.leadSec
      ? `${b.leadSec}s before close${b.armed ? " (armed)" : ""} · ${fmt(b.endsAt)}`
      : new Date(b.when).toLocaleString());
    span.title = b.title || b.url;
    const x = document.createElement("button");
    x.className = "secondary small";
    x.textContent = "Cancel";
    x.onclick = async () => { await send({ type: "cancelBid", id }); refresh(); };
    li.append(span, x);
    list.appendChild(li);
  }
}

function showEnd() {
  const el = $("ends");
  if (!end) { el.textContent = ""; return; }
  if (!end.endsAt) { el.textContent = "Couldn't read the closing time. Use “At a set time…”."; return; }
  const lead = $("lead").value;
  const left = end.endsAt - (Date.now() + (end.clockSkewMs || 0));
  const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000), s = Math.floor((left % 60000) / 1000);
  el.innerHTML = "";
  const line1 = document.createElement("div");
  line1.append("Closes ", Object.assign(document.createElement("b"), { textContent: fmt(end.endsAt) }),
    left > 0 ? ` (in ${h ? h + "h " : ""}${m}m ${s}s)` : " (closed)");
  el.appendChild(line1);
  if (lead !== "custom" && left > 0) {
    const line2 = document.createElement("div");
    line2.textContent = `Bid goes in at ${fmt(end.endsAt - lead * 1000)}` + (end.exact ? "" : " (time to the minute only)");
    el.appendChild(line2);
  }
  if (end.clockSkewMs != null && Math.abs(end.clockSkewMs) >= 1000) {
    const warn = document.createElement("div");
    warn.textContent = `Your PC clock is ${(Math.abs(end.clockSkewMs) / 1000).toFixed(1)}s ${end.clockSkewMs > 0 ? "slow" : "fast"}; GavelHawk corrects for it.`;
    el.appendChild(warn);
  }
}

// Load the close time: from the open tab when it's this listing, otherwise
// the background reads it in a hidden tab.
let loadSeq = 0;
async function loadEnd(url, tabId) {
  const seq = ++loadSeq;
  end = null;
  if (!isListingUrl(url)) { showEnd(); return; }
  $("ends").textContent = "Loading closing time…";
  let r = null;
  try {
    r = tabId != null ? await chrome.tabs.sendMessage(tabId, { type: "getEnd" }) : await send({ type: "getEnd", url });
  } catch {}
  if (seq !== loadSeq) return;
  end = r || { endsAt: null };
  if (r?.title) $("f").dataset.title = r.title;
  showEnd();
}

chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
  if (t?.url && isListingUrl(t.url)) {
    $("url").value = t.url;
    $("f").dataset.title = t.title || "";
    loadEnd(t.url, t.id);
  }
});
$("url").onchange = () => loadEnd($("url").value.trim());

// Remember the last lead time picked.
chrome.storage.local.get("lastLead").then(({ lastLead }) => { if (lastLead) $("lead").value = lastLead; onLead(); });
function onLead() {
  const custom = $("lead").value === "custom";
  $("when").classList.toggle("hidden", !custom);
  $("when").required = custom;
  showEnd();
}
$("lead").onchange = () => { chrome.storage.local.set({ lastLead: $("lead").value }); onLead(); };
setInterval(showEnd, 1000);

$("f").onsubmit = async (e) => {
  e.preventDefault();
  const url = $("url").value.trim();
  const amount = parseFloat($("amount").value);
  const lead = $("lead").value;
  if (!/^https:\/\/www\.govdeals\.com\//.test(url)) return alert("Enter a GovDeals listing URL");
  if (!(amount > 0)) return alert("Enter a bid amount");
  const title = $("f").dataset.title || "";
  if (lead === "custom") {
    const when = new Date($("when").value).getTime();
    if (!(when > Date.now())) return alert("Pick a future time");
    await send({ type: "scheduleBid", url, amount, when, title });
  } else {
    if (!end?.endsAt) return alert("Closing time not loaded yet. Wait a moment, or use “At a set time…”.");
    if (end.endsAt - lead * 1000 <= Date.now() + 15000) return alert("Too close to the end to schedule. Bid on the page instead.");
    await send({ type: "scheduleBid", url, amount, title, endsAt: end.endsAt, leadSec: +lead });
  }
  $("amount").value = "";
  refresh();
};
$("dash").onclick = () => chrome.runtime.openOptionsPage();
$("check").onclick = async (e) => {
  e.target.textContent = "Checking…";
  await send({ type: "checkNow" });
  e.target.textContent = "Check now";
};
chrome.storage.onChanged.addListener((ch) => { if (ch.bids) refresh(); });
refresh();
