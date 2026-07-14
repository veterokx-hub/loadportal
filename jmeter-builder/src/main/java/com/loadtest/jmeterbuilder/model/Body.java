package com.loadtest.jmeterbuilder.model;

public record Body(
        BodyMode mode,
        String contentType,
        String content
) {
    public static Body none() {
        return new Body(BodyMode.NONE, null, "");
    }
}
