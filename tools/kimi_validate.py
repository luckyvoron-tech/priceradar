# -*- coding: utf-8 -*-
import json
import os
import re
import subprocess

ROOT = r"C:\Users\user\Documents\kimi\Workspaces\Покупки на маркетплейсах\priceradar-app"
OUT = os.path.join(ROOT, "_audit", "АУДИТ-kimi-валидация.md")
os.makedirs(os.path.dirname(OUT), exist_ok=True)

prompt = """Ты — независимый аудитор Android-приложения PriceRadar (WebView + JS, без сервера; парсинг WB/Ozon/Яндекс в скрытых WebView; данные в localStorage; сборка без Gradle). Ниже — находки предыдущего аудита. Оцени их: что верно, что ложно/преувеличено, что пропущено. Кратко, по-русски, 5–8 пунктов.

Находки:
1. Ключ подписи и пароль лежали в публичном репозитории → убраны, dist/ в .gitignore.
2. Исходники были дважды перекодированы (мохито) → исправлено, APK чистый.
3. restoreState без saveState даёт белый экран → добавлены saveState/restoreState и fallback.
4. Проверка цен «при открытии» не вызывалась → добавлена (тихо, первые 5 треков).
5. Матчинг путал iPhone 15 и 14 (общий токен 128 ГБ маскировал номер) → добавлены главные номера и вето.
6. Цены WB искажались параметрами spp=30 и жёстким dest → убраны.
7. Сортировка «где дешевле» игнорировала кэшбэк → сортировка и выгода по effectivePrice.
8. Утечки/крэши при закрытии во время поиска → отмена callbacks, флаг destroyed, try/catch.
9. Уведомления просились без объяснения и молча отключались → запрос при первом 🔔.
10. allowBackup=true отправлял localStorage и куки в Google → false.
11. minSdk 24 мог дать WebView без async/await → поднят до 26.
12. Обновление треков могло висеть и рапортовать успех → лимит 5, счётчик ошибок, статус на вкладке.
13. Повреждённый localStorage затирался пустым → копия .broken, без перезаписи.

Вопросы: какие пункты сомнительны? что ещё критично для приложения, которое ставит девушка на телефон? Ответь списком, без воды."""

body = {
    "model": "kimi-k3",
    "messages": [
        {"role": "system", "content": "Ты строгий практичный аудитор. Отвечай по-русски, кратко."},
        {"role": "user", "content": prompt},
    ],
    "temperature": 1,
    "max_tokens": 1800,
    "stream": True,
}
path = os.path.join(os.environ["TEMP"], "kimi_validate.json")
open(path, "w", encoding="utf-8").write(json.dumps(body))

cred = open(os.path.expanduser("~/.dsh/.credentials.yaml"), encoding="utf-8").read()
key = re.search(r"^\s{2}MOONSHOT_API_KEY:\s*(\S+)", cred, re.M).group(1)

out_path = os.path.join(os.environ["TEMP"], "kimi_validate.out")
cmd = [
    "curl.exe", "-sS", "-N", "-m", "240",
    "https://kimi-proxy-tmp.lucky-voron.workers.dev/chat/completions",
    "-H", "Authorization: Bearer " + key,
    "-H", "x-proxy-token: pr-audit-7f3c9a1e",
    "-H", "Content-Type: application/json",
    "--data-binary", "@" + path,
    "-o", out_path,
]
p = subprocess.run(cmd, capture_output=True, text=True)
print("curl rc", p.returncode, p.stderr[:200])

text = open(out_path, encoding="utf-8", errors="replace").read() if os.path.exists(out_path) else ""
content = []
for line in text.splitlines():
    if not line.startswith("data:"):
        continue
    data = line[5:].strip()
    if data == "[DONE]":
        break
    try:
        j = json.loads(data)
        d = j["choices"][0].get("delta", {})
        if d.get("content"):
            content.append(d["content"])
    except Exception:
        pass
result = "".join(content)
print("content chars", len(result), "stream", len(text))
if result:
    open(OUT, "w", encoding="utf-8").write(result)
    print(result[:1500])
else:
    print("NO CONTENT")
