# -*- coding: utf-8 -*-
"""Сборка APK PriceRadar без Gradle: aapt2 -> javac -> d8 -> zipalign -> apksigner."""
import os
import shutil
import subprocess
import sys
import zipfile

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = r"C:\priceradar-build"
TOOLS = r"C:\arendatools"
JDK = os.path.join(TOOLS, "jdk")
BT = os.path.join(TOOLS, "sdk", "build-tools", "34.0.0")
PLATFORM = os.path.join(TOOLS, "sdk", "platforms", "android-35", "android.jar")

ENV = dict(os.environ)
ENV["JAVA_HOME"] = JDK
ENV["PATH"] = os.path.join(JDK, "bin") + os.pathsep + BT + os.pathsep + ENV.get("PATH", "")

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def log(msg):
    print(msg, flush=True)


def run(args, cwd=None, allow_fail=False):
    log("$ " + " ".join(args[:6]) + (" ..." if len(args) > 6 else ""))
    p = subprocess.run(args, cwd=cwd, env=ENV, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    if p.returncode != 0 and not allow_fail:
        log("---- STDOUT/STDERR ----")
        log(out[-8000:])
        raise SystemExit("КОМАНДА УПАЛА (%d): %s" % (p.returncode, args[0]))
    if out.strip():
        for line in out.strip().splitlines()[-10:]:
            log("   " + line[:300])
    return p


def rmtree(p):
    if os.path.exists(p):
        shutil.rmtree(p)


def main():
    rmtree(BUILD)
    os.makedirs(BUILD)
    assets = os.path.join(BUILD, "assets")
    res = os.path.join(BUILD, "res")
    src_java = os.path.join(BUILD, "src")
    gen = os.path.join(BUILD, "gen")
    classes = os.path.join(BUILD, "classes")
    dex = os.path.join(BUILD, "dex")

    shutil.copytree(os.path.join(SRC, "app"), assets)
    shutil.copytree(os.path.join(SRC, "android", "res"), res)
    shutil.copytree(os.path.join(SRC, "android", "src"), src_java)
    manifest = os.path.join(SRC, "android", "AndroidManifest.xml")
    log("assets: %d файлов" % sum(len(f) for _, _, f in os.walk(assets)))

    compiled = os.path.join(BUILD, "compiled.zip")
    run([os.path.join(BT, "aapt2.exe"), "compile", "--dir", res, "-o", compiled])

    unsigned = os.path.join(BUILD, "unsigned.apk")
    run([os.path.join(BT, "aapt2.exe"), "link",
         "-o", unsigned, "-I", PLATFORM, "--manifest", manifest,
         "-R", compiled, "--java", gen, "--auto-add-overlay", "-A", assets])

    java_files = []
    for root, _d, files in os.walk(src_java):
        java_files += [os.path.join(root, f) for f in files if f.endswith(".java")]
    for root, _d, files in os.walk(gen):
        java_files += [os.path.join(root, f) for f in files if f.endswith(".java")]
    log("java файлов: %d" % len(java_files))

    os.makedirs(classes, exist_ok=True)
    run([os.path.join(JDK, "bin", "javac.exe"),
         "-encoding", "UTF-8", "-source", "8", "-target", "8",
         "-nowarn", "-classpath", PLATFORM, "-d", classes] + java_files)

    os.makedirs(dex, exist_ok=True)
    class_files = []
    for root, _d, files in os.walk(classes):
        class_files += [os.path.join(root, f) for f in files if f.endswith(".class")]
    run([os.path.join(BT, "d8.bat"), "--lib", PLATFORM, "--min-api", "24",
         "--release", "--output", dex] + class_files)
    if not os.path.exists(os.path.join(dex, "classes.dex")):
        raise SystemExit("classes.dex не создан")

    dexed = os.path.join(BUILD, "dexed.apk")
    with zipfile.ZipFile(unsigned, "r") as zin, zipfile.ZipFile(dexed, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, zin.read(item.filename))
        zout.writestr("classes.dex", open(os.path.join(dex, "classes.dex"), "rb").read())

    aligned = os.path.join(BUILD, "aligned.apk")
    run([os.path.join(BT, "zipalign.exe"), "-f", "-p", "4", dexed, aligned])

    dist = os.path.join(SRC, "dist")
    os.makedirs(dist, exist_ok=True)
    ks = os.path.join(dist, "priceradar-release-key.keystore")
    props = os.path.join(dist, "keystore.properties")

    password = os.getenv("PRICERADAR_KS_PASS", "")
    if not password and os.path.exists(props):
        for line in open(props, encoding="utf-8"):
            if line.startswith("storePassword="):
                password = line.split("=", 1)[1].strip()

    if not os.path.exists(ks):
        # ключ не публикуется: он остаётся на этой машине и нужен для обновлений
        import secrets
        password = password or secrets.token_urlsafe(18)
        run([os.path.join(JDK, "bin", "keytool.exe"), "-genkeypair", "-v",
             "-keystore", ks, "-alias", "priceradar",
             "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
             "-storepass", password, "-keypass", password,
             "-dname", "CN=PriceRadar, OU=Mobile, O=PriceRadar, L=Moscow, C=RU"])
        with open(props, "w", encoding="utf-8") as f:
            f.write("storePassword=" + password + "\n")
        log("создан новый ключ. Пароль сохранён в " + props + " (не публикуйте)")
    else:
        log("использую существующий ключ: " + ks)

    if not password:
        raise SystemExit("Не найден пароль ключа: задайте PRICERADAR_KS_PASS или dist/keystore.properties")

    final = os.path.join(BUILD, "PriceRadar-1.7.apk")
    run([os.path.join(BT, "apksigner.bat"), "sign",
         "--ks", ks, "--ks-pass", "pass:" + password, "--key-pass", "pass:" + password,
         "--v1-signing-enabled", "true", "--v2-signing-enabled", "true",
         "--out", final, aligned])

    log("=== проверка подписи ===")
    run([os.path.join(BT, "apksigner.bat"), "verify", "--print-certs", final])
    log("=== сведения о пакете ===")
    run([os.path.join(BT, "aapt2.exe"), "dump", "badging", final])

    dst = os.path.join(dist, "PriceRadar-1.7.apk")
    shutil.copy2(final, dst)
    shutil.copy2(final, os.path.join(dist, "PriceRadar.apk"))
    log("ГОТОВО: %s (%.1f МБ)" % (dst, os.path.getsize(dst) / 1e6))


if __name__ == "__main__":
    main()
