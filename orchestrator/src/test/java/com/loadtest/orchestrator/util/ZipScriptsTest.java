package com.loadtest.orchestrator.util;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ZipScriptsTest {

    @Test
    void detectsZipByNameOrMagic() {
        assertTrue(ZipScripts.isZip(new byte[] {1}, "Artifact.ZIP"));
        assertTrue(ZipScripts.isZip(new byte[] {0x50, 0x4b, 3, 4}, "script.jmx"));
        assertFalse(ZipScripts.isZip(new byte[] {1, 2, 3, 4}, "script.jmx"));
        assertFalse(ZipScripts.isZip(null, null));
    }

    @Test
    void unpacksFilesAndSkipsJunk() throws Exception {
        var files = new java.util.LinkedHashMap<String, String>();
        files.put("dir/", "");
        files.put("__MACOSX/._a", "junk");
        files.put("../evil.txt", "no");
        files.put("src/script.js", "export {}");
        files.put("pom.xml", "<project/>");
        files.put("plan.jmx", "<jmeterTestPlan/>");
        files.put("empty.txt", "");
        byte[] zip = zip(files);

        var entries = ZipScripts.unpack(zip);
        assertEquals(
                java.util.List.of("src/script.js", "pom.xml", "plan.jmx"),
                entries.stream().map(ZipScripts.Entry::path).toList());
        assertEquals("plan.jmx", ZipScripts.primaryScript(entries));
    }

    @Test
    void primaryScriptPrefersScriptJsThenOtherJsOutsideLibThenPom() throws Exception {
        var k6 = ZipScripts.unpack(zip(Map.of(
                "lib/vendor.js", "v",
                "script.js", "k6",
                "pom.xml", "<project/>"
        )));
        assertEquals("script.js", ZipScripts.primaryScript(k6));

        var ts = ZipScripts.unpack(zip(Map.of(
                "src/lib/vendor.js", "v",
                "sim.ts", "ts"
        )));
        assertEquals("sim.ts", ZipScripts.primaryScript(ts));

        var gatling = ZipScripts.unpack(zip(Map.of("pom.xml", "<project/>")));
        assertEquals("pom.xml", ZipScripts.primaryScript(gatling));
    }

    @Test
    void rejectsEmptyAndOversizedArchives() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> ZipScripts.unpack(new byte[0]));
        assertThrows(IllegalArgumentException.class, () -> ZipScripts.unpack(zip(Map.of("note.txt", ""))));

        var many = new java.util.LinkedHashMap<String, String>();
        for (int i = 0; i < 81; i++) {
            many.put("f" + i + ".txt", "x");
        }
        assertThrows(IllegalArgumentException.class, () -> ZipScripts.unpack(zip(many)));
    }

    private static byte[] zip(Map<String, String> files) throws Exception {
        var buf = new ByteArrayOutputStream();
        try (var out = new ZipOutputStream(buf)) {
            for (var entry : files.entrySet()) {
                out.putNextEntry(new ZipEntry(entry.getKey()));
                if (!entry.getKey().endsWith("/")) {
                    out.write(entry.getValue().getBytes(StandardCharsets.UTF_8));
                }
                out.closeEntry();
            }
        }
        return buf.toByteArray();
    }
}
