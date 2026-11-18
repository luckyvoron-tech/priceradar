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
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
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
        w.addJavascriptInterface(new ScrapeBridge(id), "PR");

        w.setWebViewClient(new WebViewClient() {
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
                handler.postDelayed(pendingRun, 3500);
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
            handler.post(new Runnable() {
                @Override public void run() { startScrape(id, url, script); }
            });
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
            try {
                webView.evaluateJavascript("window.__prSetupDone&&window.__prSetupDone()", null);
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

