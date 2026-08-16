function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderPreviewHtml(documentId: string, apiBaseUrl: string): string {
  const safeDocumentId = escapeHtml(documentId);
  const safeApi = escapeHtml(apiBaseUrl.replace(/\/$/, ''));
  const watermarkText = `PROTECTED • ${documentId}`;

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><rect width='100%' height='100%' fill='none'/><text x='130' y='135' font-family='Arial, sans-serif' font-size='13' letter-spacing='2' fill='rgba(0,0,0,0.12)' text-anchor='middle' transform='rotate(-32 130 130)'>${watermarkText}</text></svg>`;
  const watermarkDataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Protected Document</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: #2b2d31;
    color: #e4e4e7;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    user-select: none;
    -webkit-user-select: none;
    overscroll-behavior: none;
  }
  .page {
    position: relative;
    display: block;
    width: min(860px, 94vw);
    margin: 16px auto;
    background: #ffffff;
    border-radius: 6px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.45);
    overflow: hidden;
  }
  .page img { display: block; width: 100%; height: auto; }
  .watermark-overlay {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 9999;
    background: url('${watermarkDataUri}') repeat;
  }
  .status {
    position: sticky;
    top: 0;
    z-index: 10000;
    text-align: center;
    padding: 8px;
    font-size: 13px;
    background: rgba(20, 20, 24, 0.92);
    backdrop-filter: blur(4px);
  }
  .loading { padding: 60px 16px 16px; text-align: center; color: #a1a1aa; }
  .error { color: #f87171; }
  @media print {
    body { visibility: hidden; display: none; }
  }
</style>
</head>
<body>
  <div class="status" id="status">Loading document…</div>
  <div class="watermark-overlay"></div>
  <div class="loading" id="loading">Preparing protected pages…</div>
  <main id="pages"></main>
<script>
(function () {
  var api = "${safeApi}";
  var docId = "${safeDocumentId}";
  var pageContainer = document.getElementById("pages");
  var statusEl = document.getElementById("status");
  var loadingEl = document.getElementById("loading");
  var pages = [];
  var renewing = false;

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function fetchSession() {
    return fetch(api + "/" + docId + "/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    }).then(function (res) {
      if (!res.ok) throw new Error("Session request failed");
      return res.json();
    }).then(function (json) {
      return json.value.pages;
    });
  }

  function renderPage(item) {
    var wrap = document.createElement("div");
    wrap.className = "page";
    var img = document.createElement("img");
    img.alt = "Page " + item.page;
    img.decoding = "async";
    img.onerror = function () { retryOnExpired(item, img, 0); };
    wrap.appendChild(img);
    return { wrap: wrap, img: img };
  }

  function retryOnExpired(item, img, attempt) {
    if (attempt >= 2 || renewing) return;
    renewing = true;
    statusEl.textContent = "Re-authenticating…";
    fetchSession().then(function (newPages) {
      pages = newPages;
      var next = pages.find(function (p) { return p.page === item.page; });
      if (next) {
        img.src = next.url;
        img.onerror = function () { retryOnExpired(item, img, attempt + 1); };
      }
    }).catch(function () {
      statusEl.textContent = "Session expired. Refresh to continue.";
    }).finally(function () { renewing = false; });
  }

  function loadSlide() {
    return fetchSession().then(function (newPages) {
      pages = newPages;
      if (!pages.length) throw new Error("No pages");
      pageContainer.innerHTML = "";
      if (loadingEl) loadingEl.style.display = "none";
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && entry.target.getAttribute("src") === null) {
            entry.target.setAttribute("src", entry.target.dataset.src || "");
            observer.unobserve(entry.target);
          }
        });
      }, { rootMargin: "400px 0px" });

      pages.forEach(function (item) {
        var r = renderPage(item);
        r.img.dataset.src = item.url;
        r.wrap.id = "page-" + item.page;
        pageContainer.appendChild(r.wrap);
        observer.observe(r.img);
      });
      setStatus(pages.length + " pages · protected viewer");
    });
  }

  loadSlide().catch(function (err) {
    setStatus("Unable to load document (" + err.message + ")");
    if (loadingEl) loadingEl.classList.add("error");
  });

  document.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  document.addEventListener("dragstart", function (e) { e.preventDefault(); });
  document.addEventListener("selectstart", function (e) { e.preventDefault(); });
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P" || e.key === "s" || e.key === "S")) {
      e.preventDefault();
    }
  });
})();
</script>
</body>
</html>`;
}
