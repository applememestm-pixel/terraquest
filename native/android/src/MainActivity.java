package app.terraquest.atlas;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final String HOST = "terra.local";
    private static final String HOME = "https://" + HOST + "/index.html";
    private WebView atlas;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        atlas = new WebView(this);
        atlas.setBackgroundColor(Color.rgb(17, 26, 42));
        atlas.getSettings().setJavaScriptEnabled(true);
        atlas.getSettings().setDomStorageEnabled(true);
        atlas.getSettings().setBlockNetworkLoads(true);
        atlas.getSettings().setAllowFileAccess(false);
        atlas.getSettings().setAllowContentAccess(false);
        atlas.getSettings().setSupportMultipleWindows(false);
        atlas.setWebViewClient(new LocalAtlasClient());
        FrameLayout wrapper = new FrameLayout(this);
        wrapper.setBackgroundColor(Color.rgb(17, 26, 42));
        wrapper.setFitsSystemWindows(true);
        wrapper.addView(atlas, new FrameLayout.LayoutParams(-1, -1));
        setContentView(wrapper);
        if (savedInstanceState == null || atlas.restoreState(savedInstanceState) == null) atlas.loadUrl(HOME);
    }

    private static boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort() == -1;
    }

    private final class LocalAtlasClient extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !isLocal(request.getUrl());
        }

        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!isLocal(url) || !"GET".equals(request.getMethod())) return unavailable();
            String path = url.getPath();
            if (path == null || path.contains("..") || path.contains("\\")) return unavailable();
            path = path.isEmpty() || "/".equals(path) ? "index.html" : path.substring(1);
            try {
                InputStream input = getAssets().open(path);
                String mime = contentType(path);
                String encoding = mime.startsWith("text/") || mime.equals("application/javascript") ? "UTF-8" : null;
                return new WebResourceResponse(mime, encoding, input);
            } catch (IOException missing) {
                return unavailable();
            }
        }
    }

    private static WebResourceResponse unavailable() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private static String contentType(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".jpg")) return "image/jpeg";
        return "application/octet-stream";
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        atlas.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override public void onBackPressed() {
        if (atlas.canGoBack()) atlas.goBack();
        else super.onBackPressed();
    }
}
