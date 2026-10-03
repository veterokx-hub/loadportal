package com.loadtest.jmeterbuilder.model;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record Generator(
        GeneratorType type,
        Integer min,
        Integer max,
        Integer length,
        String chars,
        Integer start,
        String format,
        Integer increment
) {
    public Generator(
            GeneratorType type,
            Integer min,
            Integer max,
            Integer length,
            String chars,
            Integer start,
            String format) {
        this(type, min, max, length, chars, start, format, null);
    }
}
