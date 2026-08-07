package com.loadtest.orchestrator.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/** Общий JSON read/write с безопасными fallback и DEBUG-логом. */
@Component
public class JsonSupport {

    private static final Logger log = LoggerFactory.getLogger(JsonSupport.class);

    private final ObjectMapper objectMapper;

    public JsonSupport(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> readMap(String json) {
        return read(json, new TypeReference<>() {}, Map.of());
    }

    public Map<String, String> readStringMap(String json) {
        return read(json, new TypeReference<>() {}, Map.of());
    }

    public <T> List<T> readList(String json, TypeReference<List<T>> type) {
        return read(json, type, List.of());
    }

    public String write(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException ex) {
            log.debug("JSON write failed: {}", ex.getMessage());
            return "{}";
        }
    }

    public ObjectMapper mapper() {
        return objectMapper;
    }

    private <T> T read(String json, TypeReference<T> type, T fallback) {
        if (json == null || json.isBlank()) {
            return fallback;
        }
        try {
            return objectMapper.readValue(json, type);
        } catch (JsonProcessingException ex) {
            log.debug("JSON parse failed: {}", ex.getMessage());
            return fallback;
        }
    }
}
