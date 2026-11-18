/* Сопоставление «тот же товар» — порт серверного PriceRadar Match на JS. */
const Match = (() => {
  const SAME = 0.70;
  const SIMILAR = 0.45;

  const STOP = new Set(("для и в на с по от до из у о the and купить официальный оригинал " +
    "новый новинка шт уп упаковка цвет размер россия глобальная версия global version").split(" "));

  const MODEL_RE = /(?:[A-Za-zА-Яа-я]{1,4}[-\s]?\d{3,}[A-Za-z]{0,4})|(?:\d{3,}[A-Za-z]{1,4})|(?:[A-Za-z]+\d+[A-Za-z]*\d*)|(?:\d+(?:\s?(?:гб|gb|тб|tb|мл|ml|л|l|г|кг|mm|мм|см|cm|дюйм|")))/gi;
  const VARIANT_RE = /\b(pro|max|ultra|plus|mini|se|lite|fe|neo)\b/gi;
  const REFURB_RE = /восстановлен|refurb|б\s*\/\s*у|\bбу\b|used|уцен|витрин/i;
  const SIZE_RE = /размер\s*([0-9]{2,3}|[a-zA-Zа-яА-Я]{1,3})\b/i;

  function normalize(title) {
    let t = (title || "").toLowerCase().replace(/ё/g, "е");
    t = t.replace(/[\/\\()\[\],;:+*_«»"']/g, " ");
    return t.split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)).join(" ");
  }

  function modelTokens(title) {
    const out = new Set();
    const m = (title || "").match(MODEL_RE) || [];
    m.forEach((raw) => {
      let tok = raw.replace(/[\s-]/g, "").toLowerCase()
        .replace(/гб/g, "gb").replace(/тб/g, "tb").replace(/мл/g, "ml");
      if (tok.length >= 3) out.add(tok);
    });
    // отдельные числа: iPhone 15 / 14, AirPods Pro 2 / 3, Bosch Serie 6 / 8
    const nums = (title || "").match(/\b\d{1,4}\b/g) || [];
    nums.forEach((n) => out.add(n));
    return out;
  }

  function variants(title) {
    const out = new Set();
    const m = (title || "").match(VARIANT_RE) || [];
    m.forEach((v) => out.add(v.toLowerCase()));
    return out;
  }

  function isRefurb(title) { return REFURB_RE.test(title || ""); }

  function sizeOf(title) {
    const m = SIZE_RE.exec(title || "");
    return m ? m[1].toLowerCase() : "";
  }

  function primaryNumbers(title) {
    const t = String(title || "").toLowerCase()
      .replace(/\d+\s?(?:гб|gb|тб|tb|мл|ml|мм|mm|см|cm|дюйм|кг|г|л)/g, " ")
      .replace(/\d+\s*\/\s*\d+/g, " ");
    const nums = t.match(/\b\d{1,3}\b/g) || [];
    return new Set(nums);
  }

  function pricePlausibility(p1, p2) {
    if (!p1 || !p2) return 0.5;
    const ratio = Math.max(p1, p2) / Math.min(p1, p2);
    return Math.max(0, 1 - (ratio - 1) / 2);
  }

  function lev(a, b) {
    const n = a.length, m = b.length;
    if (!n) return m;
    if (!m) return n;
    let prev = new Array(m + 1);
    let cur = new Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      cur[0] = i;
      for (let j = 1; j <= m; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      const t = prev; prev = cur; cur = t;
    }
    return prev[m];
  }

  function ratio(a, b) {
    if (!a && !b) return 1;
    return 1 - lev(a, b) / Math.max(a.length, b.length, 1);
  }

  function tokenSetRatio(a, b) {
    const A = a.split(" ").filter(Boolean);
    const B = b.split(" ").filter(Boolean);
    const setA = new Set(A), setB = new Set(B);
    const inter = [...setA].filter((x) => setB.has(x));
    const diffA = [...setA].filter((x) => !setB.has(x));
    const diffB = [...setB].filter((x) => !setA.has(x));
    const s1 = inter.join(" ");
    const s2 = inter.concat(diffA).join(" ");
    const s3 = inter.concat(diffB).join(" ");
    return Math.max(ratio(s1, s2), ratio(s1, s3), ratio(s2, s3));
  }

  function brandOf(title) {
    return ((title || "").trim().split(/\s+/)[0] || "").toLowerCase();
  }

  function match(seed, cand) {
    if (isRefurb(seed.title) !== isRefurb(cand.title)) {
      return { score: 0, isSame: false, isSimilar: false, reason: "разное состояние" };
    }
    const sv = variants(seed.title), cv = variants(cand.title);
    if (sv.size !== cv.size || [...sv].some((v) => !cv.has(v))) {
      return { score: 0, isSame: false, isSimilar: false, reason: "другая модель (Pro/Max)" };
    }
    const ss = sizeOf(seed.title), cs = sizeOf(cand.title);
    if (ss && cs && ss !== cs) {
      return { score: 0, isSame: false, isSimilar: false, reason: "другой размер" };
    }

    // главный номер модели: iPhone 15 vs 14, Redmi 13 vs 14, Serie 6 vs 8
    const sp = primaryNumbers(seed.title), cp = primaryNumbers(cand.title);
    if (sp.size && cp.size) {
      const common = [...sp].filter((n) => cp.has(n));
      if (!common.length) {
        return { score: 0, isSame: false, isSimilar: false, reason: "другая модель (номер)" };
      }
    }

    const sm = modelTokens(seed.title), cm = modelTokens(cand.title);
    let modelScore = 0.5;
    if (sm.size && cm.size) {
      const inter = [...sm].filter((x) => cm.has(x));
      if (!inter.length) {
        const cross = [...sm].some((a) => [...cm].some((b) => a.includes(b) || b.includes(a)));
        if (!cross) return { score: 0, isSame: false, isSimilar: false, reason: "другие характеристики" };
        modelScore = 0.5;
      } else {
        modelScore = inter.length / Math.max(new Set([...sm, ...cm]).size, 1);
      }
    }

    const normA = normalize(seed.title), normB = normalize(cand.title);
    let semantic = tokenSetRatio(normA, normB);
    const sb = brandOf(seed.title), cb = brandOf(cand.title);
    if (sb && cb && sb !== cb && ratio(sb, cb) < 0.8) semantic *= 0.8;

    const priceScore = pricePlausibility(seed.price, cand.price);
    const score = 0.45 * modelScore + 0.35 * semantic + 0.20 * priceScore;
    const rounded = Math.round(score * 1000) / 1000;
    return {
      score: rounded,
      isSame: rounded >= SAME,
      isSimilar: rounded >= SIMILAR && rounded < SAME,
      reason: `модель=${modelScore.toFixed(2)} смысл=${semantic.toFixed(2)} цена=${priceScore.toFixed(2)}`,
    };
  }

  function valueRank(price, rating, reviews) {
    if (!price) return 0;
    const q = (rating || 3.5) * (1 + Math.log10((reviews || 0) + 1));
    return q / Math.log10(price + 10);
  }

  function effectivePrice(price, cashbackPct) {
    if (!price || !cashbackPct) return price;
    return Math.round(price * (1 - cashbackPct / 100) * 100) / 100;
  }

  return { match, normalize, modelTokens, variants, isRefurb, pricePlausibility, valueRank, effectivePrice };
})();
