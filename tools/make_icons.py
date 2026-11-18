"""Генерация иконок приложения (без внешних ассетов)."""
import os
from PIL import Image, ImageDraw

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
BASE = 512


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make():
    img = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # мягкий градиент лаванда → персик
    top, bottom = (124, 92, 214), (255, 154, 139)
    for y in range(BASE):
        d.line([(0, y), (BASE, y)], fill=lerp(top, bottom, y / BASE))
    # скругляем углы
    mask = Image.new("L", (BASE, BASE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, BASE, BASE], radius=110, fill=255)
    img.putalpha(mask)

    # белая сумка
    bag = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bag)
    left, right, top_b, bottom_b = 128, 384, 196, 396
    bd.rounded_rectangle([left, top_b, right, bottom_b], radius=38, fill=(255, 255, 255, 235))
    # ручка
    bd.arc([left + 52, top_b - 86, right - 52, top_b + 54], start=180, end=360,
           fill=(255, 255, 255, 235), width=26)
    # «радар»: дуги справа сверху
    for i, r in enumerate((46, 74, 102)):
        bd.arc([BASE - 150 - r, 60 - r, BASE - 150 + r, 60 + r],
               start=200, end=340, fill=(255, 255, 255, 210 - i * 40), width=14)
    # сердечко на сумке
    hx, hy, s = 256, 300, 34
    bd.ellipse([hx - s, hy - s, hx, hy], fill=(124, 92, 214, 255))
    bd.ellipse([hx, hy - s, hx + s, hy], fill=(124, 92, 214, 255))
    bd.polygon([(hx - s, hy - 2), (hx + s, hy - 2), (hx, hy + s + 10)], fill=(124, 92, 214, 255))

    img.alpha_composite(bag)
    for dpi, size in SIZES.items():
        out_dir = os.path.join(SRC, "android", "res", f"mipmap-{dpi}")
        os.makedirs(out_dir, exist_ok=True)
        img.resize((size, size), Image.LANCZOS).save(os.path.join(out_dir, "ic_launcher.png"))
    img.resize((512, 512), Image.LANCZOS).save(os.path.join(SRC, "docs", "icon.png"))
    print("icons ok")


if __name__ == "__main__":
    make()
