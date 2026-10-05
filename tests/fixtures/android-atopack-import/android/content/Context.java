package android.content;

import android.content.res.AssetManager;
import java.io.File;

public class Context {
  private final File root;
  private final AssetManager assets;
  public Context(File root, String catalog) {
    this.root = root;
    this.assets = new AssetManager(catalog);
    getFilesDir().mkdirs();
    getCacheDir().mkdirs();
  }
  public Context getApplicationContext() { return this; }
  public File getFilesDir() { return new File(root, "files"); }
  public File getCacheDir() { return new File(root, "cache"); }
  public AssetManager getAssets() { return assets; }
}
