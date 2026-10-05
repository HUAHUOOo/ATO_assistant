package android.content;

import android.net.Uri;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;

public class ContentResolver {
  public InputStream openInputStream(Uri uri) throws IOException { return new FileInputStream(uri.getPath()); }
}
