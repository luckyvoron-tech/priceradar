package ru.priceradar.app;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Тонкая нативная оболочка: локальный веб-интерфейс + скрытые WebView для
 * маркетплейсов. Парсинг идёт в настоящем браузере телефона, поэтому запросы
 * уходят с обычного российского IP (без VPN и без сервера).
 */
public class MainActivity extends Activity {

    private static final String APP_HOST = "priceradar.local";
    private static final String APP_URL = "https://" + APP_HOST + "/index.html";
    private static final String MOBILE_UA =
            "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
    private static final int NOTIFY_PERMISSION = 2001;
    private static final int SETUP_REQUEST = 2002;
    private static final int CHECK_REQUEST = 2003;
    private static final String CHANNEL_ID = "priceradar";

    private WebView webView;
    private FrameLayout scraperHost;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, WebView> scrapers = new ConcurrentHashMap<>();
    private final Map<String, Runnable> timeouts = new ConcurrentHashMap<>();
    private final Map<String, Boolean> delivered = new ConcurrentHashMap<>();
    private volatile boolean destroyed = false;
    private String pendingShare = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        scraperHost = new FrameLayout(this);
        FrameLayout.LayoutParams hp = new FrameLayout.LayoutParams(1, 1);
        root.addView(scraperHost, hp);

        setContentView(root);
        applySystemBarInsets(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setBackgroundColor(0xFFFFF8F3);
        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && APP_HOST.equals(uri.getHost())) {
                    WebResourceResponse r = serveAsset(uri.getPath());
                    if (r != null) return r;
                    return new WebResourceResponse("text/plain", "UTF-8",
                            new ByteArrayInputStream("not found".getBytes()));
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && APP_HOST.equals(uri.getHost())) return false;
                openExternal(uri);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                deliverShare();
            }
        });

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        createNotificationChannel();

        if (savedInstanceState != null) {
            if (webView.restoreState(savedInstanceState) == null) {
                webView.loadUrl(APP_URL);
            }
        } else {
            webView.loadUrl(APP_URL);
        }

        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null) text = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (text == null || text.trim().isEmpty()) return;
        pendingShare = text;
        deliverShare();
    }

    private void deliverShare() {
        if (pendingShare == null || webView == null || destroyed) return;
        final String text = pendingShare;
        pendingShare = null;
        try {
            webView.evaluateJavascript("window.__prShared(" + JSONObject.quote(text) + ")", null);
        } catch (Exception ignored) { }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    private String httpGet(String rawUrl) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(rawUrl).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(8000);
        c.setRequestProperty("User-Agent", MOBILE_UA);
        c.setRequestProperty("Accept", "application/json, text/plain, */*");
        int code = c.getResponseCode();
        if (code < 200 || code >= 300) {
            c.disconnect();
            throw new Exception("HTTP " + code);
        }
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
        }
        c.disconnect();
        return sb.toString();
    }

    private String resolveShortLink(String url) {
        try {
            Uri uri = Uri.parse(url);
            String host = uri.getHost();
            String path = uri.getPath();
            if (host == null || path == null) return url;
            if (!host.endsWith("ozon.ru") || !path.startsWith("/t/")) return url;
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            c.setRequestProperty("User-Agent", MOBILE_UA);
            int code = c.getResponseCode();
            String loc = c.getHeaderField("Location");
            c.disconnect();
            if (code >= 300 && code < 400 && loc != null && loc.startsWith("http")) {
                return loc.split("\\?")[0];
            }
        } catch (Exception ignored) { }
        return url;
    }

    // ---------- скрытый парсинг ----------

    private void startScrape(final String id, final String url, final String script) {
        final WebView w = new WebView(this);
        WebSettings ws = w.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setUserAgentString(MOBILE_UA);
        ws.setLoadWithOverviewMode(true);
        ws.setUseWideViewPort(true);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);

        // Никаких JS-интерфейсов в странице маркетплейса: результат возвращаем
        // через prompt(), который перехватывает нативная оболочка. Это важно:
        // window.PR/window.AndroidBridge — явный признак WebView для антибота.
        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsPrompt(WebView view, String promptUrl, String message,
                                      String defaultValue, JsPromptResult result) {
                if (message != null && message.startsWith("PRRESULT:")) {
                    final String payload = message.substring("PRRESULT:".length());
                    result.confirm("");
                    handler.post(new Runnable() {
                        @Override public void run() { deliver(id, payload); }
                    });
                    return true;
                }
                return false;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                String m = cm.message();
                if (m != null && m.startsWith("PRRESULT:")) {
                    final String payload = m.substring("PRRESULT:".length());
                    handler.post(new Runnable() {
                        @Override public void run() { deliver(id, payload); }
                    });
                    return true;
                }
                return true;
            }
        });

        w.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String pageUrl, android.graphics.Bitmap favicon) {
                try {
                    view.evaluateJavascript(
                        "(function(){try{if(!window.chrome)window.chrome={};" +
                        "if(!window.chrome.runtime)window.chrome.runtime={};}catch(e){}})()", null);
                } catch (Exception ignored) { }
            }
            private Runnable pendingRun;

            @Override
            public void onPageFinished(WebView view, String pageUrl) {
                // страница может перезагрузиться после антибот-челленджа:
                // отменяем прошлый запуск и планируем новый
                if (pendingRun != null) handler.removeCallbacks(pendingRun);
                pendingRun = new Runnable() {
                    @Override public void run() {
                        if (Boolean.TRUE.equals(delivered.get(id))) return;
                        if (destroyed) return;
                        try { w.evaluateJavascript(script, null); } catch (Exception ignored) { }
                    }
                };
                handler.postDelayed(pendingRun, 4500);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) {
                    deliver(id, "{\"ok\":false,\"error\":\"Нет соединения с площадкой\"}");
                }
            }
        });

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(1080, 1920);
        scraperHost.addView(w, lp);
        scrapers.put(id, w);

        Runnable timeout = new Runnable() {
            @Override public void run() {
                deliver(id, "{\"ok\":false,\"error\":\"Площадка не ответила вовремя\"}");
            }
        };
        timeouts.put(id, timeout);
        handler.postDelayed(timeout, 30000);

        w.loadUrl(url);
    }

    private void deliver(String id, String json) {
        if (destroyed) return;
        if (Boolean.TRUE.equals(delivered.get(id))) return;
        delivered.put(id, true);

        Runnable timeout = timeouts.remove(id);
        if (timeout != null) handler.removeCallbacks(timeout);

        WebView w = scrapers.remove(id);
        if (w != null) {
            scraperHost.removeView(w);
            w.loadUrl("about:blank");
            w.destroy();
        }

        String js = "window.__prResult(" + JSONObject.quote(id) + "," + JSONObject.quote(json) + ")";
        if (webView != null) {
            try { webView.evaluateJavascript(js, null); } catch (Exception ignored) { }
        }
        handler.postDelayed(new Runnable() {
            @Override public void run() { delivered.remove(id); }
        }, 5000);
    }

    private class ScrapeBridge {
        private final String id;
        ScrapeBridge(String id) { this.id = id; }

        @JavascriptInterface
        public void send(final String payload) {
            handler.post(new Runnable() {
                @Override public void run() { deliver(id, payload); }
            });
        }
    }

    // ---------- мост для интерфейса ----------

    private class Bridge {
        @JavascriptInterface
        public void scrape(final String id, final String url, final String script) {
            // короткие ссылки Ozon (/t/...) сначала раскрываем в канонический адрес
            new Thread(new Runnable() {
                @Override public void run() {
                    final String target = resolveShortLink(url);
                    handler.post(new Runnable() {
                        @Override public void run() { startScrape(id, target, script); }
                    });
                }
            }).start();
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            handler.post(new Runnable() {
                @Override public void run() {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) { }
                }
            });
        }

        @JavascriptInterface
        public void toast(final String text) {
            handler.post(new Runnable() {
                @Override public void run() {
                    Toast.makeText(MainActivity.this, text, Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void notify(final String title, final String text) {
            handler.post(new Runnable() {
                @Override public void run() { showNotification(title, text); }
            });
        }

        @JavascriptInterface
        public void copy(final String text) {
            handler.post(new Runnable() {
                @Override public void run() {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("PriceRadar", text));
                    Toast.makeText(MainActivity.this, "Скопировано", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void share(final String text) {
            handler.post(new Runnable() {
                @Override public void run() {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                    i.putExtra(Intent.EXTRA_TEXT, text);
                    startActivity(Intent.createChooser(i, "Поделиться"));
                }
            });
        }

        @JavascriptInterface
        public void requestNotify() {
            handler.post(new Runnable() {
                @Override public void run() { requestNotificationPermission(); }
            });
        }

        @JavascriptInterface
        public void openSetup(final String url) {
            handler.post(new Runnable() {
                @Override public void run() {
                    try {
                        Intent i = new Intent(MainActivity.this, SetupActivity.class);
                        i.putExtra("url", url);
                        startActivityForResult(i, SETUP_REQUEST);
                    } catch (Exception ignored) { }
                }
            });
        }

        @JavascriptInterface
        public void openCheck(final String url) {
            handler.post(new Runnable() {
                @Override public void run() {
                    try {
                        Intent i = new Intent(MainActivity.this, SetupActivity.class);
                        i.putExtra("url", url);
                        i.putExtra("title", "Проверка площадки");
                        startActivityForResult(i, CHECK_REQUEST);
                    } catch (Exception ignored) { }
                }
            });
        }

        @JavascriptInterface
        public void detectGeo() {
            new Thread(new Runnable() {
                @Override public void run() {
                    String out;
                    try {
                        JSONObject ip = new JSONObject(httpGet("https://ipwho.is/"));
                        if (!ip.optBoolean("success", true)) throw new Exception("geo");
                        double lat = ip.optDouble("latitude", 0);
                        double lon = ip.optDouble("longitude", 0);
                        JSONObject g = new JSONObject();
                        g.put("ok", true);
                        g.put("city", ip.optString("city", ""));
                        g.put("region", ip.optString("region", ""));
                        g.put("country", ip.optString("country_code", ""));
                        g.put("lat", lat);
                        g.put("lon", lon);
                        try {
                            JSONObject wb = new JSONObject(httpGet(
                                "https://user-geo-data.wildberries.ru/get-geo-info?currency=RUB&latitude="
                                + lat + "&longitude=" + lon));
                            g.put("dest", wb.optString("dest", ""));
                            g.put("address", wb.optString("address", ""));
                        } catch (Exception ignored) { }
                        out = g.toString();
                    } catch (Exception e) {
                        out = "{\"ok\":false,\"error\":\"Не удалось определить город\"}";
                    }
                    final String payload = out;
                    handler.post(new Runnable() {
                        @Override public void run() {
                            if (destroyed || webView == null) return;
                            try {
                                webView.evaluateJavascript(
                                    "window.__prGeo&&window.__prGeo(" + JSONObject.quote(payload) + ")", null);
                            } catch (Exception ignored) { }
                        }
                    });
                }
            }).start();
        }

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "1.0";
            }
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }
    }

    // ---------- уведомления ----------

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Цены и напоминания", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Снижение цены и правило 24 часов");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFY_PERMISSION);
        }
    }

    private void showNotification(String title, String text) {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= 26) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }
        Notification n = builder
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify((int) (System.currentTimeMillis() % 100000), n);
    }

    // ---------- ассеты и системные бары ----------

    private WebResourceResponse serveAsset(String path) {
        if (path == null) return null;
        String clean = path.startsWith("/") ? path.substring(1) : path;
        int q = clean.indexOf('?');
        if (q >= 0) clean = clean.substring(0, q);
        if (clean.isEmpty()) clean = "index.html";
        try {
            InputStream is = getAssets().open(clean);
            return new WebResourceResponse(mimeFor(clean), "UTF-8", is);
        } catch (Exception e) {
            return null;
        }
    }

    private static String mimeFor(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".js")) return "application/javascript";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private void applySystemBarInsets(final FrameLayout root) {
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override
                public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                    android.graphics.Insets bars = insets.getInsets(
                            WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                    return insets;
                }
            });
        } else {
            root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override
                @SuppressWarnings("deprecation")
                public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                    v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                            insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                    return insets;
                }
            });
        }
        root.requestApplyInsets();
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) { }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == SETUP_REQUEST && resultCode == RESULT_OK && webView != null) {
            String store = data != null ? data.getStringExtra("store") : "";
            try {
                webView.evaluateJavascript("window.__prSetupDone&&window.__prSetupDone("
                    + JSONObject.quote(store == null ? "" : store) + ")", null);
            } catch (Exception ignored) { }
        }
        if (requestCode == CHECK_REQUEST && resultCode == RESULT_OK && webView != null) {
            try {
                webView.evaluateJavascript("window.__prCheckDone&&window.__prCheckDone()", null);
            } catch (Exception ignored) { }
        }
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        handler.removeCallbacksAndMessages(null);
        timeouts.clear();
        for (WebView w : scrapers.values()) {
            try { w.destroy(); } catch (Exception ignored) { }
        }
        scrapers.clear();
        if (webView != null) {
            try { webView.destroy(); } catch (Exception ignored) { }
        }
        super.onDestroy();
    }
}

