package com.loadtest.constructor.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.loadtest.constructor.model.Scenario;
import com.loadtest.constructor.persistence.ScenarioEntity;
import com.loadtest.constructor.persistence.ScenarioRepository;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

@Service
public class ScenarioService {

    private final ScenarioRepository repository;
    private final ObjectMapper objectMapper;

    public ScenarioService(ScenarioRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    public ScenarioEntity save(UUID projectId, Scenario scenario) {
        int nextVersion = repository.countByProjectId(projectId) + 1;
        ScenarioEntity entity = new ScenarioEntity(projectId, scenario.name(), nextVersion, toJson(scenario));
        return repository.save(entity);
    }

    public Scenario loadScenario(UUID scenarioId) {
        ScenarioEntity entity = repository.findById(scenarioId)
                .orElseThrow(() -> new IllegalArgumentException("Сценарий не найден: " + scenarioId));
        return fromJson(entity.getDataJson());
    }

    public List<ScenarioEntity> listByProject(UUID projectId) {
        return repository.findByProjectIdOrderByVersionDesc(projectId);
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
