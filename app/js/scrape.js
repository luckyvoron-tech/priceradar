/* Мост к нативной оболочке + извлечение данных с площадок.
   Скрипты-экстракторы выполняются ВНУТРИ страницы маркетплейса (скрытый WebView),
   поэтому используют обычный IP телефона и не зависят от CORS. */
const Scrape = (() => {
  const pending = {};

  window.__prResult = (id, raw) => {
    const p = pending[id];
    if (!p) return;
    delete pending[id];
    clearTimeout(p.timer);
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { msg = { ok: false, error: "Плохой ответ площадки" }; }
    if (msg.ok) p.resolve(msg.data);
    else p.reject(new Error(msg.error || "Площадка не ответила"));
  };

  function hasBridge() {
    return typeof window.AndroidBridge !== "undefined" && window.AndroidBridge.scrape;
  }

  function call(pageUrl, fn, args) {
    return callOnce(pageUrl, fn, args).catch((e) => {
      const msg = String((e && e.message) || e);
      // страница могла перезагрузиться после антибот-челленджа — один повтор
      if (!/Antibot|navigat|net::|ERR_|403|498|429/i.test(msg)) throw e;
      return new Promise((r) => setTimeout(r, 2000)).then(() => callOnce(pageUrl, fn, args));
    });
  }

  function callOnce(pageUrl, fn, args) {
    if (!hasBridge()) {
      return Promise.reject(new Error("Откройте приложение на телефоне — в браузере площадки недоступны"));
    }
    const id = "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const code =
      "(async()=>{try{const d=await (" + fn.toString() + ")(" + JSON.stringify(args || {}) + ");" +
      "PR.send(JSON.stringify({ok:true,data:d}));}catch(e){" +
      "PR.send(JSON.stringify({ok:false,error:String((e&&e.message)||e)}));}})()";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        delete pending[id];
        reject(new Error("Площадка не ответила вовремя"));
      }, 40000);
      pending[id] = { resolve, reject, timer };
      try { window.AndroidBridge.scrape(id, pageUrl, code); }
      catch (e) { delete pending[id]; clearTimeout(timer); reject(e); }
    });
  }

  // ---------- Wildberries ----------
  async function wbSearchExtractor(q) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (/Подозрительная|доступ.*запрещ/i.test(document.title)) await sleep(1500);
    const headers = {
      "Accept": "application/json",
      "x-requested-with": "XMLHttpRequest",
      "x-userid": "0",
      "x-spa-version": "14.33.0",
      "deviceid": "site_" + Math.random().toString(16).slice(2),
    };
    const query = encodeURIComponent(q);
    async function load(dest) {
      let u = "https://www.wildberries.ru/__internal/u-search/exactmatch/ru/common/v18/search"
        + "?appType=1&curr=rub&lang=ru&query=" + query
        + "&resultset=catalog&sort=popular&suppressSpellcheck=false";
      if (dest) u += "&dest=" + dest;
      const r = await fetch(u, { headers, credentials: "include" });
      if (!r.ok) throw new Error("WB " + r.status);
      return r.json();
    }
    let j;
    try { j = await load(null); } catch (e) { j = await load(-1257786); }
    let products = (j.products || []).slice(0, 24);
    const hasPrices = (arr) => arr.some((p) => (p.sizes || []).some((s) => s.price && s.price.product));
    if (!hasPrices(products)) {
      await sleep(2000);
      try { j = await load(-1257786); products = (j.products || []).slice(0, 24); } catch (e) {}
    }
    if (!products.length) throw new Error("Wildberries ничего не нашёл");
    function img(nm) {
      const vol = Math.floor(nm / 100000), part = Math.floor(nm / 1000);
      const ranges = [[143,"01"],[287,"02"],[431,"03"],[719,"04"],[1007,"05"],[1061,"06"],
        [1115,"07"],[1169,"08"],[1313,"09"],[1601,"10"],[1655,"11"],[1919,"12"],
        [2045,"13"],[2189,"14"],[2405,"15"],[2621,"16"],[2837,"17"],[3053,"18"],
        [3269,"19"],[3485,"20"],[3701,"21"],[3917,"22"],[4133,"23"],[4349,"24"],[4565,"25"]];
      let basket = "26";
      for (const [lim, b] of ranges) { if (vol <= lim) { basket = b; break; } }
      return "https://basket-" + basket + ".wbbasket.ru/vol" + vol + "/part" + part + "/" + nm + "/images/big/1.webp";
    }
    return products.map((p) => {
      let price = 0;
      for (const s of p.sizes || []) {
        if (s.price && s.price.product) { price = s.price.product / 100; break; }
      }
      return {
        marketplace: "wildberries",
        title: ((p.brand || "") + " " + (p.name || "")).trim(),
        price: price,
        oldPrice: 0,
        url: "https://www.wildberries.ru/catalog/" + p.id + "/detail.aspx",
        image: img(p.id),
        rating: Number(p.reviewRating || 0),
        reviews: Number(p.feedbacks || 0),
        brand: p.brand || "",
        article: String(p.id),
      };
    }).filter((o) => o.price > 0);
  }

  // ---------- Ozon ----------
  async function ozonSearchExtractor(q) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (/Antibot|Подтвердите|нет соединения/i.test(document.title)) await sleep(2500);
    const safeQ = String(q).replace(/[&?#]/g, " ");
    const url = "/api/composer-api.bx/page/json/v2?url="
      + encodeURIComponent("/search/?text=" + safeQ + "&from_global=true");
    const r = await fetch(url, { headers: { "Accept": "application/json" }, credentials: "include" });
    if (!r.ok) throw new Error("Ozon " + r.status);
    const j = await r.json();
    const out = [];
    function digits(t) { const m = String(t || "").replace(/[^\d]/g, ""); return m ? Number(m) : 0; }
    for (const key of Object.keys(j.widgetStates || {})) {
      if (!key.startsWith("tileGridDesktop") && !key.startsWith("searchResults")) continue;
      let block;
      try { block = JSON.parse(j.widgetStates[key]); } catch (e) { continue; }
      for (const it of block.items || []) {
        let title = "", price = 0, rating = 0;
        for (const atom of it.mainState || []) {
          const t = atom.type;
          if (t === "priceV2") {
            const arr = (atom.priceV2 && atom.priceV2.price) || [];
            const main = arr.find((p) => p.textStyle === "PRICE") || arr[0];
            if (main) price = digits(main.text);
          } else if (t === "textDS") {
            const txt = ((atom.textDS || {}).text || "").trim();
            const token = (atom.textDS || {}).typographyToken || "";
            if (txt && !/^[\d\s.,]+$/.test(txt) && (token === "tsBody500Medium" || txt.length > title.length)) {
              title = txt;
            }
          } else if (t === "labelListV2") {
            for (const li of (atom.labelListV2 || {}).items || []) {
              const txt = ((li.text || {}).text || "").trim();
              if (/^\d\.\d$/.test(txt)) rating = Number(txt);
            }
          }
        }
        let link = ((it.action || {}).link || "").split("?")[0];
        if (link.startsWith("/")) link = "https://www.ozon.ru" + link;
        let image = "";
        for (const im of ((it.tileImage || {}).items || [])) {
          const l = ((im.image || {}).link || "");
          if (l) { image = l; break; }
        }
        if (!title || !price || !link) continue;
        out.push({
          marketplace: "ozon",
          title: title.replace(/\s+/g, " "),
          price: price,
          url: link,
          image: image,
          rating: rating,
          reviews: 0,
          brand: title.split(/\s+/)[0] || "",
          article: String(it.sku || ""),
        });
      }
    }
    if (!out.length) throw new Error("Ozon: нет данных (антибот или пустая выдача)");
    return out.slice(0, 24);
  }

  // ---------- Яндекс Маркет ----------
  async function yandexSearchExtractor(q) {
    const out = [];
    function addProduct(p) {
      if (!p || p["@type"] !== "Product") return;
      const off = Array.isArray(p.offers) ? p.offers[0] : p.offers;
      const price = Number((off && off.price) || 0);
      if (!price) return;
      let image = p.image || "";
      if (Array.isArray(image)) image = image[0] || "";
      const brand = p.brand && typeof p.brand === "object" ? p.brand.name : (p.brand || "");
      out.push({
        marketplace: "ymarket",
        title: String(p.name || "").trim(),
        price: price,
        url: String((off && off.url) || p.url || ""),
        image: String(image),
        rating: Number(((p.aggregateRating || {}).ratingValue) || 0),
        reviews: Number(((p.aggregateRating || {}).reviewCount) || 0),
        brand: String(brand),
        article: "",
      });
    }
    function walk(x) {
      if (!x || typeof x !== "object") return;
      if (Array.isArray(x)) { x.forEach(walk); return; }
      if (x["@type"] === "ItemList") {
        (x.itemListElement || []).forEach((el) => walk(el.item || el));
      }
      if (x["@type"] === "Product") addProduct(x);
      if (x["@graph"]) walk(x["@graph"]);
    }
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { walk(JSON.parse(s.textContent)); } catch (e) {}
    }
    const seen = new Set();
    const uniq = out.filter((o) => {
      if (!o.url || seen.has(o.url)) return false;
      seen.add(o.url); return true;
    });
    if (!uniq.length) throw new Error("Яндекс Маркет: нет данных (капча или пустая выдача)");
    return uniq.slice(0, 24);
  }

  // ---------- М.Косметик (cosmetic.magnit.ru) ----------
  async function magnitSearchExtractor(q) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(800);
    const out = [];
    const seen = new Set();
    const links = Array.from(document.querySelectorAll('a[href*="/product/"]'));
    for (const a of links) {
      const href = (a.href || "").split("?")[0];
      if (!href || seen.has(href)) continue;
      let box = a;
      let text = "";
      for (let i = 0; i < 4 && box; i++) {
        text = box.innerText || "";
        if (/\d[\d\s]{2,}\s*₽/.test(text)) break;
        box = box.parentElement;
      }
      const pm = text.match(/(\d[\d\s]{2,})\s*₽/);
      if (!pm) continue;
      const img = box ? box.querySelector("img") : null;
      const title = ((a.textContent || "").trim() || (img && img.alt) || "").replace(/\s+/g, " ");
      if (!title || title.length < 3) continue;
      const idm = href.match(/\/product\/(\d+)/);
      seen.add(href);
      out.push({
        marketplace: "magnit",
        title: title,
        price: Number(pm[1].replace(/[^\d]/g, "")),
        url: href,
        image: img ? (img.src || "") : "",
        rating: 0,
        reviews: 0,
        brand: "",
        article: idm ? idm[1] : "",
      });
      if (out.length >= 24) break;
    }

    if (!out.length) {
      // запасной путь: JSON-LD
      const walk = (x) => {
        if (!x || typeof x !== "object") return;
        if (Array.isArray(x)) { x.forEach(walk); return; }
        if (x["@type"] === "ItemList") (x.itemListElement || []).forEach((el) => walk(el.item || el));
        if (x["@type"] === "Product") {
          const off = Array.isArray(x.offers) ? x.offers[0] : x.offers;
          const price = Number((off && off.price) || 0);
          if (price && x.name && x.url) {
            out.push({
              marketplace: "magnit", title: String(x.name), price: price,
              url: String(x.url), image: String(x.image || ""),
              rating: 0, reviews: 0, brand: "", article: "",
            });
          }
        }
      };
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try { walk(JSON.parse(s.textContent)); } catch (e) {}
      }
    }
    if (!out.length) throw new Error("М.Косметик: нет данных");
    return out;
  }

  // ---------- карточка по ссылке ----------
  async function productExtractor() {
    const host = location.hostname;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (/Antibot|Подтвердите|нет соединения/i.test(document.title)) await sleep(2500);
    function ldProduct() {
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        let data;
        try { data = JSON.parse(s.textContent); } catch (e) { continue; }
        const arr = Array.isArray(data) ? data : (data["@graph"] || [data]);
        for (const it of arr) {
          if (!it || it["@type"] !== "Product") continue;
          const off = Array.isArray(it.offers) ? it.offers[0] : it.offers;
          let image = it.image || "";
          if (Array.isArray(image)) image = image[0] || "";
          return {
            title: String(it.name || "").trim(),
            price: off ? Number(off.price || 0) : 0,
            image: String(image),
            rating: Number(((it.aggregateRating || {}).ratingValue) || 0),
            reviews: Number(((it.aggregateRating || {}).reviewCount) || 0),
            brand: String((it.brand && it.brand.name) || it.brand || ""),
            article: String(it.sku || ""),
            url: String((off && off.url) || it.url || location.href),
          };
        }
      }
      return null;
    }

    if (host.includes("ozon")) {
      const p = ldProduct() || {};
      let price = p.price || 0;
      for (const el of document.querySelectorAll("[data-state]")) {
        const st = el.getAttribute("data-state") || "";
        if (st.indexOf("cardPrice") < 0) continue;
        const m = st.match(/cardPrice"\s*:\s*"([^"]+)"/);
        if (m) { const d = Number(m[1].replace(/[^\d]/g, "")); if (d) price = d; break; }
      }
      const og = document.querySelector('meta[property="og:title"]');
      const title = (p.title || (og && og.content) || document.title).replace(/\s*\|\s*купить.*$/i, "").trim();
      if (!title || !price) throw new Error("Ozon не отдал карточку (антибот)");
      return {
        marketplace: "ozon", title: title, price: price,
        url: location.href.split("?")[0], image: p.image || "",
        rating: p.rating || 0, reviews: p.reviews || 0,
        brand: p.brand || "", article: p.article || "",
      };
    }

    if (host.includes("wildberries")) {
      const og = document.querySelector('meta[property="og:title"]');
      const title = ((og && og.content) || document.title).replace(/\s*купить за.*$/i, "").trim();
      let price = 0;
      const m = document.title.match(/купить за\s*([\d\s\u2009\u202f]+)\s*₽/);
      if (m) price = Number(m[1].replace(/[^\d]/g, ""));
      const nm = (location.pathname.match(/catalog\/(\d+)/) || [])[1];
      if (!price && nm) {
        const u = "https://www.wildberries.ru/__internal/u-card/cards/v4/detail?appType=1&curr=rub"
          + "&dest=1259570991&mtype=257&lang=ru&ab_testing=false&nm=" + nm;
        const r = await fetch(u, {
          headers: {
            "Accept": "application/json", "x-requested-with": "XMLHttpRequest",
            "x-userid": "0", "x-spa-version": "14.33.0",
            "deviceid": "site_" + Math.random().toString(16).slice(2),
          }, credentials: "include",
        });
        if (r.ok) {
          const j = await r.json();
          const p = (j.products || [])[0];
          if (p) {
            for (const s of p.sizes || []) if (s.price && s.price.product) { price = s.price.product / 100; break; }
          }
        }
      }
      if (!title || !price) throw new Error("Wildberries не отдал карточку");
      return {
        marketplace: "wildberries", title: title, price: price,
        url: "https://www.wildberries.ru/catalog/" + (nm || "") + "/detail.aspx",
        image: "", rating: 0, reviews: 0, brand: "", article: nm || "",
      };
    }

    if (host.includes("magnit")) {
      const p = ldProduct();
      if (p && p.price) return Object.assign({ marketplace: "magnit" }, p);
      const og = document.querySelector('meta[property="og:title"]');
      const text = document.body ? document.body.innerText : "";
      const m = text.match(/(\d[\d\s]{2,})\s*₽/);
      if (og && m) {
        return {
          marketplace: "magnit",
          title: og.content.replace(/\s+/g, " ").trim(),
          price: Number(m[1].replace(/[^\d]/g, "")),
          url: location.href.split("?")[0],
          image: "", rating: 0, reviews: 0, brand: "", article: "",
        };
      }
      throw new Error("М.Косметик не отдал карточку");
    }

    const p = ldProduct();
    if (!p || !p.price) throw new Error("Не удалось разобрать страницу товара");
    return Object.assign({ marketplace: "ymarket" }, p);
  }

  // ---------- площадки ----------
  const COSMETIC_RE = /крем|космет|маск|шампун|помад|туш|парфюм|духи|сыворот|гель|лак|пудр|тональн|уход|бальзам|скраб|дезодор|зубн|мыло|кондиционер|макияж|блеск|карандаш|тени|румяна|хайлайтер|мицелляр|патч|маникюр|педикюр|парфюмер/i;

  const PLATFORMS = [
    {
      key: "wildberries", label: "Wildberries",
      page: (q) => "https://www.wildberries.ru/catalog/0/search.aspx?search=" + encodeURIComponent(q),
      search: wbSearchExtractor,
    },
    {
      key: "ozon", label: "Ozon",
      page: (q) => "https://www.ozon.ru/search/?text=" + encodeURIComponent(q),
      search: ozonSearchExtractor,
    },
    {
      key: "ymarket", label: "Яндекс Маркет",
      page: (q) => "https://market.yandex.ru/search?text=" + encodeURIComponent(q),
      search: yandexSearchExtractor,
    },
    {
      key: "magnit", label: "М.Косметик", beta: true,
      when: (seed) => COSMETIC_RE.test(String(seed.title || "")),
      page: (q) => "https://cosmetic.magnit.ru/search/?text=" + encodeURIComponent(q),
      search: magnitSearchExtractor,
    },
  ];

  function marketplaceOf(url) {
    try {
      const h = new URL(url).hostname;
      if (h.endsWith("wildberries.ru") || h === "wb.ru") return "wildberries";
      if (h.endsWith("ozon.ru")) return "ozon";
      if (h.endsWith("market.yandex.ru")) return "ymarket";
      if (h.endsWith("cosmetic.magnit.ru") || h === "magnit.ru") return "magnit";
    } catch (e) {}
    return null;
  }

  async function byUrl(url) {
    const off = await call(url, productExtractor, {});
    if (!off.marketplace) off.marketplace = marketplaceOf(url) || "ozon";
    return off;
  }

  async function search(platform, q) {
    const p = PLATFORMS.find((x) => x.key === platform);
    if (!p) return [];
    const arr = await call(p.page(q), p.search, q);
    return (arr || []).filter((o) => o && o.price > 0);
  }

  async function compare(seed, onProgress) {
    const same = [];
    const similar = [];
    const errors = {};
    for (const p of PLATFORMS) {
      if (p.when && !p.when(seed)) continue;
      if (onProgress) onProgress(p.label);
      try {
        const offers = await search(p.key, seed.title);
        for (const o of offers) {
          o.marketplaceLabel = p.label;
          if (o.url === seed.url) continue;
          const m = Match.match(seed, o);
          o.matchScore = m.score;
          o.matchReason = m.reason;
          if (m.isSame) same.push(o);
          else if (m.isSimilar) similar.push(o);
        }
      } catch (e) {
        if (!p.beta) errors[p.key] = e.message || String(e);
      }
    }
    // лучшее предложение каждой площадки
    const best = {};
    for (const o of same) {
      const cur = best[o.marketplace];
      const price = o.price;
      if (!cur || price < cur.price) best[o.marketplace] = o;
    }
    const sameList = Object.values(best).sort((a, b) => a.price - b.price);
    similar.sort((a, b) => Match.valueRank(b.price, b.rating, b.reviews) -
                          Match.valueRank(a.price, a.rating, a.reviews));
    return { same: sameList, similar: similar.slice(0, 6), errors };
  }

  async function findSeed(query, onStep) {
    if (/^https?:\/\//i.test(query)) {
      if (onStep) onStep("Открываю ссылку…");
      return await byUrl(query);
    }
    const errors = [];
    for (const p of PLATFORMS) {
      if (p.when && !p.when({ title: query })) continue;
      if (onStep) onStep("Ищу на " + p.label + "…");
      try {
        const arr = await search(p.key, query);
        if (arr.length) {
          return arr.find((o) => !Match.isRefurb(o.title)) || arr[0];
        }
      } catch (e) {
        if (!p.beta) errors.push(p.label + ": " + (e.message || e));
      }
    }
    const detail = errors.length ? " (" + errors.join("; ") + ")" : "";
    throw new Error("Ничего не нашлось" + detail + ". Уточните название, выключите VPN или вставьте ссылку.");
  }

  return { call, byUrl, search, compare, findSeed, PLATFORMS, marketplaceOf, hasBridge };
})();
