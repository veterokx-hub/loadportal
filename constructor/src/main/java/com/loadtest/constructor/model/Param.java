package com.loadtest.constructor.model;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record Param(
        String name,
        ParamLocation location,
        ParamSource source,
        String schemaType,
        String example,
        boolean required
) {}
