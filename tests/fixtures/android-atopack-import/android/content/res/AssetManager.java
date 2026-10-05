package android.content.res;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class AssetManager {
  private final String catalog;
  public AssetManager(String catalog) { this.catalog = catalog; }
  public InputStream open(String path) { return new ByteArrayInputStream(catalog.getBytes(StandardCharsets.UTF_8)); }
}
