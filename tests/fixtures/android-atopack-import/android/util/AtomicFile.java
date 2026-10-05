package android.util;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

/** Disk-backed approximation of Android's .bak AtomicFile, with failure injection. */
public class AtomicFile {
  public static String failNextWrite = "";
  public static boolean failDuringWrite;
  private final File base;
  private final File backup;
  public AtomicFile(File base) { this.base = base; backup = new File(base + ".bak"); }
  public File getBaseFile() { return base; }
  public FileInputStream openRead() throws IOException {
    if (backup.isFile()) Files.move(backup.toPath(), base.toPath(), StandardCopyOption.REPLACE_EXISTING);
    return new FileInputStream(base);
  }
  public FileOutputStream startWrite() throws IOException {
    if (base.getName().equals(failNextWrite)) {
      failNextWrite = "";
      throw new IOException("Injected atomic index failure");
    }
    if (base.isFile()) Files.move(base.toPath(), backup.toPath(), StandardCopyOption.REPLACE_EXISTING);
    if (failDuringWrite) {
      failDuringWrite = false;
      return new FileOutputStream(base) {
        @Override public void write(byte[] value) throws IOException {
          super.write(value, 0, Math.max(1, value.length / 2));
          throw new IOException("Injected interrupted index write");
        }
      };
    }
    return new FileOutputStream(base);
  }
  public void finishWrite(FileOutputStream output) throws IOException {
    output.getFD().sync();
    output.close();
    Files.deleteIfExists(backup.toPath());
  }
  public void failWrite(FileOutputStream output) throws IOException {
    output.close();
    Files.deleteIfExists(base.toPath());
    if (backup.isFile()) Files.move(backup.toPath(), base.toPath(), StandardCopyOption.REPLACE_EXISTING);
  }
}
