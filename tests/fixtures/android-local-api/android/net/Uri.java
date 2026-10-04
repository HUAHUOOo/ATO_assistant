package android.net;

import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public final class Uri {
  private final URI value;
  private Uri(String raw) { value = URI.create(raw); }
  public static Uri parse(String raw) { return new Uri(raw); }
  public String getPath() { return value.getPath(); }
  public String getQueryParameter(String name) {
    String query = value.getRawQuery();
    if (query == null) return null;
    for (String pair : query.split("&")) {
      String[] parts = pair.split("=", 2);
      if (name.equals(URLDecoder.decode(parts[0], StandardCharsets.UTF_8))) {
        return parts.length == 2 ? URLDecoder.decode(parts[1], StandardCharsets.UTF_8) : "";
      }
    }
    return null;
  }
  public static String encode(String text) {
    return URLEncoder.encode(text, StandardCharsets.UTF_8).replace("+", "%20");
  }
}
