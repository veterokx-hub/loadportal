package com.loadtest.constructor.model;

public record Extraction(
        String variable,
        ExtractionType type,
        String expression,
        int matchNo,
        String defaultValue
) {}
