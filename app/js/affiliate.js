/* Партнёрские ссылки. Цена для покупателя не меняется: комиссию платит магазин. */
const Affiliate = (() => {
  const cfg = window.APP_CONFIG || {};
  const aff = cfg.affiliate || {};

  function enabled() {
    return !!aff.enabled && Object.keys(aff).some((k) =>
      aff[k] && typeof aff[k] === "object" && aff[k].template);
  }

  function wrap(url, marketplace) {
    if (!url || !enabled()) return url;
    const item = aff[marketplace];
    if (!item || !item.template) return url;
    const subid = "pr_" + String(marketplace || "app").slice(0, 16);
    return item.template
      .replace(/\{target\}/g, encodeURIComponent(url))
      .replace(/\{subid\}/g, encodeURIComponent(subid));
  }

  function disclosure() {
    return enabled()
      ? "Некоторые ссылки в приложении — партнёрские. Если вы купите товар, приложение может получить комиссию. Цена для вас не меняется."
      : "Приложение пока не использует партнёрские ссылки. Цены и переходы — как на самих площадках.";
  }

  return { enabled, wrap, disclosure };
})();
