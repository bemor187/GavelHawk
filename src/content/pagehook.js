// Runs in the page's own JavaScript world (manifest: "world": "MAIN") at
// document_start. It reads two responses GovDeals' app already fetches and
// forwards them to content.js with window.postMessage:
//   - the bid box (exact auction end in UTC, to the second)
//   - the server clock (to correct for a wrong PC clock)
// It makes no requests of its own and sends nothing anywhere else. Field
// parsing lives in selectors.js (GHParse.readApi); only the URL patterns are here.
(() => {
  const WANT = /maestro\.lqdt1\.com\/(buyers\/servertimestamp|bids\/bidbox\/)/i;
  // Keep the latest of each so content.js (which starts later, at
  // document_idle) can ask for a replay.
  const last = {};
  const post = (url, body, sentAt, recvAt) => {
    try {
      const msg = { __gavelhawk: 1, url, body: typeof body === "string" ? body : JSON.stringify(body), sentAt, recvAt };
      last[/bidbox/i.test(url) ? "bidbox" : "clock"] = msg;
      window.postMessage(msg, location.origin);
    } catch {}
  };
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.__gavelhawkReplay) Object.values(last).forEach((m) => window.postMessage(m, location.origin));
  });

  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ghUrl = String(url);
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (WANT.test(this.__ghUrl || "")) {
      const sentAt = Date.now();
      this.addEventListener("load", () => {
        try { post(this.__ghUrl, this.responseType === "" || this.responseType === "text" ? this.responseText : this.response, sentAt, Date.now()); } catch {}
      });
    }
    return send.apply(this, arguments);
  };

  const fetch0 = window.fetch;
  window.fetch = function (input) {
    const url = String((input && input.url) || input);
    const p = fetch0.apply(this, arguments);
    if (WANT.test(url)) {
      const sentAt = Date.now();
      p.then((r) => r.clone().text()).then((t) => post(url, t, sentAt, Date.now())).catch(() => {});
    }
    return p;
  };
})();
