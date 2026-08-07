package com.loadtest.orchestrator.service;

import com.loadtest.orchestrator.persistence.ScriptEntity;
import com.loadtest.orchestrator.persistence.ScriptRepository;
import org.springframework.stereotype.Service;

import java.util.UUID;

/** Чтение скриптов из общей БД (запись — в constructor). */
@Service
public class ScriptService {

    private final ScriptRepository scriptRepository;

    public ScriptService(ScriptRepository scriptRepository) {
        this.scriptRepository = scriptRepository;
    }

    public ScriptEntity requireOwned(UUID id, String username) {
        ScriptEntity entity = scriptRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Скрипт не найден"));
        if (!entity.getUsername().equalsIgnoreCase(username)) {
            throw new IllegalArgumentException("Нет доступа к этому скрипту");
        }
        return entity;
    }

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
}
