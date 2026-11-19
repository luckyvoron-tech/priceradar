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
    let tpl = item.template;
    // «добавка параметра» вида {target}&clid=... : чиним разделитель ?/&
    if (tpl.indexOf("{target}&") === 0 && url.indexOf("?") < 0) {
      tpl = tpl.replace("{target}&", "{target}?");
    }
    return tpl
      .replace(/\{raw_target\}/g, url)                    // без кодирования (clid и т.п.)
      .replace(/\{target\}/g, encodeURIComponent(url))    // URL-encoded (Admitad ulp)
      .replace(/\{subid\}/g, encodeURIComponent(subid));
  }

  function disclosure() {
    return enabled()
      ? "Некоторые ссылки в приложении — партнёрские. Если вы купите товар, приложение может получить комиссию. Цена для вас не меняется."
      : "Приложение пока не использует партнёрские ссылки. Цены и переходы — как на самих площадках.";
  }

  return { enabled, wrap, disclosure };
})();
