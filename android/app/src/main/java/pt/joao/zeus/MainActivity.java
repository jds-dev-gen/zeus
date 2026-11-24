package pt.joao.zeus;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Zeus para Android.
 *
 * Como o Zeus do Mac: a interface (barras, Início, Zoom, Separadores, Definições) é uma página
 * local (assets/app) numa WebView que ocupa o ecrã; os separadores são WebViews colocadas por
 * cima, no retângulo que a interface indica (ZN.layout). A interface fala com esta classe pela
 * ponte "ZeusNative" (só existe na página local); as páginas dos separadores só têm a ponte
 * "ZeusHL", para os destaques, e o endereço de cada pedido é sempre o que esta classe vê.
 *
 * A Drive: a conta Google é autorizada pelo Google Play Services (AuthorizationClient), só com
 * o âmbito drive.appdata (a pasta escondida da app, a mesma do Zeus do Mac) e o email.
 */
public class MainActivity extends Activity {
    static final String SCOPE_DRIVE = "https://www.googleapis.com/auth/drive.appdata";
    static final String DRIVE = "https://www.googleapis.com/drive/v3";
    static final String UPLOAD = "https://www.googleapis.com/upload/drive/v3";
    static final int REQ_AUTH = 7, REQ_FILE = 8;

    final Handler main = new Handler(Looper.getMainLooper());
    final ExecutorService io = Executors.newFixedThreadPool(3);
    FrameLayout root;
    WebView shell;
    boolean shellReady = false;
    String pendingUrl = null;

    // app = true: uma app do Zeus (o Apolo), sem destaques; os links para outros sites vão para separadores
    static class Tab { int id; String url; ZWebView view; boolean app; String appHost; }
    final Map<Integer, Tab> tabs = new HashMap<>();
    int nextId = 1, current = -1;
    int px, py, pw, ph;            // retângulo da página, em píxeis
    boolean pageShown = false;
    String hlScript = "", readerScript = null, userAgent = null;

    String token = null;
    long tokenExp = 0;
    interface TokenCb { void ok(String t); void err(String e); }
    final List<TokenCb> authWaiting = new ArrayList<>();

    ValueCallback<Uri[]> fileCb;
    View customView;
    WebChromeClient.CustomViewCallback customCb;

    /* ------------------------------------------------------------------ */
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        setContentView(root);
        hlScript = readAsset("app/hl.js");

        ZWebView sv = new ZWebView(this);
        sv.plain = true;   // Notas e caixas de texto: o menu do Android fica, mas por baixo da seleção
        shell = sv;
        WebSettings s = shell.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        shell.setBackgroundColor(Color.WHITE);
        shell.addJavascriptInterface(new ShellBridge(), "ZeusNative");
        shell.setWebChromeClient(new WebChromeClient());   // janelas simples da interface (ex.: nome de uma coleção nova)
        shell.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                // a interface nunca sai da página local
                return !r.getUrl().toString().startsWith("file:///android_asset/");
            }
        });
        root.addView(shell, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        shell.loadUrl("file:///android_asset/app/index.html");
        handleIntent(getIntent());
    }

    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); handleIntent(i); }

    void handleIntent(Intent i) {
        if (i == null) return;
        String url = null;
        if (Intent.ACTION_VIEW.equals(i.getAction()) && i.getData() != null) url = i.getData().toString();
        if (Intent.ACTION_SEND.equals(i.getAction())) {
            String t = i.getStringExtra(Intent.EXTRA_TEXT);
            if (t != null) { java.util.regex.Matcher m = java.util.regex.Pattern.compile("https?://\\S+").matcher(t); if (m.find()) url = m.group(); }
        }
        if (url == null) return;
        if (shellReady) event("openUrl", obj("url", url)); else pendingUrl = url;
    }

    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); event("pause", new JSONObject()); }
    @Override protected void onResume() { super.onResume(); if (shellReady) event("resume", new JSONObject()); }

    @Override
    public void onBackPressed() {
        if (customView != null) { hideCustom(); return; }
        shell.evaluateJavascript("window.ZN ? ZN.back() : 'exit'", v -> {
            String r = v == null ? "" : v.replace("\"", "");
            if (r.equals("handled")) return;
            Tab t = tabs.get(current);
            if (r.equals("page") && t != null && t.view != null && t.view.canGoBack()) { t.view.goBack(); return; }
            moveTaskToBack(true);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Ponte da interface                                                  */
    /* ------------------------------------------------------------------ */
    class ShellBridge {
        @JavascriptInterface
        public void call(final String id, final String method, final String args) {
            main.post(() -> {
                JSONObject a;
                try { a = new JSONObject(args == null || args.isEmpty() ? "{}" : args); } catch (Exception e) { a = new JSONObject(); }
                try { dispatch(id, method, a); } catch (Exception e) { reply(id, false, String.valueOf(e.getMessage())); }
            });
        }
    }

    void dispatch(String id, String m, JSONObject a) throws Exception {
        switch (m) {
            case "ready": {
                shellReady = true;
                if (pendingUrl != null) { event("openUrl", obj("url", pendingUrl)); pendingUrl = null; }
                reply(id, true, obj("version", appVersion()));
                return;
            }
            case "layout": {
                float d = getResources().getDisplayMetrics().density;
                px = Math.round((float) a.optDouble("x") * d); py = Math.round((float) a.optDouble("y") * d);
                pw = Math.round((float) a.optDouble("w") * d); ph = Math.round((float) a.optDouble("h") * d);
                pageShown = a.optBoolean("show") && pw > 0 && ph > 0;
                placeTabs();
                reply(id, true, null);
                return;
            }
            case "tabNew": {
                Tab t = new Tab();
                t.id = nextId++;
                t.url = a.optString("url", "");
                t.app = a.optBoolean("app");
                if (t.app) t.appHost = Uri.parse(t.url).getHost();
                tabs.put(t.id, t);
                if (!a.optBoolean("lazy")) ensureView(t);
                if (a.optBoolean("show")) { current = t.id; ensureView(t); placeTabs(); }
                reply(id, true, obj("id", t.id));
                return;
            }
            case "tabOpen": {
                Tab t = tabs.get(a.optInt("id"));
                if (t == null) { reply(id, false, "sem separador"); return; }
                current = t.id; ensureView(t); placeTabs();
                reply(id, true, tabInfo(t));
                return;
            }
            case "tabClose": {
                Tab t = tabs.remove(a.optInt("id"));
                if (t != null && t.view != null) { root.removeView(t.view); t.view.destroy(); }
                if (t != null && current == t.id) current = -1;
                reply(id, true, null);
                return;
            }
            case "tabNav": {
                Tab t = tabs.get(a.optInt("id"));
                if (t == null) { reply(id, false, "sem separador"); return; }
                t.url = a.optString("url");
                ensureView(t).loadUrl(t.url);
                reply(id, true, null);
                return;
            }
            case "tabDo": {
                Tab t = tabs.get(a.optInt("id"));
                if (t != null && t.view != null) {
                    String what = a.optString("what");
                    if (what.equals("back") && t.view.canGoBack()) t.view.goBack();
                    else if (what.equals("forward") && t.view.canGoForward()) t.view.goForward();
                    else if (what.equals("reload")) t.view.reload();
                    else if (what.equals("stop")) t.view.stopLoading();
                }
                reply(id, true, t == null ? null : tabInfo(t));
                return;
            }
            case "tabThumb": {
                Tab t = tabs.get(a.optInt("id"));
                reply(id, true, t == null ? null : thumb(t));
                return;
            }
            case "pageMeta": {
                Tab t = tabs.get(a.optInt("id"));
                if (t == null || t.view == null) { reply(id, true, null); return; }
                t.view.evaluateJavascript(META_JS, v -> replyRaw(id, true, v == null ? "null" : v));
                return;
            }
            case "reader": {
                Tab t = tabs.get(a.optInt("id"));
                if (t == null || t.view == null) { reply(id, true, "none"); return; }
                if (readerScript == null) readerScript = readAsset("app/reader.js");
                String o = a.optJSONObject("opts") == null ? "{}" : a.optJSONObject("opts").toString();
                String js = (a.optBoolean("styleOnly") ? "" : readerScript + "\n")
                        + "(window.__zeusReader ? (" + (a.optBoolean("styleOnly") ? "__zeusReader.style(" + o + ")" : "__zeusReader.enter(" + o + ")") + ") : 'none')";
                t.view.evaluateJavascript(js, v -> replyRaw(id, true, v == null ? "\"none\"" : v));
                return;
            }
            case "toPage": {
                Tab t = tabs.get(a.optInt("id"));
                if (t != null && t.view != null) t.view.evaluateJavascript("window.__zhRecv&&window.__zhRecv(" + a.optString("json", "null") + ")", null);
                reply(id, true, null);
                return;
            }
            case "storeRead": { final String n = safeName(a.optString("name")); io.execute(() -> { String txt = readFile(n); reply(id, true, txt); }); return; }
            case "storeWrite": { final String n = safeName(a.optString("name")); final String txt = a.optString("text"); io.execute(() -> reply(id, writeFile(n, txt), null)); return; }
            case "signIn": {
                token = null; tokenExp = 0;
                withToken(true, new TokenCb() {
                    public void ok(String t) { reply(id, true, null); }
                    public void err(String e) { reply(id, false, e); }
                });
                return;
            }
            case "signOut": { token = null; tokenExp = 0; reply(id, true, null); return; }
            case "drive": { driveCall(id, a, true); return; }
            case "httpGet": {
                final String url = a.optString("url");
                if (!url.startsWith("https://api.github.com/") && !url.startsWith("https://api.open-meteo.com/")) { reply(id, false, "endereço não permitido"); return; }
                io.execute(() -> { try { reply(id, true, http("GET", url, null, null, null)); } catch (Exception e) { reply(id, false, String.valueOf(e.getMessage())); } });
                return;
            }
            case "openExternal": { openExternal(a.optString("url")); reply(id, true, null); return; }
            case "share": {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_SUBJECT, a.optString("title"));
                i.putExtra(Intent.EXTRA_TEXT, a.optString("url"));
                startActivity(Intent.createChooser(i, "Partilhar"));
                reply(id, true, null);
                return;
            }
            case "copy": {
                ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                cm.setPrimaryClip(ClipData.newPlainText("Zeus", a.optString("text")));
                reply(id, true, null);
                return;
            }
            case "toast": { Toast.makeText(this, a.optString("text"), Toast.LENGTH_SHORT).show(); reply(id, true, null); return; }
            case "exit": { moveTaskToBack(true); reply(id, true, null); return; }
            default: reply(id, false, "método desconhecido: " + m);
        }
    }

    void reply(String id, boolean ok, Object value) { replyRaw(id, ok, json(value)); }
    void replyRaw(String id, boolean ok, String raw) {
        final String js = "window.ZN&&ZN._r(" + JSONObject.quote(id) + "," + ok + "," + raw + ")";
        main.post(() -> shell.evaluateJavascript(js, null));
    }
    void event(String type, JSONObject data) {
        final String js = "window.ZN&&ZN._ev(" + JSONObject.quote(type) + "," + data + ")";
        main.post(() -> shell.evaluateJavascript(js, null));
    }
    static String json(Object v) {
        if (v == null) return "null";
        if (v instanceof String) return JSONObject.quote((String) v);
        if (v instanceof JSONObject || v instanceof JSONArray || v instanceof Boolean || v instanceof Number) return v.toString();
        return JSONObject.quote(String.valueOf(v));
    }
    static JSONObject obj(Object... kv) {
        JSONObject o = new JSONObject();
        try { for (int i = 0; i + 1 < kv.length; i += 2) o.put((String) kv[i], kv[i + 1] == null ? JSONObject.NULL : kv[i + 1]); } catch (Exception e) { /* ok */ }
        return o;
    }

    /* ------------------------------------------------------------------ */
    /* Separadores                                                         */
    /* ------------------------------------------------------------------ */
    JSONObject tabInfo(Tab t) {
        WebView v = t.view;
        return obj("id", t.id, "url", v != null && v.getUrl() != null ? v.getUrl() : t.url, "title", v != null && v.getTitle() != null ? v.getTitle() : "",
                "back", v != null && v.canGoBack(), "forward", v != null && v.canGoForward());
    }

    void placeTabs() {
        for (Tab t : tabs.values()) {
            if (t.view == null) continue;
            boolean show = pageShown && t.id == current;
            if (show) {
                FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) t.view.getLayoutParams();
                if (lp.leftMargin != px || lp.topMargin != py || lp.width != pw || lp.height != ph) {
                    lp.leftMargin = px; lp.topMargin = py; lp.width = pw; lp.height = ph;
                    t.view.setLayoutParams(lp);
                }
                if (t.view.getVisibility() != View.VISIBLE) { t.view.setVisibility(View.VISIBLE); t.view.onResume(); }
            } else if (t.view.getVisibility() != View.GONE) {
                t.view.setVisibility(View.GONE);
            }
        }
    }

    ZWebView ensureView(final Tab t) {
        if (t.view != null) return t.view;
        final ZWebView v = new ZWebView(this);
        t.view = v;
        v.plain = t.app;
        WebSettings s = v.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // sem "; wv": os sites (e a Google, ao entrar) tratam o Zeus como o Chrome
        if (userAgent == null) userAgent = s.getUserAgentString().replace("; wv", "").replaceAll("Version/[\\d.]+ ", "");
        s.setUserAgentString(userAgent);
        CookieManager.getInstance().setAcceptThirdPartyCookies(v, true);
        v.addJavascriptInterface(new PageBridge(t.id), "ZeusHL");
        v.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest r) {
                String u = r.getUrl().toString();
                String sc = r.getUrl().getScheme() == null ? "" : r.getUrl().getScheme().toLowerCase();
                if (t.app && (sc.equals("http") || sc.equals("https")) && r.isForMainFrame() && r.hasGesture()) {
                    String h = r.getUrl().getHost() == null ? "" : r.getUrl().getHost();
                    boolean own = h.equals(t.appHost) || h.endsWith(".supabase.co") || h.equals("accounts.google.com");
                    if (!own) { event("openUrl", obj("url", u)); return true; }   // como no Mac: o Apolo abre os links em separadores
                }
                if (sc.equals("http") || sc.equals("https") || sc.equals("about") || sc.equals("data") || sc.equals("blob")) return false;
                openExternal(u);
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap fav) {
                event("tab", obj("id", t.id, "url", url, "loading", true));
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!t.app && url != null && url.startsWith("http")) view.evaluateJavascript(hlScript, null);
                JSONObject o = tabInfo(t);
                try { o.put("loading", false); } catch (Exception e) { /* ok */ }
                event("tab", o);
            }
            @Override public void doUpdateVisitedHistory(WebView view, String url, boolean reload) {
                event("tab", tabInfo(t));
            }
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail d) {
                root.removeView(view);
                view.destroy();
                t.view = null;
                event("tab", obj("id", t.id, "crashed", true));
                return true;
            }
        });
        v.setWebChromeClient(new WebChromeClient() {
            @Override public void onReceivedTitle(WebView view, String title) { event("tab", obj("id", t.id, "title", title, "url", view.getUrl())); }
            @Override public void onProgressChanged(WebView view, int p) { event("progress", obj("id", t.id, "p", p)); }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture, Message msg) {
                if (!gesture) return false;
                Tab nt = new Tab();
                nt.id = nextId++;
                nt.url = "";
                tabs.put(nt.id, nt);
                ensureView(nt);
                WebView.WebViewTransport tr = (WebView.WebViewTransport) msg.obj;
                tr.setWebView(nt.view);
                msg.sendToTarget();
                current = nt.id;
                placeTabs();
                event("tabCreated", obj("id", nt.id, "opener", t.id));
                return true;
            }
            @Override public void onCloseWindow(WebView w) { event("tabClosedByPage", obj("id", t.id)); }
            @Override public void onShowCustomView(View cv, CustomViewCallback cb) {
                if (customView != null) { cb.onCustomViewHidden(); return; }
                customView = cv; customCb = cb;
                cv.setBackgroundColor(Color.BLACK);
                root.addView(cv, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            }
            @Override public void onHideCustomView() { hideCustom(); }
            @Override public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try { startActivityForResult(p.createIntent(), REQ_FILE); } catch (Exception e) { fileCb = null; return false; }
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest r) { r.deny(); }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) { cb.invoke(origin, false, false); }
        });
        v.setDownloadListener((url, ua, cd, mime, len) -> download(url, ua, cd, mime));
        v.setVisibility(View.GONE);
        root.addView(v, new FrameLayout.LayoutParams(Math.max(1, pw), Math.max(1, ph)));
        if (t.url != null && !t.url.isEmpty()) v.loadUrl(t.url);
        return v;
    }

    void hideCustom() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        if (customCb != null) customCb.onCustomViewHidden();
        customCb = null;
    }

    String thumb(Tab t) {
        WebView v = t.view;
        if (v == null || v.getWidth() <= 0 || v.getHeight() <= 0 || v.getVisibility() != View.VISIBLE) return null;
        try {
            float k = 360f / v.getWidth();
            Bitmap b = Bitmap.createBitmap(360, Math.max(1, Math.round(v.getHeight() * k)), Bitmap.Config.RGB_565);
            Canvas c = new Canvas(b);
            c.scale(k, k);
            v.draw(c);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            b.compress(Bitmap.CompressFormat.JPEG, 62, out);
            b.recycle();
            return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Throwable e) { return null; }
    }

    void download(String url, String ua, String cd, String mime) {
        if (url == null || !url.startsWith("http")) { Toast.makeText(this, "Este ficheiro não pode ser descarregado aqui.", Toast.LENGTH_SHORT).show(); return; }
        try {
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            String c = CookieManager.getInstance().getCookie(url);
            if (c != null) r.addRequestHeader("Cookie", c);
            r.addRequestHeader("User-Agent", userAgent != null ? userAgent : ua);
            if (mime != null) r.setMimeType(mime);
            String name = URLUtil.guessFileName(url, cd, mime);
            r.setTitle(name);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
            Toast.makeText(this, "A descarregar " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception e) { openExternal(url); }
    }

    void openExternal(String url) {
        try {
            Intent i = url.startsWith("intent:") ? Intent.parseUri(url, Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.setComponent(null);
            i.setSelector(null);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            try {
                Intent i = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                String fb = i.getStringExtra("browser_fallback_url");
                Tab t = tabs.get(current);
                if (fb != null && fb.startsWith("http") && t != null && t.view != null) t.view.loadUrl(fb);
            } catch (Exception e2) { /* ok */ }
        } catch (Exception e) { /* ok */ }
    }

    /* páginas dos separadores → interface (destaques) */
    class PageBridge {
        final int tabId;
        PageBridge(int id) { tabId = id; }
        @JavascriptInterface
        public void send(final String msg) {
            if (msg == null || msg.length() > 60000) return;
            main.post(() -> {
                Tab t = tabs.get(tabId);
                if (t == null || t.view == null) return;
                String url = t.view.getUrl();
                if (url == null || !url.startsWith("http")) return;
                event("page", obj("id", tabId, "url", url, "msg", msg));
            });
        }
    }

    static final String META_JS = "(function(){var q=function(){for(var i=0;i<arguments.length;i++){var k=arguments[i];var e=document.querySelector('meta[property=\"'+k+'\"],meta[name=\"'+k+'\"]');if(e&&e.content)return e.content;}return '';};"
            + "var img=q('og:image','og:image:url','twitter:image','twitter:image:src');try{if(img)img=new URL(img,location.href).href;}catch(e){img='';}"
            + "return {url:location.href,title:q('og:title','twitter:title')||document.title,image:img,excerpt:q('og:description','description','twitter:description'),site:q('og:site_name')};})()";

    /* ------------------------------------------------------------------ */
    /* Conta Google e Drive                                                */
    /* ------------------------------------------------------------------ */
    void withToken(boolean interactive, TokenCb cb) {
        if (token != null && System.currentTimeMillis() < tokenExp) { cb.ok(token); return; }
        AuthorizationRequest req = AuthorizationRequest.builder()
                .setRequestedScopes(Arrays.asList(new Scope(SCOPE_DRIVE), new Scope("email")))
                .build();
        Identity.getAuthorizationClient(this).authorize(req)
                .addOnSuccessListener(r -> {
                    if (r.hasResolution()) {
                        if (!interactive || r.getPendingIntent() == null) { cb.err("needs-signin"); return; }
                        authWaiting.add(cb);
                        if (authWaiting.size() > 1) return;
                        try {
                            startIntentSenderForResult(r.getPendingIntent().getIntentSender(), REQ_AUTH, null, 0, 0, 0, null);
                        } catch (Exception e) { authDone(null, "Não consegui abrir a janela da Google."); }
                    } else {
                        setToken(r.getAccessToken());
                        if (token == null) cb.err("needs-signin"); else cb.ok(token);
                    }
                })
                .addOnFailureListener(e -> cb.err(friendly(e)));
    }
    void setToken(String t) { token = t; tokenExp = System.currentTimeMillis() + 50 * 60 * 1000L; }
    void authDone(String t, String err) {
        List<TokenCb> w = new ArrayList<>(authWaiting);
        authWaiting.clear();
        for (TokenCb cb : w) { if (t != null) cb.ok(t); else cb.err(err); }
    }
    static String friendly(Exception e) {
        String m = String.valueOf(e.getMessage());
        if (m.contains("10:") || m.contains("DEVELOPER_ERROR")) return "A Google não reconhece esta app (falta o cliente Android no projeto Google, com o pacote pt.joao.zeus e a impressão SHA-1).";
        if (m.contains("7:") || m.contains("NETWORK")) return "Sem ligação à internet.";
        return m;
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_AUTH) {
            try {
                AuthorizationResult r = Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data);
                setToken(r.getAccessToken());
                authDone(token, token == null ? "A Google não devolveu acesso." : null);
            } catch (ApiException e) {
                authDone(null, res == RESULT_CANCELED ? "Entrada cancelada." : friendly(e));
            }
        } else if (req == REQ_FILE && fileCb != null) {
            fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCb = null;
        }
    }

    /* Drive: find, download, upload, about — sempre na pasta escondida da app */
    void driveCall(final String id, final JSONObject a, final boolean retry) {
        withToken(false, new TokenCb() {
            public void ok(final String tok) {
                io.execute(() -> {
                    try {
                        reply(id, true, drive(tok, a));
                    } catch (AuthException e) {
                        token = null; tokenExp = 0;
                        if (retry) main.post(() -> driveCall(id, a, false)); else reply(id, false, "needs-signin");
                    } catch (Exception e) {
                        reply(id, false, String.valueOf(e.getMessage()));
                    }
                });
            }
            public void err(String e) { reply(id, false, e); }
        });
    }

    static class AuthException extends Exception { AuthException() { super("auth"); } }

    Object drive(String tok, JSONObject a) throws Exception {
        String op = a.optString("op");
        switch (op) {
            case "find": {
                String q = "name = '" + a.optString("name").replace("'", "") + "' and trashed = false";
                String u = DRIVE + "/files?spaces=appDataFolder&pageSize=10&orderBy=" + enc("modifiedTime desc") + "&fields=" + enc("files(id,modifiedTime)") + "&q=" + enc(q);
                JSONArray f = new JSONObject(http("GET", u, tok, null, null)).optJSONArray("files");
                if (f == null || f.length() == 0) return null;
                return obj("id", f.getJSONObject(0).optString("id"), "mt", f.getJSONObject(0).optString("modifiedTime"));
            }
            case "download":
                return http("GET", DRIVE + "/files/" + enc(a.optString("fid")) + "?alt=media", tok, null, null);
            case "upload": {
                byte[] body = a.optString("text").getBytes(StandardCharsets.UTF_8);
                String fid = a.optString("fid", "");
                if (!fid.isEmpty() && !fid.equals("null")) {
                    String r = http("PATCH", UPLOAD + "/files/" + enc(fid) + "?uploadType=media&fields=id,modifiedTime", tok, "application/json", body);
                    return obj("id", fid, "mt", new JSONObject(r).optString("modifiedTime"));
                }
                String bnd = "zeus" + Long.toHexString(System.nanoTime());
                String meta = obj("name", a.optString("name"), "parents", new JSONArray().put("appDataFolder"), "mimeType", "application/json").toString();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                out.write(("--" + bnd + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta + "\r\n--" + bnd + "\r\nContent-Type: application/json\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                out.write(body);
                out.write(("\r\n--" + bnd + "--").getBytes(StandardCharsets.UTF_8));
                String r = http("POST", UPLOAD + "/files?uploadType=multipart&fields=id,modifiedTime", tok, "multipart/related; boundary=" + bnd, out.toByteArray());
                JSONObject j = new JSONObject(r);
                return obj("id", j.optString("id"), "mt", j.optString("modifiedTime"));
            }
            case "about": {
                JSONObject j = new JSONObject(http("GET", DRIVE + "/about?fields=" + enc("user(emailAddress)"), tok, null, null));
                JSONObject u = j.optJSONObject("user");
                return u != null ? u.optString("emailAddress") : "";
            }
        }
        throw new Exception("operação desconhecida");
    }

    static String enc(String s) { try { return URLEncoder.encode(s, "UTF-8"); } catch (Exception e) { return s; } }

    String http(String method, String url, String tok, String ctype, byte[] body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        if (method.equals("PATCH")) { c.setRequestMethod("POST"); c.setRequestProperty("X-HTTP-Method-Override", "PATCH"); }
        else c.setRequestMethod(method);
        c.setRequestProperty("User-Agent", "Zeus-Android/" + appVersion());
        if (url.startsWith("https://api.github.com/")) c.setRequestProperty("Accept", "application/vnd.github+json");
        if (tok != null) c.setRequestProperty("Authorization", "Bearer " + tok);
        if (body != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", ctype);
            c.setFixedLengthStreamingMode(body.length);
            try (OutputStream o = c.getOutputStream()) { o.write(body); }
        }
        int code = c.getResponseCode();
        if (code == 401) { c.disconnect(); throw new AuthException(); }
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String txt = in == null ? "" : readAll(in);
        c.disconnect();
        if (code >= 400) {
            String msg = "HTTP " + code;
            try { msg = new JSONObject(txt).getJSONObject("error").optString("message", msg); } catch (Exception e) { /* ok */ }
            throw new Exception(msg);
        }
        return txt;
    }

    /* ------------------------------------------------------------------ */
    /* Ficheiros da app                                                    */
    /* ------------------------------------------------------------------ */
    static String safeName(String n) { return n == null ? "x" : n.replaceAll("[^a-zA-Z0-9._-]", "_"); }
    String readFile(String n) {
        File f = new File(getFilesDir(), n);
        if (!f.exists()) return null;
        try (InputStream in = new java.io.FileInputStream(f)) { return readAll(in); } catch (Exception e) { return null; }
    }
    boolean writeFile(String n, String txt) {
        File tmp = new File(getFilesDir(), n + ".tmp"), f = new File(getFilesDir(), n);
        try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(txt.getBytes(StandardCharsets.UTF_8)); o.getFD().sync(); }
        catch (Exception e) { return false; }
        return tmp.renameTo(f);
    }
    String readAsset(String p) { try (InputStream in = getAssets().open(p)) { return readAll(in); } catch (Exception e) { return ""; } }
    static String readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }
    String appVersion() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }
}
