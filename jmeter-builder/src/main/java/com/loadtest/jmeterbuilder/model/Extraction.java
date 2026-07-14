package com.loadtest.jmeterbuilder.model;

public record Extraction(
        String variable,
        ExtractionType type,
        String expression,
        int matchNo,
        String defaultValue
) {}
