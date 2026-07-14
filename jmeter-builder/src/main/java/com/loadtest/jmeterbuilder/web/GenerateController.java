package com.loadtest.jmeterbuilder.web;

import com.loadtest.jmeterbuilder.jmx.JmxBuilder;
import com.loadtest.jmeterbuilder.model.Dataset;
import com.loadtest.jmeterbuilder.model.Scenario;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Stateless генерация JMeter .jmx (+ zip с CSV).
 * Вызывается из constructor; сам сервис без БД и без auth (внутренняя сеть).
 */
@RestController
@RequestMapping("/generate")
public class GenerateController {

    private final JmxBuilder jmxBuilder;

    public GenerateController(JmxBuilder jmxBuilder) {
        this.jmxBuilder = jmxBuilder;
    }

    @PostMapping("/jmeter")
    public ResponseEntity<byte[]> generate(@RequestBody Scenario scenario) {
        String fileName = safeName(scenario.name());
        String jmx = jmxBuilder.build(scenario);
        List<Dataset> datasets = scenario.datasets() == null ? List.of() : scenario.datasets();

        if (datasets.isEmpty()) {
            String outName = fileName + ".jmx";
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + outName + "\"")
                    .contentType(MediaType.APPLICATION_XML)
                    .body(jmx.getBytes(StandardCharsets.UTF_8));
        }

        String outName = fileName + ".zip";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + outName + "\"")
                .contentType(MediaType.parseMediaType("application/zip"))
                .body(zip(fileName + ".jmx", jmx, datasets));
    }

    private byte[] zip(String jmxName, String jmx, List<Dataset> datasets) {
        try (ByteArrayOutputStream baos = new ByteArrayOutputStream();
             ZipOutputStream zos = new ZipOutputStream(baos)) {

            zos.putNextEntry(new ZipEntry(jmxName));
            zos.write(jmx.getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();

            for (Dataset ds : datasets) {
                if (ds.fileName() == null || ds.fileName().isBlank()) continue;
                zos.putNextEntry(new ZipEntry(ds.fileName()));
                zos.write(toCsv(ds).getBytes(StandardCharsets.UTF_8));
                zos.closeEntry();
            }
            zos.finish();
            return baos.toByteArray();
        } catch (Exception e) {
            throw new IllegalStateException("Не удалось собрать ZIP: " + e.getMessage(), e);
        }
    }

    private String toCsv(Dataset ds) {
        StringBuilder sb = new StringBuilder();
        for (List<String> row : ds.rows()) {
            sb.append(String.join(",", row.stream().map(this::escapeCsv).toList()));
            sb.append("\n");
        }
        return sb.toString();
    }

    private String escapeCsv(String v) {
        if (v == null) return "";
        if (v.contains(",") || v.contains("\"") || v.contains("\n")) {
            return "\"" + v.replace("\"", "\"\"") + "\"";
        }
        return v;
    }

    private String safeName(String name) {
        if (name == null || name.isBlank()) return "scenario";
        return name.replaceAll("[^a-zA-Z0-9_.-]", "_");
    }
}
