/* Настройки приложения. Партнёрские шаблоны заполняются после регистрации
   в Admitad / Яндекс Дистрибуции. Пока шаблон пуст — ссылка открывается напрямую. */
window.APP_CONFIG = {
  version: "2.5",
  repo: "https://github.com/luckyvoron-tech/priceradar",
  issues: "https://github.com/luckyvoron-tech/priceradar/issues",
  // Ozon сравнивается только при наличии серверного партнёрского фида/API.
  // false — карточку Ozon можно открыть, но в сравнении её нет.
  ozonCompare: false,
  affiliate: {
    enabled: false,
    // Пример шаблона Admitad: "https://ad.admitad.com/g/XXXX/YYYY/ZZZZ/?ulp={target}&subid={subid}"
    wildberries: { template: "" },
    ozon: { template: "" },
    ymarket: { template: "" },
    magnit: { template: "" },
  },
};
