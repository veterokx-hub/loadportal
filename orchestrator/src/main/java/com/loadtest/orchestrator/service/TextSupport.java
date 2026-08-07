package com.loadtest.orchestrator.service;

/** Строковые хелперы без зависимости от Spring. */
final class TextSupport {

    private TextSupport() {
    }

    static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    static String firstNonBlank(String... values) {
        if (values == null) {
            return "";
        }
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value.trim();
            }
        }
        return "";
    }

    static String requireNonBlank(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Укажите " + field);
        }
        return value.trim();
    }

    static String stripFilename(String path) {
        if (path == null || path.isBlank()) {
            return "script";
        }
        int slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
        return slash >= 0 ? path.substring(slash + 1) : path;
    }

    static String truncate(String value, int max) {
        if (value == null) {
            return "";
        }
        return value.length() <= max ? value : value.substring(0, max);
    }
}
