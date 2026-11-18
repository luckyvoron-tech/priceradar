"""Решающий эксперимент по Ozon: нужен ли JS для composer-API.

Запуск на ПК с российским IP, VPN ВЫКЛЮЧЕН:
    pip install curl_cffi
    python tools/test_ozon_http.py

Что проверяем:
- TLS-отпечаток Chrome (curl_cffi impersonate) — аналог того, что даст Cronet;
- полные заголовки Chrome (включая Sec-CH-UA), cookies с главной страницы;
- НОЛЬ выполнения JavaScript.

Интерпретация:
- composer 200 + JSON с widgetStates → Ozon НЕ требует JS → Cronet-путь рабочий;
- composer 403 (incident) → требуется активный JS → Cronet отпадает,
  идём в партнёрский фид / VPS (см. docs/Ozon-ответ-варианты.md).
"""
from curl_cffi import requests

PROFILES = [
    ("chrome131_android", {
        "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
        "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": '"Android"',
    }),
    ("chrome136", {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        "sec-ch-ua": '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
    }),
]

COMPOSER = ("https://www.ozon.ru/api/composer-api.bx/page/json/v2"
            "?url=/search/?text=iphone%2015&from_global=true")


def try_profile(name: str, ch_headers: dict) -> bool:
    s = requests.Session(impersonate=name)
    headers = {
        "Accept": "application/json",
        "Accept-Language": "ru-RU,ru;q=0.9",
        "Referer": "https://www.ozon.ru/",
        **ch_headers,
    }
    print(f"\n=== профиль {name} ===")
    try:
        r0 = s.get("https://www.ozon.ru/", headers={**headers, "Accept": "text/html"}, timeout=20)
        cookies = sorted(s.cookies.keys())
        print(f"main page: {r0.status_code}, cookies: {cookies}")
        if r0.status_code != 200:
            print("главная не отдалась — IP заблокирован/VPN включён?")
            return False
    except Exception as e:
        print(f"main page FAIL: {e}")
        return False

    try:
        r = s.get(COMPOSER, headers=headers, timeout=25)
        body = r.text
        print(f"composer: {r.status_code}, {len(body)} байт")
        if r.status_code == 200 and '"widgetStates"' in body:
            print("✅ ПОБЕДА: JSON без единой строчки JS → Cronet сработает")
            return True
        if "incident" in body.lower() or r.status_code == 403:
            print("❌ 403/incident без JS → Cronet не поможет, нужен фид или VPS")
            return False
        print(f"⚠️ неожиданный ответ: {body[:200]}")
    except Exception as e:
        print(f"composer FAIL: {e}")
    return False


if __name__ == "__main__":
    results = {name: try_profile(name, h) for name, h in PROFILES}
    print("\n=== итог ===")
    for name, ok in results.items():
        print(f"{name}: {'OK' if ok else 'FAIL'}")
