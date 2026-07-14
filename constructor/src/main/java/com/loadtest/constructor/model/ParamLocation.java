package com.loadtest.constructor.model;

import com.fasterxml.jackson.annotation.JsonValue;

public enum ParamLocation {
    PATH("path"),
    QUERY("query"),
    HEADER("header"),
    BODY("body");

    private final String value;

    ParamLocation(String value) {
        this.value = value;
    }

    @JsonValue
    public String value() {
        return value;
    }
}
