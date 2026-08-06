package com.loadtest.constructor.web;

import com.loadtest.constructor.config.AuthInterceptor;
import com.loadtest.constructor.persistence.ScriptEntity;
import com.loadtest.constructor.service.ScriptService;
import com.loadtest.constructor.web.dto.ScriptSummary;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@RestController
@RequestMapping("/api/scripts")
public class ScriptController {

    private final ScriptService scriptService;

    public ScriptController(ScriptService scriptService) {
        this.scriptService = scriptService;
    }

    @GetMapping
    public List<ScriptSummary> list(HttpServletRequest request) {
        String username = AuthInterceptor.requireAuth(request).username();
        return scriptService.listForUser(username);
    }

    @PostMapping("/upload")
    public ScriptSummary upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "engine", required = false) String engine,
            @RequestParam(value = "git_url", required = false) String gitUrl,
            HttpServletRequest request) throws IOException {
        String username = AuthInterceptor.requireAuth(request).username();
        return scriptService.upload(username, file, engine, gitUrl);
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<byte[]> download(@PathVariable UUID id, HttpServletRequest request) {
        String username = AuthInterceptor.requireAuth(request).username();
        ScriptEntity script = scriptService.requireContent(id, username);
        String filename = safeFilename(script.getFilename(), script.getEngine());
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(contentTypeFor(filename))
                .body(script.getContent());
    }

    /** Имя приходит от пользователя при upload — чистим, чтобы не сломать заголовок. */
    private static String safeFilename(String filename, String engine) {
        String base = filename == null ? "" : filename.replaceAll("[^a-zA-Z0-9._-]", "_");
        base = base.replaceAll("_+", "_").replaceAll("^_|_$", "");
        if (base.isBlank() || base.equals(".") || base.equals("..")) {
            return defaultFilename(engine);
        }
        String lower = base.toLowerCase(Locale.ROOT);
        if (!lower.endsWith(".jmx") && !lower.endsWith(".js") && !lower.endsWith(".ts")
                && !lower.endsWith(".zip")) {
            return base + ("k6".equalsIgnoreCase(engine) ? ".js" : ".jmx");
        }
        return base;
    }

    private static String defaultFilename(String engine) {
        return "k6".equalsIgnoreCase(engine) ? "scenario.js" : "scenario.jmx";
    }

    /**
     * .jmx — это XML, но отдавать его как application/xml нельзя: браузер приводит
     * расширение к MIME-типу и сохраняет файл как .xml. Для него нужен octet-stream.
     */
    private static MediaType contentTypeFor(String filename) {
        String lower = filename.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".zip")) {
            return MediaType.parseMediaType("application/zip");
        }
        if (lower.endsWith(".js") || lower.endsWith(".ts")) {
            return MediaType.parseMediaType("application/javascript");
        }
        return MediaType.APPLICATION_OCTET_STREAM;
    }
}
