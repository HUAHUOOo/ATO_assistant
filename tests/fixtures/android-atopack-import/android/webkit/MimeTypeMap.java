package android.webkit;

public class MimeTypeMap {
  public static String getFileExtensionFromUrl(String path) { return path.substring(path.lastIndexOf('.') + 1); }
  public static MimeTypeMap getSingleton() { return new MimeTypeMap(); }
  public String getMimeTypeFromExtension(String extension) {
    return switch (extension) {
      case "png" -> "image/png";
      case "jpg", "jpeg" -> "image/jpeg";
      case "svg" -> "image/svg+xml";
      case "mp3" -> "audio/mpeg";
      default -> null;
    };
  }
}
