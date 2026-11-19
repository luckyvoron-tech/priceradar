package ru.priceradar.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONTokener;

/**
 * Видимый WebView для настройки площадки (магазин М.Косметик) и прохождения
 * проверки Ozon. Куки и localStorage остаются в приложении и используются
 * скрытым WebView.
 */
public class SetupActivity extends Activity {

    private static final String MOBILE_UA =
            "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFFFFF8F3);
        root.setFitsSystemWindows(true);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setPadding(32, 24, 32, 24);
        bar.setBackgroundColor(0xFFFFF8F3);

        TextView title = new TextView(this);
        String titleText = getIntent().getStringExtra("title");
        title.setText(titleText != null && !titleText.isEmpty() ? titleText : "Выберите магазин");
        title.setTextSize(18);
        title.setTextColor(0xFF2B2440);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        bar.addView(title, tp);

        Button done = new Button(this);
        done.setText("Готово");
        done.setAllCaps(false);
        bar.addView(done);

        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setUserAgentString(MOBILE_UA);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                try {
                    view.evaluateJavascript(
                        "(function(){try{if(!window.chrome)window.chrome={};}catch(e){}})()",
                        null);
                } catch (Exception ignored) { }
            }
        });

        root.addView(bar);
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        String url = getIntent().getStringExtra("url");
        if (url == null || url.isEmpty()) url = "https://cosmetic.magnit.ru/";
        webView.loadUrl(url);

        done.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (webView == null) { setResult(RESULT_OK); finish(); return; }
                webView.evaluateJavascript("(function(){try{return document.title||''}catch(e){return ''}})()",
                    new ValueCallback<String>() {
                        @Override public void onReceiveValue(String value) {
                            Intent data = new Intent();
                            try {
                                Object title = new JSONTokener(value).nextValue();
                                if (title != null) data.putExtra("store", String.valueOf(title));
                            } catch (Exception ignored) { }
                            setResult(RESULT_OK, data);
                            finish();
                        }
                    });
            }
        });
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
