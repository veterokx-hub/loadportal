package com.loadtest.jmeterbuilder.model;

import com.fasterxml.jackson.annotation.JsonValue;

public enum SourceType {
    OPENAPI("openapi"),
    POSTMAN("postman");

    private final String value;

    SourceType(String value) {
        this.value = value;
    }

    @JsonValue
    public String value() {
        return value;
    }
}
