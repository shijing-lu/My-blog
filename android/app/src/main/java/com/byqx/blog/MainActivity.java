package com.byqx.blog;

import android.app.*;
import android.os.*;
import android.content.*;
import android.database.sqlite.SQLiteDatabase;
import android.database.Cursor;
import android.net.Uri;
import android.graphics.Color;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.zip.*;
import javax.crypto.*;
import javax.crypto.spec.*;

public class MainActivity extends Activity {
    private static final String BASE = "http://127.0.0.1:43218";
    private static volatile boolean started;
    private static volatile String startupError;
    private static volatile String startupPhase = "正在准备本地服务";
    private static volatile long startupDeadline;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private LinearLayout screen;
    private TextView status;
    private File user;
    private String r2Base = "";
    private ValueCallback<Uri[]> chooser;
    private boolean destroyed;
    private static native int startNode(String[] arguments);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        user = new File(getFilesDir(), "byqx-blog-desktop");
        user.mkdirs();
        screen = new LinearLayout(this); screen.setOrientation(LinearLayout.VERTICAL);
        screen.setBackgroundColor(Color.rgb(250,248,244));
        screen.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(screen);
        if (!new File(user, "config.json").exists()) showSetup(); else startLocal();
    }

    private TextView text(String value) { TextView t = new TextView(this); t.setText(value); t.setTextColor(Color.rgb(35,35,32)); t.setPadding(24,18,24,18); return t; }
    private Button button(String label, Runnable action) { Button b = new Button(this); b.setText(label); b.setAllCaps(false); b.setOnClickListener(v -> action.run()); return b; }
    private void showSetup() {
        screen.removeAllViews();
        TextView title = text("白衣卿相 · 本地与云端"); title.setTextSize(24); screen.addView(title);
        screen.addView(text("导入桌面数据后，断网也能查看和编辑已保存的内容。联网时，可在站点设置中使用云端同步。"));
        screen.addView(button("导入桌面加密迁移包", () -> {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT); intent.setType("*/*"); intent.addCategory(Intent.CATEGORY_OPENABLE); startActivityForResult(intent, 100);
        }));
        screen.addView(button("创建空白本地站点", () -> {
            EditText password = new EditText(this); password.setHint("设置站主密码（至少 8 个字符）"); password.setInputType(129);
            AlertDialog d = new AlertDialog.Builder(this).setTitle("本地站主密码").setView(password).setNegativeButton("取消", null).setPositiveButton("创建", null).create();
            d.setOnShowListener(v -> d.getButton(-1).setOnClickListener(w -> {
                String value = password.getText().toString();
                if (value.length() < 8) { password.setError("至少 8 个字符"); return; }
                try { JSONObject c = new JSONObject(); c.put("ADMIN_PASSWORD", value); c.put("TOP_ADMIN_PASSWORD", value); Files.write(new File(user,"config.json").toPath(), c.toString().getBytes(StandardCharsets.UTF_8)); d.dismiss(); startLocal(); }
                catch (Exception e) { showError("无法保存本地配置"); }
            })); d.show();
        }));
    }

    private void showError(String message) {
        if (destroyed) return;
        new AlertDialog.Builder(this).setTitle("未完成").setMessage(message).setPositiveButton("知道了", null).show();
    }

    private void startLocal() {
        screen.removeAllViews(); status = text("正在打开本地站点…"); screen.addView(status);
        if (!started) {
            started = true;
            startupDeadline = SystemClock.elapsedRealtime() + 180000;
            new File(user,"runtime-error").delete();
            new File(user,"runtime-ready").delete();
            new File(user,"runtime-phase").delete();
            new Thread(() -> {
                try {
                    startupPhase = "正在加载本地运行环境";
                    System.loadLibrary("node"); System.loadLibrary("byqx-node");
                    String revision;
                    try (InputStream in = getAssets().open("runtime-id.txt")) { revision = new String(readBytes(in), StandardCharsets.UTF_8).trim(); }
                    if (!revision.matches("[a-f0-9]{64}")) throw new IOException("运行载荷标识无效");
                    File runtime = new File(getFilesDir(), "runtime/" + revision);
                    if (!new File(runtime,"complete").exists()) {
                        startupPhase = "正在解压首次运行资源，请稍候";
                        runtime.mkdirs();
                        try(InputStream input = getAssets().open("runtime.zip")) { unzip(input, runtime, false); }
                        Files.write(new File(runtime,"complete").toPath(), new byte[]{1});
                    }
                    startupPhase = "正在启动本地服务";
                    startupDeadline = SystemClock.elapsedRealtime() + 90000;
                    int result = startNode(new String[]{"node", new File(runtime,"main.cjs").getPath(), user.getPath(), getApplicationInfo().nativeLibraryDir});
                    startupError = "本地服务已停止（" + result + "），请关闭应用后重新打开。";
                } catch (Throwable e) { startupError = "本地服务启动失败：" + e.getClass().getSimpleName(); android.util.Log.e("Byqx", "Startup failed", e); }
            }, "ByqxRuntime").start();
        }
        waitForServer();
    }

    private String runtimePhase() {
        try {
            String phase = readFile(new File(user,"runtime-phase")).trim();
            if (phase.equals("config")) return "正在读取本地配置";
            if (phase.equals("sqlite")) return "正在打开本地数据库";
            if (phase.equals("astro")) return "正在启动网站服务";
            if (phase.equals("ready")) return "正在打开网站页面";
        } catch(Exception ignored) {}
        return startupPhase;
    }

    private void showStartupFailure(String phase, int httpStatus) {
        String code = startupError;
        if (code == null) {
            try {
                JSONObject error = new JSONObject(readFile(new File(user,"runtime-error")));
                code = error.optString("name", "UNKNOWN") + " / " + error.optString("code", "UNKNOWN");
            } catch(Exception ignored) { code = "STARTUP_TIMEOUT"; }
        }
        String version = "unknown";
        try { version = getPackageManager().getPackageInfo(getPackageName(),0).versionName; } catch(Exception ignored) {}
        final String diagnostic = "白衣卿相 Android " + version + "\n阶段：" + phase + "\n错误：" + code + "\nHTTP：" + httpStatus + "\nAndroid API：" + Build.VERSION.SDK_INT + "\n架构：" + Arrays.toString(Build.SUPPORTED_ABIS);
        status.setText("本地站点未能启动；已有数据会保留。请关闭应用并重新打开。若仍失败，请复制诊断信息。\n\n" + diagnostic);
        screen.addView(button("复制诊断信息", () -> {
            android.content.ClipboardManager clipboard = (android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
            clipboard.setPrimaryClip(ClipData.newPlainText("启动诊断", diagnostic));
            Toast.makeText(this,"诊断信息已复制",Toast.LENGTH_SHORT).show();
        }));
    }

    private void waitForServer() {
        if (destroyed) return;
        new Thread(() -> {
            int response = -1;
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection)new URL(BASE + "/").openConnection();
                connection.setConnectTimeout(1000); connection.setReadTimeout(3000);
                response = connection.getResponseCode();
            } catch(Exception ignored) {}
            finally { if(connection != null) connection.disconnect(); }
            final int httpStatus = response;
            final String phase = runtimePhase();
            handler.post(() -> {
                if (destroyed) return;
                if (startupError != null || new File(user,"runtime-error").exists()) showStartupFailure(phase,httpStatus);
                else if (httpStatus == 200 && new File(user,"runtime-ready").exists()) showSite();
                else if (SystemClock.elapsedRealtime() >= startupDeadline) showStartupFailure(phase,httpStatus);
                else {
                    status.setText(phase + "…");
                    handler.postDelayed(() -> waitForServer(), 1000);
                }
            });
        }).start();
    }

    @SuppressWarnings("SetJavaScriptEnabled") private void showSite() {
        screen.removeAllViews();
        try { r2Base = new JSONObject(readFile(new File(user,"config.json"))).optString("R2_PUBLIC_BASE_URL").replaceAll("/+$", ""); } catch(Exception ignored) {}
        web = new WebView(this); web.setBackgroundColor(Color.rgb(250,248,244));
        WebSettings s = web.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setAllowFileAccess(false); s.setAllowContentAccess(false); s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); s.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView w, WebResourceRequest request) {
                if (isLocal(request.getUrl())) return false;
                openExternal(request.getUrl().toString()); return true;
            }
            @Override public void onPageFinished(WebView w,String url) { CookieManager.getInstance().flush(); }
            @Override public WebResourceResponse shouldInterceptRequest(WebView w, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (!r2Base.isEmpty() && url.startsWith(r2Base + "/") && request.getMethod().equals("GET")) {
                    try {
                        String key = url.substring(r2Base.length()+1).split("\\?",2)[0];
                        HttpURLConnection c = (HttpURLConnection)new URL(BASE + "/api/desktop/object/" + key).openConnection(); c.setConnectTimeout(4000); c.setReadTimeout(10000);
                        if(c.getResponseCode()==200) { String mime = c.getContentType(); InputStream in=c.getInputStream(); return new WebResourceResponse(mime == null ? "application/octet-stream" : mime.split(";",2)[0], null, new FilterInputStream(in){ @Override public void close() throws IOException { super.close(); c.disconnect(); } }); }
                        c.disconnect();
                    } catch(Exception ignored) {}
                }
                return null;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if(chooser != null) chooser.onReceiveValue(null); chooser = callback;
                try { startActivityForResult(params.createIntent(), 101); return true; } catch(Exception e) { chooser.onReceiveValue(null); chooser=null; return false; }
            }
        });
        screen.addView(web, new LinearLayout.LayoutParams(-1,0,1)); web.loadUrl(BASE);
    }

    private boolean isLocal(Uri uri) { return "http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()) && uri.getPort()==43218; }
    private void openExternal(String url) {
        if(url==null) return; Uri uri = Uri.parse(url); String scheme = uri.getScheme();
        if(!Arrays.asList("http","https","mailto","tel").contains(scheme)) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW,uri)); } catch(Exception e) { showError("没有可打开此链接的应用"); }
    }
    @Override public void onBackPressed() { if(web!=null && web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
    @Override protected void onDestroy() { destroyed=true; handler.removeCallbacksAndMessages(null); if(web!=null) { web.destroy(); web=null; } super.onDestroy(); }

    @Override protected void onActivityResult(int code,int result,Intent data) {
        super.onActivityResult(code,result,data);
        if(code==101 && chooser!=null) { chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data)); chooser=null; }
        if(code==100 && result==RESULT_OK && data!=null) {
            EditText password=new EditText(this); password.setInputType(129); password.setHint("输入迁移包口令");
            new AlertDialog.Builder(this).setTitle("导入桌面数据").setMessage("只在首次初始化时导入，不会改动电脑上的数据。口令在电脑上的迁移口令文件中。").setView(password).setNegativeButton("取消",null).setPositiveButton("导入",(d,w)->importTransfer(data.getData(),password.getText().toString())).show();
        }
    }

    private void importTransfer(Uri uri,String password) {
        screen.removeAllViews(); screen.addView(text("正在解密和导入，请保持应用打开…"));
        new Thread(() -> {
            File staging = new File(getCacheDir(),"transfer-"+System.nanoTime()); staging.mkdirs();
            try {
                if(started || new File(user,"config.json").exists() || new File(user,"blog-local.db").exists()) throw new IOException("已有本地数据，不允许覆盖导入");
                try(InputStream raw=getContentResolver().openInputStream(uri); DataInputStream input=new DataInputStream(raw)) {
                    byte[] magic=new byte[8], salt=new byte[16], iv=new byte[12]; input.readFully(magic); input.readFully(salt); input.readFully(iv);
                    if(!Arrays.equals(magic,"BYQXM01\n".getBytes(StandardCharsets.US_ASCII))) throw new IOException("迁移包格式不正确");
                    PBEKeySpec spec=new PBEKeySpec(password.toCharArray(),salt,210000,256);
                    byte[] key=SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(); spec.clearPassword();
                    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv)); Arrays.fill(key,(byte)0);
                    // Authenticate the complete ciphertext before reading or committing any zip contents.
                    File archive=new File(staging,"archive.zip");
                    try(CipherInputStream clear=new CipherInputStream(input,cipher); OutputStream out=new FileOutputStream(archive)) { copyLimited(clear,out,1024L*1024*1024); }
                    File incoming=new File(staging,"data"); incoming.mkdirs();
                    try(InputStream zip=new FileInputStream(archive)) { unzip(zip,incoming,true); }
                    JSONObject config=new JSONObject(readFile(new File(incoming,"config.json")));
                    if(config.optString("ADMIN_PASSWORD").isEmpty()) throw new IOException("迁移包缺少站主配置");
                    config.remove("AUTH_SECRET"); Files.write(new File(incoming,"config.json").toPath(),config.toString().getBytes(StandardCharsets.UTF_8));
                    try(SQLiteDatabase db=SQLiteDatabase.openDatabase(new File(incoming,"blog-local.db").getPath(),null,SQLiteDatabase.OPEN_READONLY); Cursor check=db.rawQuery("PRAGMA quick_check",null)) { if(!check.moveToFirst() || !"ok".equals(check.getString(0))) throw new IOException("数据库检查未通过"); }
                    if(!user.delete()) throw new IOException("本地目录不是空目录，不允许覆盖");
                    if(!incoming.renameTo(user)) { user.mkdirs(); throw new IOException("无法提交导入数据"); }
                }
                handler.post(() -> { if(!destroyed) startLocal(); });
            } catch(Exception e) { handler.post(() -> { if(!destroyed) { showSetup(); showError("导入失败：请检查口令和迁移包是否完整。已有数据没有被覆盖。"); } }); }
            finally { removePrivate(staging); }
        },"ByqxImport").start();
    }

    private void unzip(InputStream input,File root,boolean transfer) throws IOException {
        long total=0; int count=0; HashSet<String> names=new HashSet<>();
        try(ZipInputStream zip=new ZipInputStream(input)) {
            ZipEntry entry;
            while((entry=zip.getNextEntry())!=null) {
                String name=entry.getName();
                if(++count>60000 || name.contains("\\") || name.startsWith("/") || !names.add(name)) throw new IOException("归档路径无效");
                if(transfer && !(name.equals("config.json") || name.equals("blog-local.db") || name.startsWith("files/") || name.startsWith("META-INF/"))) throw new IOException("迁移包包含未知文件");
                File target=new File(root,name);
                if(!target.getCanonicalPath().startsWith(root.getCanonicalPath()+File.separator)) throw new IOException("归档路径越界");
                if(entry.isDirectory()) { target.mkdirs(); continue; }
                target.getParentFile().mkdirs();
                try(OutputStream out=new FileOutputStream(target)) { total += copyLimited(zip,out,1024L*1024*1024-total); }
            }
        }
    }
    private long copyLimited(InputStream in,OutputStream out,long max) throws IOException { byte[] buffer=new byte[65536]; long size=0; int n; while((n=in.read(buffer))!=-1) { size+=n; if(size>max) throw new IOException("数据包超过大小限制"); out.write(buffer,0,n); } return size; }
    private byte[] readBytes(InputStream input) throws IOException { ByteArrayOutputStream out=new ByteArrayOutputStream(); copyLimited(input,out,1024*1024); return out.toByteArray(); }
    private String readFile(File file) throws IOException { try(InputStream input=new FileInputStream(file)) { return new String(readBytes(input),StandardCharsets.UTF_8); } }
    private void removePrivate(File file) { if(file.isDirectory()) { File[] children=file.listFiles(); if(children!=null) for(File child:children) removePrivate(child); } file.delete(); }
}
