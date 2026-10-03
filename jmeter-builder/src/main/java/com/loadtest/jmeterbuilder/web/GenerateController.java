package com.loadtest.jmeterbuilder.web;

import com.loadtest.jmeterbuilder.jmx.JmxBuilder;
import com.loadtest.jmeterbuilder.metrics.BuilderMetrics;
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
    private final BuilderMetrics metrics;

    public GenerateController(JmxBuilder jmxBuilder, BuilderMetrics metrics) {
        this.jmxBuilder = jmxBuilder;
        this.metrics = metrics;
    }

    @PostMapping("/jmeter")
    public ResponseEntity<byte[]> generate(@RequestBody Scenario scenario) {
        List<Dataset> datasets = scenario.datasets() == null ? List.of() : scenario.datasets();
        // Формат известен до сборки: с датасетами отдаём zip, без них — одиночный .jmx.
        String format = datasets.isEmpty() ? "jmx" : "zip";
        int requestCount = scenario.requests() == null ? 0 : scenario.requests().size();
        long startedAt = System.nanoTime();

        try {
            String fileName = safeName(scenario.name());
            String jmx = jmxBuilder.build(scenario);

            byte[] body = datasets.isEmpty()
                    ? jmx.getBytes(StandardCharsets.UTF_8)
                    : zip(fileName + ".jmx", jmx, datasets);
            String outName = fileName + "." + format;

            metrics.recordBuild(format, true, System.nanoTime() - startedAt, body.length, requestCount);

            // Не application/xml: браузер сохранил бы артефакт как .xml вместо .jmx.
            MediaType contentType = datasets.isEmpty()
                    ? MediaType.APPLICATION_OCTET_STREAM
                    : MediaType.parseMediaType("application/zip");
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + outName + "\"")
                    .contentType(contentType)
                    .body(body);
        } catch (RuntimeException e) {
            metrics.recordBuild(format, false, System.nanoTime() - startedAt, 0, requestCount);
            throw e;
        }
    }

    private byte[] zip(String jmxName, String jmx, List<Dataset> datasets) {
        try (ByteArrayOutputStream baos = new ByteArrayOutputStream();
             ZipOutputStream zos = new ZipOutputStream(baos)) {

            zos.putNextEntry(new ZipEntry(jmxName));
            zos.write(jmx.getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();

            for (Dataset ds : datasets) {
                String entry = zipEntryName(ds.fileName());
                if (entry == null) continue;
                zos.putNextEntry(new ZipEntry(entry));
                zos.write(toCsv(ds).getBytes(StandardCharsets.UTF_8));
                zos.closeEntry();
            }
            zos.finish();
            return baos.toByteArray();
        } catch (Exception e) {
            throw new IllegalStateException("Не удалось собрать ZIP: " + e.getMessage(), e);
        }
    }

    /**
     * CSV с заголовком: первая строка — имена колонок (variableNames), далее данные.
     * Согласовано с ignoreFirstLine=true в CSV Data Set / Random CSV.
     */
    private String toCsv(Dataset ds) {
        StringBuilder sb = new StringBuilder();
        List<String> columns = ds.columns();
        if (!columns.isEmpty()) {
            sb.append(String.join(",", columns.stream().map(this::escapeCsv).toList()));
            sb.append("\n");
        }
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

    private static String zipEntryName(String fileName) {
        if (fileName == null || fileName.isBlank()) {
            return null;
        }
        String n = fileName.replace('\\', '/');
        int slash = n.lastIndexOf('/');
        if (slash >= 0) {
            n = n.substring(slash + 1);
        }
        n = n.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (n.isBlank() || n.contains("..")) {
            return null;
        }
        return n;
    }

    private String safeName(String name) {
        if (name == null || name.isBlank()) return "scenario";
        String cleaned = name.replaceAll("[^a-zA-Z0-9_.-]", "_")
                .replaceAll("_+", "_")
                .replaceAll("^_|_$", "");
        return cleaned.isBlank() ? "scenario" : cleaned;
    }
}
