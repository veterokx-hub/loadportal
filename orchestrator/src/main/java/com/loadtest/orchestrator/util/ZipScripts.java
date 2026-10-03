package com.loadtest.orchestrator.util;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Распаковка zip-артефакта перед записью в S3. */
public final class ZipScripts {

    private static final int MAX_FILES = 80;
    private static final int MAX_ENTRY_BYTES = 20 * 1024 * 1024;

    public record Entry(String path, byte[] content) {
    }

    private ZipScripts() {
    }

    public static boolean isZip(byte[] bytes, String filename) {
        if (filename != null && filename.toLowerCase(Locale.ROOT).endsWith(".zip")) {
            return true;
        }
        return bytes != null && bytes.length >= 4
                && bytes[0] == 0x50 && bytes[1] == 0x4b;
    }

    public static List<Entry> unpack(byte[] zip) {
        if (zip == null || zip.length == 0) {
            throw new IllegalArgumentException("Пустой zip-архив");
        }
        List<Entry> out = new ArrayList<>();
        try (ZipInputStream in = new ZipInputStream(new ByteArrayInputStream(zip))) {
            ZipEntry entry;
            while ((entry = in.getNextEntry()) != null) {
                if (entry.isDirectory()) {
                    continue;
                }
                String path = sanitize(entry.getName());
                if (path == null) {
                    continue;
                }
                byte[] content = readEntry(in);
                if (content.length == 0) {
                    continue;
                }
                out.add(new Entry(path, content));
                if (out.size() > MAX_FILES) {
                    throw new IllegalArgumentException("В архиве слишком много файлов");
                }
            }
        } catch (IOException e) {
            throw new IllegalArgumentException("Не удалось распаковать zip: " + e.getMessage());
        }
        if (out.isEmpty()) {
            throw new IllegalArgumentException("В zip нет файлов");
        }
        return out;
    }

    /**
     * Точка входа для CI: .jmx у JMeter, .js/.ts у k6, pom.xml у Gatling
     * (Simulation исполняется через {@code mvn gatling:test}, а не напрямую).
     */
    public static String primaryScript(List<Entry> entries) {
        for (Entry e : entries) {
            if (e.path().toLowerCase(Locale.ROOT).endsWith(".jmx")) {
                return e.path();
            }
        }
        for (Entry e : entries) {
            String n = e.path().replace('\\', '/');
            if (n.equals("script.js") || n.endsWith("/script.js")) {
                return e.path();
            }
        }
        for (Entry e : entries) {
            String n = e.path().toLowerCase(Locale.ROOT);
            if ((n.endsWith(".js") || n.endsWith(".ts")) && !n.replace('\\', '/').contains("/lib/")) {
                return e.path();
            }
        }
        for (Entry e : entries) {
            if (e.path().toLowerCase(Locale.ROOT).endsWith("pom.xml")) {
                return e.path();
            }
        }
        return entries.get(0).path();
    }

    private static String sanitize(String name) {
        if (name == null) {
            return null;
        }
        String n = name.replace('\\', '/');
        while (n.startsWith("/")) {
            n = n.substring(1);
        }
        if (n.isBlank() || n.contains("..")) {
            return null;
        }
        if (n.startsWith("__MACOSX/") || n.endsWith(".DS_Store")) {
            return null;
        }
        return n;
    }

    private static byte[] readEntry(ZipInputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int total = 0;
        int n;
        while ((n = in.read(chunk)) >= 0) {
            total += n;
            if (total > MAX_ENTRY_BYTES) {
                throw new IllegalArgumentException("Файл в архиве слишком большой");
            }
            buf.write(chunk, 0, n);
        }
        return buf.toByteArray();
    }
}
