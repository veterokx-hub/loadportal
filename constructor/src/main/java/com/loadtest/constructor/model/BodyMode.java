package com.loadtest.constructor.model;

import com.fasterxml.jackson.annotation.JsonValue;

public enum BodyMode {
    NONE("none"),
    RAW("raw"),
    JSON("json"),
    FORM("form");

    private final String value;

    BodyMode(String value) {
        this.value = value;
    }

    @JsonValue
    public String value() {
        return value;
    }
}
