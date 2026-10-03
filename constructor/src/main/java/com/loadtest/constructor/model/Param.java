package com.loadtest.constructor.model;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record Param(
        String name,
        ParamLocation location,
        ParamSource source,
        String schemaType,
        String example,
        boolean required,
        boolean quoted
) {
    public Param(String name, ParamLocation location, ParamSource source,
                 String schemaType, String example, boolean required) {
        this(name, location, source, schemaType, example, required, false);
    }
}
