/* Интерфейс: экраны, карточки, поиск, треки, список, кэшбэк. */
const UI = (() => {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => new Intl.NumberFormat("ru-RU").format(Math.round(Number(n) || 0)) + " ₽";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  const LABELS = { wildberries: "Wildberries", ozon: "Ozon", ymarket: "Яндекс Маркет", magnit: "М.Косметик", detmir: "Детский мир" };
  const COSMETIC_RE = /крем|космет|маск|шампун|помад|туш|парфюм|духи|сыворот|гель|лак|пудр|тональн|уход|бальзам|скраб|дезодор|зубн|мыло|кондиционер|макияж|блеск|карандаш|тени|румяна|хайлайтер|мицелляр|патч|маникюр|педикюр|парфюмер/i;
  const state = { last: null, busy: false, lastQuery: "", lastUrl: "" };
  let targetId = null;

  const CITIES = [
    { name: "Москва", lr: 213, a: ["moscow", "moskva"] },
    { name: "Санкт-Петербург", lr: 2, a: ["saint petersburg", "sankt-peterburg", "spb"] },
    { name: "Новосибирск", lr: 65, a: ["novosibirsk"] },
    { name: "Екатеринбург", lr: 54, a: ["yekaterinburg", "ekaterinburg"] },
    { name: "Казань", lr: 43, a: ["kazan"] },
    { name: "Нижний Новгород", lr: 47, a: ["nizhny novgorod", "nizhniy novgorod"] },
    { name: "Челябинск", lr: 56, a: ["chelyabinsk"] },
    { name: "Самара", lr: 51, a: ["samara"] },
    { name: "Омск", lr: 66, a: ["omsk"] },
    { name: "Ростов-на-Дону", lr: 39, a: ["rostov-on-don", "rostov"] },
    { name: "Уфа", lr: 172, a: ["ufa"] },
    { name: "Красноярск", lr: 62, a: ["krasnoyarsk"] },
    { name: "Воронеж", lr: 193, a: ["voronezh"] },
    { name: "Пермь", lr: 50, a: ["perm"] },
    { name: "Волгоград", lr: 38, a: ["volgograd"] },
    { name: "Краснодар", lr: 35, a: ["krasnodar"] },
    { name: "Саратов", lr: 194, a: ["saratov"] },
    { name: "Тюмень", lr: 55, a: ["tyumen"] },
    { name: "Владивосток", lr: 75, a: ["vladivostok"] },
    { name: "Хабаровск", lr: 76, a: ["khabarovsk"] },
    { name: "Иркутск", lr: 63, a: ["irkutsk"] },
    { name: "Сочи", lr: 239, a: ["sochi"] },
    { name: "Калининград", lr: 22, a: ["kaliningrad"] },
    { name: "Томск", lr: 67, a: ["tomsk"] },
    { name: "Барнаул", lr: 197, a: ["barnaul"] },
    { name: "Кемерово", lr: 64, a: ["kemerovo"] },
    { name: "Ярославль", lr: 16, a: ["yaroslavl"] },
    { name: "Тверь", lr: 14, a: ["tver"] },
  ];

  function cityByName(raw) {
    const s = String(raw || "").toLowerCase().trim();
    if (!s) return null;
    return CITIES.find((c) => c.name.toLowerCase() === s || (c.a || []).some((a) => s.indexOf(a) >= 0)) || null;
  }


  function toast(text) {
    const el = $("toast");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), 2600);
  }

  function openUrl(url) {
    if (window.AndroidBridge && window.AndroidBridge.openUrl) window.AndroidBridge.openUrl(url);
    else window.open(url, "_blank");
  }

  function openOffer(url, marketplace) {
    const target = window.Affiliate ? Affiliate.wrap(url, marketplace) : url;
    openUrl(target);
  }

  function label(mp) { return LABELS[mp] || mp || "Площадка"; }
  function isCosmetic(title) { return COSMETIC_RE.test(String(title || "")); }

  function status(text, cls) {
    const el = $("status");
    if (!el) return;
    el.innerHTML = text ? `<span class="${cls || ""}">${esc(text)}</span>` : "";
  }

  function tab(name) {
    document.body.classList.remove("tab-search", "tab-tracks", "tab-wish", "tab-help");
    document.body.classList.add("tab-" + name);
    document.querySelectorAll(".pane").forEach((p) => p.classList.remove("active"));
    document.querySelectorAll("#tabs .tab").forEach((b) => b.classList.remove("active"));
    const pane = $("tab-" + name);
    const btn = document.querySelector(`#tabs .tab[data-tab="${name}"]`);
    if (pane) pane.classList.add("active");
    if (btn) btn.classList.add("active");
    if (name === "tracks") renderTracks();
    if (name === "wish") renderWish();
    if (name === "help") loadCashback();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- карточки ----------
  function card(o, opts) {
    opts = opts || {};
    const cb = Store.cashbackFor(o.marketplace);
    const eff = Match.effectivePrice(o.price, cb);
    const best = !!opts.best;
    const seed = !!opts.seed;
    const img = /^https?:\/\//.test(o.image || "")
      ? `<img class="thumb" src="${esc(o.image)}" loading="lazy" alt="" onerror="this.style.display='none'">` : "";
    const stars = o.rating ? ` · ⭐ ${Number(o.rating).toFixed(1)}` : "";
    const word = o.offerCount === 2 || o.offerCount === 3 || o.offerCount === 4 ? "предложения" : "предложений";
    const offers = o.offerCount > 1 ? ` · ${o.offerCount} ${word}` : "";
    const effLine = cb && Math.abs(eff - o.price) >= 1
      ? `<div class="meta">с кэшбэком ${cb}%: <b>${fmt(eff)}</b></div>` : "";
    const old = o.oldPrice && o.oldPrice > o.price
      ? `<span class="old-price">${fmt(o.oldPrice)}</span>` : "";
    return `<article class="card ${best ? "best" : ""}">${img}
      <div class="body">
        <div class="title">${esc(o.title)}</div>
        <div class="price ${best ? "best" : ""}">${fmt(o.price)}${old}</div>
        ${effLine}
        <div class="meta"><span class="badge platform">${esc(label(o.marketplace))}</span>${stars}${offers}</div>
        ${best ? '<span class="badge cheap">лучшая цена</span>' : ""}
      </div>
      <div class="actions">
        <button class="buy-btn" data-act="open" data-url="${esc(o.url)}" data-mp="${esc(o.marketplace || "")}">${seed ? "Открыть" : "Купить"}</button>
        <button class="mini-btn" data-act="track" data-url="${esc(o.url)}" data-mp="${esc(o.marketplace || "")}" title="Следить за ценой">🔔</button>
        <button class="mini-btn" data-act="wish" data-url="${esc(o.url)}" data-mp="${esc(o.marketplace || "")}" title="В список">♡</button>
      </div>
    </article>`;
  }

  function offerById(url) {
    const all = [];
    if (state.last) {
      all.push(state.last.seed);
      all.push(...(state.last.res.same || []));
      all.push(...(state.last.res.similar || []));
    }
    all.push(...Store.tracks());
    return all.find((o) => o && o.url === url);
  }

  function bindCardActions(root) {
    root.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const url = btn.getAttribute("data-url");
        const act = btn.getAttribute("data-act");
        const mp = btn.getAttribute("data-mp") || "";
        if (act === "open") { openOffer(url, mp); return; }
        const offer = offerById(url);
        if (!offer) return;
        if (act === "track") {
          Store.addTrack(offer);
          if (window.AndroidBridge && window.AndroidBridge.requestNotify) {
            try { window.AndroidBridge.requestNotify(); } catch (e) {}
          }
          toast("Слежу за ценой — сообщу, когда подешевеет");
          if (window.AndroidBridge && window.AndroidBridge.toast) window.AndroidBridge.toast("Добавлено в отслеживание");
        } else if (act === "wish") {
          Store.addWish(offer.title, offer.price, offer.url, offer.marketplace);
          toast("Добавлено в список желаний 💜");
        }
      });
    });
  }

  // ---------- поиск ----------
  function renderSeed(seed) {
    const el = $("search-empty");
    if (el) el.style.display = "none";
    $("seed-card").innerHTML =
      `<div class="seed-box"><div class="seed-label">Ваш товар · ${esc(label(seed.marketplace))}</div>` +
      card(seed, { seed: true }) + `</div>`;
    bindCardActions($("seed-card"));
  }

  function renderPlatformStatus(statuses) {
    const el = $("platform-status");
    if (!el) return;
    const items = Object.values(statuses || {}).filter((s) => s.state === "error" || s.state === "empty");
    if (!items.length) { el.innerHTML = ""; return; }
    el.innerHTML = items.map((s) => {
      const text = s.state === "error" ? "не ответил — попробуйте ещё раз" : "ничего не нашлось";
      const icon = s.state === "error" ? "⚠️" : "🔍";
      return `<div class="pstatus ${s.state}">${icon} <span><b>${esc(s.label)}</b> — ${esc(text)}</span></div>`;
    }).join("");
  }

  function renderResults(seed, res) {
    const eff = (o) => Match.effectivePrice(o.price, Store.cashbackFor(o.marketplace));
    const same = (res.same || []).slice().sort((a, b) => eff(a) - eff(b));
    const similar = res.similar || [];
    if (!same.length) {
      $("results").innerHTML = `<div class="empty-state" style="padding-top:18px">
        <div class="empty-emoji">🤔</div>
        <h2>Точных совпадений нет</h2>
        <p>Попробуйте вставить ссылку на товар или уточнить название.</p></div>`;
    } else {
      const save = same.length > 1 ? eff(same[same.length - 1]) - eff(same[0]) : 0;
      $("results").innerHTML =
        `<div class="section-title"><span>Где дешевле</span>` +
        (save > 0 ? `<span class="savings">выгода ${fmt(save)}</span>` : "") + `</div>` +
        same.map((o, i) => card(o, { best: i === 0 })).join("");
      bindCardActions($("results"));
    }
    if (similar.length) {
      $("similar").innerHTML = `<div class="section-title"><span>Похожее и выгодное</span></div>` +
        similar.map((o) => card(o, {})).join("");
      bindCardActions($("similar"));
    } else {
      $("similar").innerHTML = "";
    }
    renderPlatformStatus(res.statuses);
    status("");
  }

  function renderHistory() {
    const h = Store.history();
    const el = $("history");
    if (!h.length) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="history-head"><span>Недавние</span><button id="history-clear">Очистить</button></div><div class="chips">` +
      h.map((q) => `<button class="chip" data-h="${esc(q)}">${esc(q)}</button>`).join("") + `</div>`;
    el.querySelectorAll("[data-h]").forEach((b) => b.addEventListener("click", () => {
      $("q").value = b.getAttribute("data-h");
      doSearch();
    }));
    $("history-clear").addEventListener("click", () => { Store.clearHistory(); renderHistory(); });
  }

  function cmpVer(a, b) {
    const pa = String(a).split(".").map((x) => parseInt(x, 10) || 0);
    const pb = String(b).split(".").map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  async function checkUpdate() {
    let cur = (window.APP_CONFIG && APP_CONFIG.version) || "1.0";
    try { if (window.AndroidBridge && window.AndroidBridge.version) cur = window.AndroidBridge.version(); } catch (e) {}
    try {
      const r = await fetch("https://api.github.com/repos/luckyvoron-tech/priceradar/releases/latest", {
        headers: { "Accept": "application/vnd.github+json" },
      });
      if (!r.ok) return;
      const j = await r.json();
      const tag = String(j.tag_name || "").replace(/^v/, "");
      if (tag && cmpVer(tag, cur) > 0 && Store.dismissedUpdate() !== tag) {
        $("update-ver").textContent = tag;
        $("update").classList.remove("hidden");
        const asset = (j.assets || []).find((a) => a.name === "PriceRadar.apk");
        const dl = asset ? asset.browser_download_url
          : "https://github.com/luckyvoron-tech/priceradar/releases/latest/download/PriceRadar.apk";
        $("update-go").onclick = () => openUrl(dl);
        $("update-close").onclick = () => { Store.dismissUpdate(tag); $("update").classList.add("hidden"); };
      }
    } catch (e) {}
  }

  function showOzonUnavailable(url) {
    const el = $("seed-error");
    if (!el) return;
    el.classList.remove("hidden");
    el.innerHTML = `<div><b>Ozon пока не сравнивается.</b><br>Площадка блокирует автоматические запросы. Карточку можно открыть — цена будет на самом Ozon.</div>` +
      `<button id="open-ozon" class="secondary-btn">Открыть карточку на Ozon</button>`;
    $("open-ozon").addEventListener("click", () => openOffer(url, "ozon"));
    status("Ozon: сравнение временно недоступно", "");
    const empty = $("search-empty");
    if (empty) empty.style.display = "none";
  }

  async function doSearch(qArg) {
    let q = String(qArg || $("q").value).trim();
    if (q.length < 3 || state.busy) return;
    const direct = Scrape.extractUrl(q);
    if (direct) { q = direct; $("q").value = direct; }
    state.lastQuery = q;
    state.lastUrl = direct || "";
    Store.addHistory(q);
    renderHistory();
    state.busy = true;
    $("seed-card").innerHTML = "";
    $("results").innerHTML = "";
    $("similar").innerHTML = "";
    $("platform-status").innerHTML = "";
    $("seed-error").classList.add("hidden");
    $("seed-error").innerHTML = "";
    status("Ищу товар…", "progress");

    if (direct && Scrape.marketplaceOf(direct) === "ozon" && !Scrape.ozonCompare()) {
      state.busy = false;
      $("q").value = "";
      updateClear();
      showOzonUnavailable(direct);
      return;
    }

    $("results").innerHTML = `<div class="skeleton"></div><div class="skeleton"></div>`;
    try {
      let seed = Store.cacheGet("seed:" + q.toLowerCase());
      if (seed && direct) {
        const expected = Scrape.marketplaceOf(direct);
        if (expected && seed.marketplace !== expected) seed = null;
      }
      if (!seed) {
        seed = await Scrape.findSeed(q, (s) => status(s, "progress"));
        Store.cacheSet("seed:" + q.toLowerCase(), seed);
      }
      seed.marketplaceLabel = label(seed.marketplace);
      renderSeed(seed);
      status("Сравниваю цены…", "progress");
      const res = await Scrape.compare(seed, (lab) => status("Сравниваю: " + lab + "…", "progress"));
      state.last = { seed, res };
      renderResults(seed, res);
      const hint = $("magnit-hint");
      if (hint) hint.classList.toggle("hidden", !(isCosmetic(seed.title) && !Store.magnitStore()));
    } catch (e) {
      $("results").innerHTML = "";
      if (direct) {
        showSeedError(e.message || "Не удалось открыть ссылку", direct);
      } else {
        status(e.message || "Не получилось. Проверьте интернет и выключите VPN.", "");
      }
      const empty = $("search-empty");
      if (empty) empty.style.display = "block";
    } finally {
      state.busy = false;
      $("q").value = "";
      updateClear();
    }
  }

  function showSeedError(msg, url) {
    const el = $("seed-error");
    if (!el) return;
    el.classList.remove("hidden");
    el.innerHTML = `<div>⚠️ ${esc(msg)}</div>` +
      `<button id="check-btn" class="secondary-btn">Открыть площадку</button>`;
    $("check-btn").addEventListener("click", () => {
      const mp = Scrape.marketplaceOf(url);
      if (mp === "ozon") openOffer(url, "ozon");
      else if (window.AndroidBridge && window.AndroidBridge.openCheck) window.AndroidBridge.openCheck(url);
      else openUrl(url);
    });
  }

  function updateClear() {
    const input = $("q");
    const btn = $("q-clear");
    if (!input || !btn) return;
    btn.classList.toggle("hidden", !input.value);
  }

  // ---------- город ----------
  function renderGeo() {
    const el = $("geo-city");
    const g = Store.geo();
    if (!el) return;
    el.textContent = g && g.city ? g.city : "Указать город";
    const btn = $("geo-btn");
    if (btn) btn.title = g && g.city ? "Цены для: " + g.city : "Выбрать город";
  }

  function applyGeo(g, source) {
    if (!g || (!g.city && !g.region)) return false;
    const known = cityByName(g.city) || cityByName(g.region);
    Store.setGeo({
      city: known ? known.name : String(g.city || g.region || "").slice(0, 60),
      lr: known ? known.lr : (g.lr || null),
      dest: g.dest || null,
      lat: g.lat || null,
      lon: g.lon || null,
      source: source || "auto",
    });
    renderGeo();
    return true;
  }

  function detectGeo() {
    if (!(window.AndroidBridge && window.AndroidBridge.detectGeo)) {
      toast("Определение города доступно в приложении на телефоне");
      return;
    }
    const el = $("geo-city");
    if (el) el.textContent = "Определяю…";
    try { window.AndroidBridge.detectGeo(); } catch (e) { renderGeo(); }
  }

  function openGeo() {
    const list = $("geo-list");
    if (list) {
      list.innerHTML = CITIES.map((c) =>
        `<button data-city="${esc(c.name)}">${esc(c.name)}</button>`).join("");
      list.querySelectorAll("[data-city]").forEach((b) => {
        b.addEventListener("click", () => {
          const c = CITIES.find((x) => x.name === b.getAttribute("data-city"));
          if (!c) return;
          Store.setGeo({ city: c.name, lr: c.lr, dest: null, source: "manual" });
          renderGeo();
          $("geo-modal").classList.add("hidden");
          toast("Город: " + c.name);
        });
      });
    }
    const g = Store.geo();
    $("geo-desc").textContent = g && g.city
      ? "Сейчас: " + g.city + ". Цены будут пересчитаны для выбранного города."
      : "Город нужен, чтобы площадки показывали цены и наличие для вашего региона.";
    $("geo-modal").classList.remove("hidden");
  }

  function renderMagnitState() {
    const state = $("magnit-state");
    const btn = $("magnit-setup");
    if (!state || !btn) return;
    if (Store.magnitStore()) {
      const name = Store.magnitName();
      state.textContent = name ? "Выбран: " + name : "Магазин выбран ✓";
      state.classList.add("ok");
      btn.textContent = "Изменить магазин";
    } else {
      state.textContent = "Магазин не выбран";
      state.classList.remove("ok");
      btn.textContent = "Выбрать магазин";
    }
  }

  // ---------- треки ----------
  function sparkline(history) {
    if (!history || history.length < 2) return "";
    const pts = history.map((h) => h.price);
    const min = Math.min(...pts), max = Math.max(...pts);
    const w = 200, h = 38, n = pts.length;
    const xy = pts.map((p, i) =>
      `${(i / (n - 1)) * w},${h - 5 - ((p - min) / (max - min || 1)) * (h - 10)}`).join(" ");
    const color = pts[n - 1] < pts[0] ? "#1F8A4C" : "#D63C48";
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polyline points="${xy}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  }

  function adviceFor(t) {
    const hist = t.history.slice(0, -1).map((h) => h.price).filter((p) => p > 0);
    if (hist.length < 3) return { cls: "unknown", text: "📊 Данных пока мало — понаблюдайте ещё." };
    const sorted = [...hist].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const min = sorted[0];
    if (t.lastPrice <= min * 1.02) return { cls: "buy", text: "🟢 Минимальная цена за всё время — можно брать." };
    if (t.lastPrice <= med * 0.97) return { cls: "buy", text: `🟢 Ниже типичной на ${Math.round((med - t.lastPrice) / med * 100)}% — хороший момент.` };
    if (t.lastPrice >= med * 1.08) return { cls: "wait", text: `🔴 Выше типичной на ${Math.round((t.lastPrice - med) / med * 100)}%. Можно подождать.` };
    return { cls: "unknown", text: "🟡 Цена около типичной." };
  }

  function renderTracks() {
    const list = Store.tracks();
    if (!list.length) {
      $("tracks").innerHTML = `<div class="empty-state"><div class="empty-emoji">🔔</div>
        <h2>Пока пусто</h2><p>Найдите товар и нажмите 🔔 — сообщу, когда цена снизится.</p></div>`;
      return;
    }
    $("tracks").innerHTML = list.map((t) => {
      const adv = adviceFor(t);
      return `<div class="track-card">
        <div class="track-top">
          ${/^https?:\/\//.test(t.image || "") ? `<img src="${esc(t.image)}" alt="">` : ""}
          <div class="body">
            <div class="title">${esc(t.title)}</div>
            <div class="price">${fmt(t.lastPrice)}</div>
            <div class="meta">${esc(label(t.marketplace))}</div>
            ${t.target ? `<div class="meta">🎯 цель ${fmt(t.target)}</div>` : ""}
          </div>
          <div class="track-actions">
            <button class="mini-btn" data-tact="target" data-id="${esc(t.id)}">🎯</button>
            <button class="mini-btn" data-tact="open" data-id="${esc(t.id)}">↗</button>
            <button class="mini-btn danger" data-tact="del" data-id="${esc(t.id)}">✕</button>
          </div>
        </div>
        ${sparkline(t.history)}
        <div class="advice ${adv.cls}">${esc(adv.text)}</div>
      </div>`;
    }).join("");
    $("tracks").querySelectorAll("[data-tact]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-id");
        const t = Store.tracks().find((x) => x.id === id);
        if (!t) return;
        const act = b.getAttribute("data-tact");
        if (act === "open") openOffer(t.url, t.marketplace);
        else if (act === "target") openTarget(t);
        else { Store.removeTrack(id); renderTracks(); toast("Убрано из отслеживания"); }
      });
    });
  }

  function openTarget(t) {
    targetId = t.id;
    $("target-input").value = t.target || "";
    $("target-desc").textContent = t.title.slice(0, 90);
    $("target-modal").classList.remove("hidden");
    setTimeout(() => $("target-input").focus(), 50);
  }

  function saveTarget() {
    if (!targetId) return;
    const v = parseInt($("target-input").value, 10);
    Store.setTarget(targetId, v);
    targetId = null;
    $("target-modal").classList.add("hidden");
    renderTracks();
    toast(v > 0 ? "Цель сохранена — сообщу, когда цена дойдёт" : "Цель убрана");
  }

  async function refreshTracks(quiet) {
    const all = Store.tracks();
    if (!all.length) { toast("Сначала добавьте товар в отслеживание"); return; }
    const list = all.slice(0, 5);
    $("refresh-tracks").disabled = true;
    let ok = 0, failed = 0;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      $("tracks-status").textContent = `Проверяю ${i + 1} из ${list.length}: ${t.title.slice(0, 30)}…`;
      try {
        const o = await Scrape.byUrl(t.url);
        if (o && o.price) {
          const r = Store.updateTrack(t.id, o.price);
          ok++;
          const hitTarget = !!(t.target && r && r.price <= t.target);
          if (r && (r.price < r.old - 1 || hitTarget) && window.AndroidBridge && window.AndroidBridge.notify) {
            window.AndroidBridge.notify(hitTarget ? "Цена достигла цели 🎯" : "Цена снизилась 💜",
              `${t.title.slice(0, 60)}\n${fmt(r.old)} → ${fmt(r.price)}`);
          }
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
      }
    }
    $("tracks-status").textContent = failed
      ? `Проверено ${ok} из ${list.length}, ${failed} не ответили. Попробуйте позже.`
      : `Обновлено: ${ok}${all.length > list.length ? " (первые " + list.length + ")" : ""}`;
    $("refresh-tracks").disabled = false;
    renderTracks();
    if (!quiet) toast(failed ? "Часть цен не удалось проверить" : "Цены обновлены");
  }

  // ---------- список покупок ----------
  function renderWish() {
    const list = Store.wish();
    if (!list.length) {
      $("wish").innerHTML = `<div class="empty-state"><div class="empty-emoji">♡</div>
        <h2>Список пуст</h2><p>Добавьте, что хочется купить, — спрошу через сутки, нужно ли ещё.</p></div>`;
      return;
    }
    $("wish").innerHTML = list.map((w) => {
      const left = w.remindAt - Date.now();
      const timer = left > 0
        ? `⏳ спрошу через ${Math.ceil(left / 3600000)} ч`
        : "⏳ скоро спрошу, всё ещё нужно ли";
      return `<div class="wish-card">
        <div class="body">
          <div class="title">${esc(w.title)}</div>
          ${w.price ? `<div class="price">${fmt(w.price)}</div>` : ""}
          <div class="meta">${timer}</div>
        </div>
        <div class="track-actions">
          ${w.url ? `<button class="mini-btn" data-wact="open" data-id="${esc(w.id)}">↗</button>` : ""}
          <button class="mini-btn danger" data-wact="done" data-id="${esc(w.id)}">✔</button>
        </div>
      </div>`;
    }).join("");
    $("wish").querySelectorAll("[data-wact]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-id");
        if (b.getAttribute("data-wact") === "done") {
          Store.wishDone(id); renderWish(); toast("Убрано — кошелёк доволен");
        } else {
          const w = Store.wish().find((x) => x.id === id);
          if (w && w.url) openOffer(w.url, w.marketplace);
        }
      });
    });
  }

  function showDueWish() {
    const due = Store.wishDue();
    if (!due.length) return;
    const w = due[0];
    $("wish-modal-text").innerHTML =
      `Вчера вы добавили: <b>${esc(w.title)}</b>${w.price ? " (~" + fmt(w.price) + ")" : ""}.<br><br>` +
      "Всё ещё хотите это купить? Импульс прошёл — это нормально 🙂";
    $("wish-modal").classList.remove("hidden");
    $("wish-yes").onclick = () => {
      Store.wishKeep(w.id); Store.wishMarkReminded(w.id);
      $("wish-modal").classList.add("hidden");
      toast("Хорошо, спрошу снова через 3 дня");
    };
    $("wish-no").onclick = () => {
      Store.wishDone(w.id); Store.wishMarkReminded(w.id);
      $("wish-modal").classList.add("hidden");
      toast("Убрано из списка");
    };
  }

  // ---------- кэшбэк ----------
  function loadCashback() {
    const cb = Store.getCashback();
    document.querySelectorAll(".cb").forEach((inp) => {
      inp.value = cb[inp.dataset.mp] || "";
    });
  }

  function saveCashback() {
    const map = {};
    document.querySelectorAll(".cb").forEach((inp) => {
      const v = parseFloat(inp.value);
      if (v > 0) map[inp.dataset.mp] = v;
    });
    Store.setCashback(map);
    toast("Кэшбэк сохранён");
    if (state.last) renderResults(state.last.seed, state.last.res);
  }

  // ---------- профиль ----------
  function shareApp() {
    const text = "PriceRadar — сравниваю цены на Wildberries, Яндекс Маркете и М.Косметик. " +
      "Скачать: https://github.com/luckyvoron-tech/priceradar/releases/latest/download/PriceRadar.apk";
    if (window.AndroidBridge && window.AndroidBridge.share) {
      window.AndroidBridge.share(text);
      return;
    }
    if (navigator.share) {
      navigator.share({ title: "PriceRadar", text: text }).catch(() => {});
      return;
    }
    if (window.AndroidBridge && window.AndroidBridge.copy) window.AndroidBridge.copy(text);
    else toast("Ссылка: " + text);
  }

  function openMagnitSetup() {
    if (window.AndroidBridge && window.AndroidBridge.openSetup) {
      window.AndroidBridge.openSetup("https://cosmetic.magnit.ru/");
    } else {
      openUrl("https://cosmetic.magnit.ru/");
    }
  }

  // ---------- запуск ----------
  function init() {
    Store.load();
    document.querySelectorAll("#tabs .tab").forEach((b) =>
      b.addEventListener("click", () => tab(b.dataset.tab)));
    $("go").addEventListener("click", () => doSearch());
    $("q").addEventListener("input", updateClear);
    $("q-clear").addEventListener("click", () => { $("q").value = ""; updateClear(); $("q").focus(); });
    $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
    document.querySelectorAll("#chips .chip").forEach((b) =>
      b.addEventListener("click", () => { $("q").value = b.dataset.q; doSearch(); }));
    $("help-btn").addEventListener("click", () => tab("help"));
    $("refresh-tracks").addEventListener("click", () => refreshTracks(false));
    $("wish-add").addEventListener("click", () => {
      const t = $("wish-input").value.trim();
      if (!t) return;
      Store.addWish(t);
      $("wish-input").value = "";
      renderWish();
      toast("Добавлено в список желаний 💜");
    });
    $("cb-save").addEventListener("click", saveCashback);
    $("magnit-setup").addEventListener("click", openMagnitSetup);
    $("geo-btn").addEventListener("click", openGeo);
    $("geo-cancel").addEventListener("click", () => $("geo-modal").classList.add("hidden"));
    $("geo-detect").addEventListener("click", () => { $("geo-modal").classList.add("hidden"); detectGeo(); });
    $("target-save").addEventListener("click", saveTarget);
    $("target-cancel").addEventListener("click", () => { targetId = null; $("target-modal").classList.add("hidden"); });
    $("magnit-hint-btn").addEventListener("click", openMagnitSetup);
    $("share-app").addEventListener("click", shareApp);
    $("open-issues").addEventListener("click", () => openUrl((window.APP_CONFIG && APP_CONFIG.issues) || "https://github.com/luckyvoron-tech/priceradar/issues"));
    $("privacy-btn").addEventListener("click", () => openUrl("https://luckyvoron-tech.github.io/priceradar/privacy.html"));
    $("onb-start").addEventListener("click", () => {
      Store.markOnboarding();
      $("onboarding").classList.add("hidden");
    });
    if (!Store.seenOnboarding()) $("onboarding").classList.remove("hidden");
    $("about-version").textContent = (window.APP_CONFIG && APP_CONFIG.version) || "2.0";
    const disc = $("affiliate-disclosure");
    if (disc && window.Affiliate) disc.textContent = Affiliate.disclosure();
    renderGeo();
    renderMagnitState();
    if (!Store.geo() && window.AndroidBridge && window.AndroidBridge.detectGeo) {
      setTimeout(() => { if (!Store.geo()) detectGeo(); }, 1200);
    }
    loadCashback();
    renderWish();
    renderHistory();
    setTimeout(checkUpdate, 1500);
    setTimeout(showDueWish, 1200);
    if (Store.tracks().length) setTimeout(() => refreshTracks(true), 4000);
    if (!Scrape.hasBridge()) {
      status("Это приложение работает только на телефоне: в браузере площадки блокируют запросы.", "");
    }
  }

  window.__prCheckDone = function () {
    const q = state.lastUrl || state.lastQuery;
    if (q) doSearch(q);
  };

  window.__prGeo = function (raw) {
    let g = null;
    try { g = JSON.parse(String(raw || "")); } catch (e) {}
    if (!g || !g.ok) {
      renderGeo();
      return;
    }
    if (applyGeo(g, "ip")) toast("Цены для города: " + Store.geo().city);
    else renderGeo();
  };

  window.__prSetupDone = function (name) {
    Store.setMagnitStore(name || "");
    renderMagnitState();
    const hint = $("magnit-hint");
    if (hint) hint.classList.add("hidden");
    toast("Магазин М.Косметик выбран");
    const q = state.lastQuery || $("q").value.trim();
    if (q.length >= 3) doSearch(q);
  };

  window.__prShared = function (text) {
    const raw = String(text || "");
    const m = raw.match(/https?:\/\/\S+/);
    const q = (m ? m[0] : raw).replace(/[).,;!]+$/, "").trim();
    if (!q) return;
    tab("search");
    $("q").value = q;
    doSearch(q);
  };

  return { init, doSearch, toast, tab };
})();
