package com.loadtest.jmeterbuilder.model;

import com.fasterxml.jackson.annotation.JsonValue;

public enum ExtractionType {
    JSON("json"),
    REGEX("regex"),
    BOUNDARY("boundary");

    private final String value;

    ExtractionType(String value) {
        this.value = value;
    }

    @JsonValue
    public String value() {
        return value;
    }
}
