package com.loadtest.constructor.model;

/** Проверки ответа: код (всегда) и опциональная подстрока в теле (Response Assertion Contains). */
public record Validation(
        boolean checkResponseCode,
        int expectedStatus,
        String responseContains
) {
    public static Validation defaults() {
        return new Validation(true, 200, "");
    }
}
