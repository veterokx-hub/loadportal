package com.loadtest.constructor.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.loadtest.constructor.model.Scenario;
import com.loadtest.constructor.persistence.BuildRecordEntity;
import com.loadtest.constructor.persistence.BuildRecordRepository;
import com.loadtest.constructor.persistence.ScriptRepository;
import com.loadtest.constructor.web.dto.BuildRecordSummary;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class BuildHistoryService {

    private static final Logger log = LoggerFactory.getLogger(BuildHistoryService.class);

    public static final int MAX_BUILDS_PER_USER = 30;

    private final BuildRecordRepository repository;
    private final ScriptRepository scriptRepository;
    private final ObjectMapper objectMapper;
    private final int retentionDays;

    public BuildHistoryService(
            BuildRecordRepository repository,
            ScriptRepository scriptRepository,
            ObjectMapper objectMapper,
            @Value("${loadtest.builds.retention-days:30}") int retentionDays) {
        this.repository = repository;
        this.scriptRepository = scriptRepository;
        this.objectMapper = objectMapper;
        this.retentionDays = Math.max(1, retentionDays);
    }

    @Transactional
    public BuildRecordEntity record(String username, Scenario scenario, String engine, String filename) {
        String user = username == null || username.isBlank() ? "anonymous" : username.trim();
        BuildRecordEntity entity = new BuildRecordEntity(
                user,
                scenario.name() != null ? scenario.name() : "scenario",
                engine,
                filename,
                toJson(scenario)
        );
        repository.save(entity);
        trimForUser(user);
        return entity;
    }

    public List<BuildRecordSummary> listForUser(String username) {
        String user = username == null || username.isBlank() ? "anonymous" : username.trim();
        return repository.findSummariesByUsername(user, PageRequest.of(0, MAX_BUILDS_PER_USER));
    }

    public Scenario loadScenario(UUID id, String username) {
        BuildRecordEntity entity = requireOwnedOrAdmin(id, username, false);
        return fromJson(entity.getScenarioJson());
    }

    @Transactional
    public void delete(UUID id, String username, boolean admin) {
        BuildRecordEntity entity = requireOwnedOrAdmin(id, username, admin);
        deleteBuildsWithScripts(List.of(entity.getId()));
    }

    /**
     * Удаляет сборки старше retention (и связанные portal_build скрипты).
     *
     * @return число удалённых сборок
     */
    @Transactional
    public int purgeExpired() {
        Instant cutoff = Instant.now().minusSeconds(retentionDays * 24L * 3600L);
        List<UUID> ids = repository.findIdsByCreatedAtBefore(cutoff);
        if (!ids.isEmpty()) {
            deleteBuildsWithScripts(ids);
            log.info("Purged {} build(s) older than {} days (before {})", ids.size(), retentionDays, cutoff);
        }
        int orphans = scriptRepository.deleteOrphanBuildScripts();
        if (orphans > 0) {
            log.info("Purged {} orphan script(s) without build_records", orphans);
        }
        return ids.size();
    }

    public int retentionDays() {
        return retentionDays;
    }

    private BuildRecordEntity requireOwnedOrAdmin(UUID id, String username, boolean admin) {
        BuildRecordEntity entity = repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Сборка не найдена: " + id));
        if (!admin && !entity.getUsername().equalsIgnoreCase(username)) {
            throw new IllegalArgumentException("Нет доступа к этой сборке");
        }
        return entity;
    }

    private void trimForUser(String username) {
        List<BuildRecordEntity> all = repository.findByUsernameOrderByCreatedAtDesc(username);
        if (all.size() <= MAX_BUILDS_PER_USER) {
            return;
        }
        List<UUID> excess = all.subList(MAX_BUILDS_PER_USER, all.size()).stream()
                .map(BuildRecordEntity::getId)
                .toList();
        deleteBuildsWithScripts(excess);
    }

    private void deleteBuildsWithScripts(List<UUID> buildIds) {
        if (buildIds == null || buildIds.isEmpty()) {
            return;
        }
        scriptRepository.deleteByBuildIdIn(buildIds);
        repository.deleteByIdIn(buildIds);
    }

    private String toJson(Scenario scenario) {
        try {
            return objectMapper.writeValueAsString(scenario);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Не удалось сериализовать сценарий", e);
        }
    }

    private Scenario fromJson(String json) {
        try {
            return objectMapper.readValue(json, Scenario.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Не удалось десериализовать сценарий", e);
        }
    }
}
