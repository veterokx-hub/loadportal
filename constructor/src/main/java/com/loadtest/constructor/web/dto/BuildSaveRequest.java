package com.loadtest.constructor.web.dto;

public record BuildSaveRequest(
        com.loadtest.constructor.model.Scenario scenario,
        String engine
) {
}
