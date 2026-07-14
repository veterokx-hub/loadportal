package com.loadtest.jmeterbuilder.model;

import com.fasterxml.jackson.annotation.JsonValue;

public enum GeneratorType {
    UUID("uuid"),
    RANDOM_INT("randomInt"),
    RANDOM_STRING("randomString"),
    COUNTER("counter"),
    TIMESTAMP("timestamp");

    private final String value;

    GeneratorType(String value) {
        this.value = value;
    }

    @JsonValue
    public String value() {
        return value;
    }
}
