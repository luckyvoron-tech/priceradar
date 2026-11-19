/* Локальное хранилище: всё лежит на телефоне, никуда не отправляется. */
const Store = (() => {
  const KEY = "priceradar.v1";
  const defaultData = () => ({
    tracks: [],
    wish: [],
    cashback: {},
    onboarding: false,
    cache: {},
    history: [],
    dismissedUpdate: "",
    magnitStore: false,
    magnitName: "",
    geo: null,
  });

  let data = defaultData();
  let loadError = null;

  function load() {
    const raw = localStorage.getItem(KEY);
    if (!raw) return data;
    try {
      data = Object.assign(defaultData(), JSON.parse(raw));
    } catch (e) {
      // не затираем повреждённые данные: сохраняем копию для восстановления
      loadError = e;
      try { localStorage.setItem(KEY + ".broken", raw); } catch (e2) {}
      data = defaultData();
    }
    return data;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { loadError = e; }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // --- треки ---
  function tracks() { return data.tracks; }

  function addTrack(offer) {
    const existing = data.tracks.find((t) => t.url === offer.url);
    if (existing) return existing;
    const t = {
      id: uid(),
      url: offer.url,
      marketplace: offer.marketplace,
      title: offer.title,
      image: offer.image || "",
      lastPrice: offer.price,
      target: null,
      createdAt: Date.now(),
      history: [{ ts: Date.now(), price: offer.price }],
    };
    data.tracks.unshift(t);
    save();
    return t;
  }

  function removeTrack(id) {
    data.tracks = data.tracks.filter((t) => t.id !== id);
    save();
  }

  function setTarget(id, price) {
    const t = data.tracks.find((x) => x.id === id);
    if (!t) return null;
    const v = Math.round(Number(price) || 0);
    t.target = v > 0 ? v : null;
    save();
    return t;
  }

  function updateTrack(id, price) {
    const t = data.tracks.find((x) => x.id === id);
    if (!t) return null;
    const old = t.lastPrice;
    if (Math.abs(old - price) >= 1) {
      t.history.push({ ts: Date.now(), price });
    }
    if (t.history.length > 60) t.history = t.history.slice(-60);
    t.lastPrice = price;
    save();
    return { old, price, t };
  }

  // --- вишлист ---
  function wish() {
    return data.wish.filter((w) => !w.done);
  }

  function addWish(title, price = 0, url = "", marketplace = "") {
    const now = Date.now();
    data.wish.unshift({
      id: uid(), title, price, url, marketplace,
      done: false, reminded: false,
      createdAt: now,
      remindAt: now + 24 * 3600 * 1000,
    });
    save();
  }

  function wishDone(id) {
    const w = data.wish.find((x) => x.id === id);
    if (w) { w.done = true; save(); }
  }

  function wishKeep(id) {
    const w = data.wish.find((x) => x.id === id);
    if (w) { w.reminded = false; w.remindAt = Date.now() + 3 * 24 * 3600 * 1000; save(); }
  }

  function wishDue() {
    const now = Date.now();
    return wish().filter((w) => !w.reminded && w.remindAt <= now);
  }

  function wishMarkReminded(id) {
    const w = data.wish.find((x) => x.id === id);
    if (w) { w.reminded = true; save(); }
  }

  // --- кэшбэк ---
  function setCashback(map) {
    const clean = {};
    Object.keys(map || {}).forEach((k) => {
      const v = parseFloat(map[k]);
      if (v > 0 && v < 99) clean[k] = Math.round(v * 10) / 10;
    });
    data.cashback = clean;
    save();
  }

  function getCashback() { return data.cashback || {}; }

  function cashbackFor(mp) {
    return Number((data.cashback || {})[mp] || 0);
  }

  // --- история поиска ---
  function history() { return data.history || []; }

  function addHistory(q) {
    const text = String(q || "").trim();
    if (text.length < 2) return;
    data.history = [text, ...(data.history || []).filter((x) => x !== text)].slice(0, 20);
    save();
  }

  function clearHistory() { data.history = []; save(); }

  function dismissUpdate(tag) { data.dismissedUpdate = tag || ""; save(); }
  function dismissedUpdate() { return data.dismissedUpdate || ""; }

  function magnitStore() { return !!data.magnitStore; }
  function magnitName() { return data.magnitName || ""; }
  function setMagnitStore(name) {
    data.magnitStore = true;
    if (name) data.magnitName = String(name).slice(0, 120);
    save();
  }

  // --- город/регион ---
  function geo() { return data.geo || null; }
  function setGeo(g) { data.geo = g || null; save(); }

  // --- кэш поиска ---
  function cacheGet(key, ttlMs = 20 * 60 * 1000) {
    const hit = data.cache[key];
    if (!hit) return null;
    if (Date.now() - hit.ts > ttlMs) { delete data.cache[key]; save(); return null; }
    return hit.value;
  }

  function cacheSet(key, value) {
    data.cache[key] = { ts: Date.now(), value };
    const keys = Object.keys(data.cache);
    if (keys.length > 30) {
      keys.sort((a, b) => data.cache[a].ts - data.cache[b].ts)
        .slice(0, keys.length - 30)
        .forEach((k) => delete data.cache[k]);
    }
    save();
  }

  // --- онбординг ---
  function seenOnboarding() { return !!data.onboarding; }
  function markOnboarding() { data.onboarding = true; save(); }

  return {
    load, save, tracks, addTrack, removeTrack, updateTrack, setTarget,
    wish, addWish, wishDone, wishKeep, wishDue, wishMarkReminded,
    setCashback, getCashback, cashbackFor,
    cacheGet, cacheSet, seenOnboarding, markOnboarding, loadError: () => loadError,
    history, addHistory, clearHistory, dismissUpdate, dismissedUpdate, magnitStore, magnitName, setMagnitStore, geo, setGeo,
  };
})();
