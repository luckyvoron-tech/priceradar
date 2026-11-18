/* Интерфейс: экраны, карточки, поиск, треки, список, кэшбэк. */
const UI = (() => {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => new Intl.NumberFormat("ru-RU").format(Math.round(Number(n) || 0)) + " ₽";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  const state = { last: null, busy: false };

  function toast(text) {
    const el = $("toast");
    el.textContent = text;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), 2600);
  }

  function openUrl(url) {
    if (window.AndroidBridge && window.AndroidBridge.openUrl) window.AndroidBridge.openUrl(url);
    else window.open(url, "_blank");
  }

  function status(text, cls) {
    const el = $("status");
    el.innerHTML = text ? `<span class="${cls || ""}">${esc(text)}</span>` : "";
  }

  function tab(name) {
    document.querySelectorAll(".pane").forEach((p) => p.classList.remove("active"));
    document.querySelectorAll("#tabs .tab").forEach((b) => b.classList.remove("active"));
    const pane = $("tab-" + name);
    const btn = document.querySelector(`#tabs .tab[data-tab="${name}"]`);
    if (pane) pane.classList.add("active");
    if (btn) btn.classList.add("active");
    if (name === "tracks") renderTracks();
    if (name === "wish") renderWish();
    if (name === "help") loadCashback();
  }

  // ---------- карточки ----------
  function card(o, opts) {
    const cb = Store.cashbackFor(o.marketplace);
    const eff = Match.effectivePrice(o.price, cb);
    const best = opts && opts.best;
    const img = /^https?:\/\//.test(o.image || "")
      ? `<img src="${esc(o.image)}" loading="lazy" alt="" onerror="this.style.display='none'">` : "";
    const stars = o.rating ? ` · ⭐ ${Number(o.rating).toFixed(1)}` : "";
    const effLine = cb && Math.abs(eff - o.price) >= 1
      ? `<div class="meta">с кэшбэком ${cb}%: <b>${fmt(eff)}</b></div>` : "";
    const badge = best ? '<span class="badge cheap">выгоднее</span>' : "";
    return `<div class="card">${img}
      <div class="body">
        <div class="title">${esc(o.title)}</div>
        <div class="price ${best ? "best" : ""}">${fmt(o.price)}</div>
        ${effLine}
        <div class="meta">${esc(o.marketplaceLabel || o.marketplace)}${stars}</div>${badge}
      </div>
      <div class="btns">
        <button class="track-btn" data-act="track" data-url="${esc(o.url)}" title="Следить за ценой">🔔</button>
        <button class="track-btn" data-act="wish" data-url="${esc(o.url)}" title="В список">💜</button>
        <button class="track-btn" data-act="open" data-url="${esc(o.url)}" title="Открыть">↗</button>
      </div>
    </div>`;
  }

  const LABELS = { wildberries: "Wildberries", ozon: "Ozon", ymarket: "Яндекс Маркет", magnit: "М.Косметик" };
  const COSMETIC_RE = /крем|космет|маск|шампун|помад|туш|парфюм|духи|сыворот|гель|лак|пудр|тональн|уход|бальзам|скраб|дезодор|зубн|мыло|кондиционер|макияж|блеск|карандаш|тени|румяна|хайлайтер|мицелляр|патч|маникюр|педикюр|парфюмер/i;

  function isCosmetic(title) { return COSMETIC_RE.test(String(title || "")); }

  function openMagnitSetup() {
    if (window.AndroidBridge && window.AndroidBridge.openSetup) {
      window.AndroidBridge.openSetup("https://cosmetic.magnit.ru/");
    } else {
      openUrl("https://cosmetic.magnit.ru/");
    }
  }
  function label(mp) { return LABELS[mp] || mp; }

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
        if (act === "open") { openUrl(url); return; }
        const offer = offerById(url);
        if (!offer) return;
        if (act === "track") {
          Store.addTrack(offer);
          if (window.AndroidBridge && window.AndroidBridge.requestNotify) {
            try { window.AndroidBridge.requestNotify(); } catch (e) {}
          }
          toast("Слежу за ценой — покажу, когда подешевеет");
          if (window.AndroidBridge && window.AndroidBridge.toast) window.AndroidBridge.toast("Добавлено в отслеживание");
        } else if (act === "wish") {
          Store.addWish(offer.title, offer.price, offer.url);
          toast("Добавлено в список покупок 💜");
        }
      });
    });
  }

  // ---------- поиск ----------
  function renderSeed(seed) {
    $("search-empty").style.display = "none";
    const mp = seed.marketplaceLabel ? " · " + esc(seed.marketplaceLabel) : "";
    $("seed-card").innerHTML =
      `<div class="section-title">Ваш товар${mp}</div>` + card(seed, { best: false });
    bindCardActions($("seed-card"));
  }

  function renderPlatformStatus(statuses) {
    const el = $("platform-status");
    if (!el) return;
    const items = Object.values(statuses || {}).filter((s) => s.state === "error" || s.state === "empty");
    if (!items.length) { el.innerHTML = ""; return; }
    el.innerHTML = items.map((s) => {
      const text = s.state === "error"
        ? "не ответил — попробуйте ещё раз через минуту"
        : "ничего не нашлось";
      const icon = s.state === "error" ? "⚠️" : "🔍";
      return `<div class="pstatus ${s.state}">${icon} <span><b>${esc(s.label)}</b> — ${esc(text)}</span></div>`;
    }).join("");
  }

  function renderResults(seed, res) {
    const eff = (o) => Match.effectivePrice(o.price, Store.cashbackFor(o.marketplace));
    const same = (res.same || []).slice().sort((a, b) => eff(a) - eff(b));
    const similar = res.similar || [];
    if (!same.length) {
      $("results").innerHTML = `<div class="empty"><div class="empty-emoji">🤔</div>
        Точных совпадений на других площадках нет.<br>Попробуйте вставить ссылку на товар.</div>`;
    } else {
      const save = eff(same[same.length - 1]) - eff(same[0]);
      $("results").innerHTML =
        `<div class="section-title">Где дешевле${save > 0 ? " · выгода до " + fmt(save) : ""}</div>` +
        same.map((o, i) => card(o, { best: i === 0 })).join("");
      bindCardActions($("results"));
    }
    if (similar.length) {
      $("similar").innerHTML = `<div class="section-title">Похожее и выгодное</div>` +
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
    let cur = "1.0";
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

  async function doSearch(qArg) {
    let q = String(qArg || $("q").value).trim();
    if (q.length < 3 || state.busy) return;
    const direct = Scrape.extractUrl(q);
    if (direct) { q = direct; $("q").value = direct; }
    Store.addHistory(q);
    renderHistory();
    state.busy = true;
    $("seed-card").innerHTML = "";
    $("results").innerHTML = "";
    $("similar").innerHTML = "";
    $("platform-status").innerHTML = "";
    status("Ищу товар…", "progress");
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
      status(e.message || "Не получилось. Проверьте интернет и выключите VPN.", "");
      $("search-empty").style.display = "block";
    } finally {
      state.busy = false;
      $("q").value = "";
      updateClear();
    }
  }

  function updateClear() {
    const input = $("q");
    const btn = $("q-clear");
    if (!input || !btn) return;
    btn.classList.toggle("hidden", !input.value);
  }

  // ---------- треки ----------
  function sparkline(history) {
    if (!history || history.length < 2) return "";
    const pts = history.map((h) => h.price);
    const min = Math.min(...pts), max = Math.max(...pts);
    const w = 200, h = 34, n = pts.length;
    const xy = pts.map((p, i) =>
      `${(i / (n - 1)) * w},${h - 4 - ((p - min) / (max - min || 1)) * (h - 8)}`).join(" ");
    const color = pts[n - 1] < pts[0] ? "#2E9E5B" : "#E5484D";
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polyline points="${xy}" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
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
      $("tracks").innerHTML = `<div class="empty"><div class="empty-emoji">🔔</div>
        Пока пусто. Найдите товар и нажмите 🔔 —<br>сообщу, когда цена снизится.</div>`;
      return;
    }
    $("tracks").innerHTML = list.map((t) => {
      const adv = adviceFor(t);
      return `<div class="card">${/^https?:\/\//.test(t.image || "") ? `<img src="${esc(t.image)}" alt="">` : ""}
        <div class="body">
          <div class="title">${esc(t.title)}</div>
          <div class="price">${fmt(t.lastPrice)}</div>
          <div class="meta">${esc(label(t.marketplace))}</div>
          ${sparkline(t.history)}
          <div class="advice ${adv.cls}">${esc(adv.text)}</div>
        </div>
        <div class="btns">
          <button class="track-btn" data-tact="open" data-id="${esc(t.id)}">↗</button>
          <button class="track-btn danger" data-tact="del" data-id="${esc(t.id)}">✕</button>
        </div>
      </div>`;
    }).join("");
    $("tracks").querySelectorAll("[data-tact]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-id");
        const t = Store.tracks().find((x) => x.id === id);
        if (!t) return;
        if (b.getAttribute("data-tact") === "open") openUrl(t.url);
        else { Store.removeTrack(id); renderTracks(); toast("Убрано из отслеживания"); }
      });
    });
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
          if (r && r.price < r.old - 1 && window.AndroidBridge && window.AndroidBridge.notify) {
            window.AndroidBridge.notify("Цена снизилась 💜",
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
      $("wish").innerHTML = `<div class="empty"><div class="empty-emoji">💜</div>
        Список пуст. Добавьте, что хочется купить, —<br>и я спрошу через сутки, нужно ли ещё.</div>`;
      return;
    }
    $("wish").innerHTML = list.map((w) => {
      const left = w.remindAt - Date.now();
      const timer = left > 0
        ? `⏳ спрошу через ${Math.ceil(left / 3600000)} ч`
        : "⏳ скоро спрошу, всё ещё нужно ли";
      return `<div class="card">
        <div class="body">
          <div class="title">${esc(w.title)}</div>
          ${w.price ? `<div class="price">${fmt(w.price)}</div>` : ""}
          <div class="meta">${timer}</div>
        </div>
        <div class="btns">
          ${w.url ? `<button class="track-btn" data-wact="open" data-id="${esc(w.id)}">↗</button>` : ""}
          <button class="track-btn danger" data-wact="done" data-id="${esc(w.id)}">✔</button>
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
          if (w && w.url) openUrl(w.url);
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
      toast("Добавлено в список 💜");
    });
    $("cb-save").addEventListener("click", saveCashback);
    $("magnit-setup").addEventListener("click", openMagnitSetup);
    $("magnit-hint-btn").addEventListener("click", openMagnitSetup);
    $("onb-start").addEventListener("click", () => {
      Store.markOnboarding();
      $("onboarding").classList.add("hidden");
    });
    if (!Store.seenOnboarding()) $("onboarding").classList.remove("hidden");
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

  window.__prSetupDone = function () {
    Store.setMagnitStore();
    const hint = $("magnit-hint");
    if (hint) hint.classList.add("hidden");
    toast("Магазин М.Косметик выбран");
    const q = $("q").value.trim();
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
