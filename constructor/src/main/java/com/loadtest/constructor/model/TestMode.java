package com.loadtest.constructor.model;

import com.fasterxml.jackson.annotation.JsonValue;

public enum TestMode {
    RAMP_HOLD("ramp_hold"),
    MAX_SEARCH("max_search");

    private final String value;

    TestMode(String value) {
        this.value = value;
    }

    @JsonValue
    public String value() {
        return value;
    }
}
