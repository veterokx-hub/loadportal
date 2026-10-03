package com.loadtest.constructor.service;

import com.loadtest.constructor.metrics.PortalMetrics;
import com.loadtest.constructor.persistence.ScriptEntity;
import com.loadtest.constructor.persistence.ScriptRepository;
import com.loadtest.constructor.web.dto.ScriptSummary;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/** Хранение артефактов (.jmx/.js): собранных порталом и загруженных вручную. */
@Service
public class ScriptService {

    /** Источник скрипта: собран порталом из сценария. */
    private static final String SOURCE_PORTAL_BUILD = "portal_build";

    /** Источник скрипта: загружен пользователем файлом. */
    private static final String SOURCE_UPLOAD = "upload";

    private final ScriptRepository scriptRepository;
    private final PortalMetrics metrics;

    public ScriptService(ScriptRepository scriptRepository, PortalMetrics metrics) {
        this.scriptRepository = scriptRepository;
        this.metrics = metrics;
    }

    @Transactional
    public ScriptEntity saveFromBuild(
            String username, UUID buildId, String engine, String filename, byte[] content) {
        ScriptEntity entity = new ScriptEntity(
                username, buildId, engine, filename, SOURCE_PORTAL_BUILD, "", content);
        scriptRepository.save(entity);
        metrics.recordScriptSaved(engine, SOURCE_PORTAL_BUILD, content == null ? 0 : content.length);
        return entity;
    }

    @Transactional
    public ScriptSummary upload(String username, MultipartFile file, String engine, String gitUrl)
            throws IOException {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Файл скрипта не выбран");
        }
        String eng = normalizeEngine(engine, file.getOriginalFilename());
        String filename = file.getOriginalFilename() == null ? "script" : file.getOriginalFilename();
        byte[] bytes = file.getBytes();
        ScriptEntity entity = new ScriptEntity(
                username,
                null,
                eng,
                filename,
                SOURCE_UPLOAD,
                gitUrl == null ? "" : gitUrl.trim(),
                bytes);
        scriptRepository.save(entity);
        metrics.recordScriptSaved(eng, SOURCE_UPLOAD, bytes.length);
        return toSummary(entity);
    }

    public List<ScriptSummary> listForUser(String username) {
        return scriptRepository.findAllProjectedByUsernameOrderByCreatedAtDesc(username).stream()
                .map(s -> new ScriptSummary(
                        s.getId().toString(),
                        s.getBuildId() != null ? s.getBuildId().toString() : null,
                        s.getEngine(),
                        s.getFilename(),
                        s.getSource(),
                        s.getGitUrl(),
                        DateTimeFormatter.ISO_INSTANT.format(s.getCreatedAt())))
                .toList();
    }

    public ScriptEntity requireOwned(UUID id, String username) {
        ScriptEntity entity = scriptRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Скрипт не найден"));
        if (!entity.getUsername().equalsIgnoreCase(username)) {
            throw new IllegalArgumentException("Нет доступа к этому скрипту");
        }
        return entity;
    }

    /** Артефакт для скачивания: ровно те байты, которые уйдут в прогон. */
    public ScriptEntity requireContent(UUID id, String username) {
        ScriptEntity entity = requireOwned(id, username);
        if (entity.getContent() == null || entity.getContent().length == 0) {
            throw new IllegalArgumentException("У скрипта нет сохранённого содержимого");
        }
        return entity;
    }

    public ScriptEntity findLatestForBuild(UUID buildId) {
        return scriptRepository.findFirstByBuildIdOrderByCreatedAtDesc(buildId).orElse(null);
    }

    private ScriptSummary toSummary(ScriptEntity e) {
        return new ScriptSummary(
                e.getId().toString(),
                e.getBuildId() != null ? e.getBuildId().toString() : null,
                e.getEngine(),
                e.getFilename(),
                e.getSource(),
                e.getGitUrl(),
                DateTimeFormatter.ISO_INSTANT.format(e.getCreatedAt()));
    }

    private static String normalizeEngine(String engine, String filename) {
        if (engine != null && !engine.isBlank()) {
            return engine.trim().toLowerCase(Locale.ROOT);
        }
        if (filename != null && filename.toLowerCase(Locale.ROOT).endsWith(".jmx")) {
            return "jmeter";
        }
        if (filename != null && (filename.toLowerCase(Locale.ROOT).endsWith(".js")
                || filename.toLowerCase(Locale.ROOT).endsWith(".ts"))) {
            return "k6";
        }
        if (filename != null && filename.toLowerCase(Locale.ROOT).endsWith(".java")) {
            return "gatling";
        }
        if (filename != null && filename.toLowerCase(Locale.ROOT).endsWith(".zip")) {
            throw new IllegalArgumentException(
                    "Для .zip укажите движок явно: jmeter, k6 или gatling");
        }
        throw new IllegalArgumentException(
                "Укажите движок (jmeter/k6/gatling) или расширение .jmx/.js/.java");
    }
}
