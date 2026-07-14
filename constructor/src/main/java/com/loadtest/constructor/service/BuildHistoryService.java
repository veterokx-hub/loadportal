package com.loadtest.constructor.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.loadtest.constructor.model.Scenario;
import com.loadtest.constructor.persistence.BuildRecordEntity;
import com.loadtest.constructor.persistence.BuildRecordRepository;
import com.loadtest.constructor.web.dto.BuildRecordSummary;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class BuildHistoryService {

    public static final int MAX_BUILDS_PER_USER = 20;

    private final BuildRecordRepository repository;
    private final ObjectMapper objectMapper;

    public BuildHistoryService(BuildRecordRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
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
        BuildRecordEntity entity = repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Сборка не найдена: " + id));
        if (!entity.getUsername().equalsIgnoreCase(username)) {
            throw new IllegalArgumentException("Нет доступа к этой сборке");
        }
        return fromJson(entity.getScenarioJson());
    }

    private void trimForUser(String username) {
        List<BuildRecordEntity> all = repository.findByUsernameOrderByCreatedAtDesc(username);
        if (all.size() <= MAX_BUILDS_PER_USER) {
            return;
        }
        List<UUID> excess = all.subList(MAX_BUILDS_PER_USER, all.size()).stream()
                .map(BuildRecordEntity::getId)
                .toList();
        repository.deleteByIdIn(excess);
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
