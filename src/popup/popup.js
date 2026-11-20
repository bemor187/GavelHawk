const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage(m);

async function refresh() {
  const { bids = {} } = await chrome.storage.local.get("bids");
  const list = $("list");
  list.innerHTML = "";
  for (const [id, b] of Object.entries(bids).sort((a, z) => a[1].when - z[1].when)) {
    const li = document.createElement("li");
    li.innerHTML = `<span>$${b.amount} · ${new Date(b.when).toLocaleString()}</span>`;
    const x = document.createElement("button");
    x.className = "secondary small";
    x.textContent = "Cancel";
    x.onclick = async () => { await send({ type: "cancelBid", id }); refresh(); };
    li.appendChild(x);
    list.appendChild(li);
  }
}

// Prefill the URL when the popup is opened on a listing.
chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
  if (t?.url && /govdeals\.com\/.*asset\//i.test(t.url)) { $("url").value = t.url; $("f").dataset.title = t.title || ""; }
});

$("f").onsubmit = async (e) => {
  e.preventDefault();
  const url = $("url").value.trim();
  const amount = parseFloat($("amount").value);
  const when = new Date($("when").value).getTime();
  if (!/^https:\/\/www\.govdeals\.com\//.test(url)) return alert("Enter a GovDeals listing URL");
  if (!(amount > 0)) return alert("Enter a bid amount");
  if (!(when > Date.now())) return alert("Pick a future time");
  await send({ type: "scheduleBid", url, amount, when, title: $("f").dataset.title || "" });
  $("amount").value = "";
  refresh();
};
$("dash").onclick = () => chrome.runtime.openOptionsPage();
$("check").onclick = async (e) => {
  e.target.textContent = "Checking…";
  await send({ type: "checkNow" });
  e.target.textContent = "Check now";
};
refresh();
