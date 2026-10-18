package com.loadtest.orchestrator.secrets;

import tools.jackson.databind.JsonNode;

/** Поле секрета: {@code value}, остаток пути или вложенный {@code loadtest.postgres.password}. */
final class VaultFields {

    private VaultFields() {
    }

    static String fromSecret(JsonNode data, String remainder, String fullDotted) {
        if (data == null || !data.isObject()) {
            return null;
        }
        if (remainder == null || remainder.isEmpty()) {
            String legacy = legacy(data);
            if (legacy != null) {
                return legacy;
            }
            return pick(data, fullDotted);
        }
        String named = pick(data, remainder);
        if (named != null) {
            return named;
        }
        if (fullDotted != null && !fullDotted.equals(remainder)) {
            return pick(data, fullDotted);
        }
        return null;
    }

    /** Точный путь секрета: поле value, иначе единственное скалярное поле. */
    private static String legacy(JsonNode data) {
        String value = scalar(data.get("value"));
        if (value != null) {
            return value;
        }
        String only = null;
        int scalars = 0;
        for (var entry : data.properties()) {
            String field = scalar(entry.getValue());
            if (field == null) {
                continue;
            }
            scalars++;
            only = field;
        }
        return scalars == 1 ? only : null;
    }

    private static String pick(JsonNode data, String dotted) {
        if (data == null || dotted == null || dotted.isEmpty()) {
            return null;
        }
        String direct = scalar(data.get(dotted));
        if (direct != null) {
            return direct;
        }
        JsonNode node = data;
        for (String part : dotted.split("\\.")) {
            if (node == null || !node.isObject()) {
                return null;
            }
            node = node.get(part);
        }
        return scalar(node);
    }

    private static String scalar(JsonNode node) {
        if (node == null || node.isNull() || node.isObject() || node.isArray()) {
            return null;
        }
        String value = node.asString("");
        return value.isBlank() ? null : value.trim();
    }
}
