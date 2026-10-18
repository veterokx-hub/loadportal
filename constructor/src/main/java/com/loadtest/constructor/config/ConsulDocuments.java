package com.loadtest.constructor.config;

import org.yaml.snakeyaml.Yaml;

import java.io.StringReader;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;

/** Ключ {@code loadtest/postgres/url} или тот же путь внутри YAML/properties документа. */
final class ConsulDocuments {

    private ConsulDocuments() {
    }

    static Optional<String> property(Map<String, String> entries, String dotted) {
        if (entries == null || entries.isEmpty() || dotted == null || dotted.isBlank()) {
            return Optional.empty();
        }
        String slash = dotted.replace('.', '/');
        String exact = firstNonBlank(entries.get(slash), entries.get(dotted));
        if (exact != null) {
            return Optional.of(exact);
        }
        String suffix = "/" + slash;
        String bestKey = null;
        String best = null;
        for (Map.Entry<String, String> entry : entries.entrySet()) {
            String key = entry.getKey();
            if (key == null || (!key.equals(slash) && !key.endsWith(suffix))) {
                continue;
            }
            String value = blankToNull(entry.getValue());
            if (value == null) {
                continue;
            }
            if (bestKey == null || key.length() < bestKey.length()) {
                bestKey = key;
                best = value;
            }
        }
        if (best != null) {
            return Optional.of(best);
        }
        for (Map.Entry<String, String> entry : entries.entrySet()) {
            String rest = restUnderKey(entry.getKey(), dotted);
            if (rest == null) {
                continue;
            }
            Optional<String> fromDocument = documentProperty(entry.getValue(), rest);
            if (fromDocument.isPresent()) {
                return fromDocument;
            }
        }
        for (String value : entries.values()) {
            Optional<String> fromDocument = documentProperty(value, dotted);
            if (fromDocument.isPresent()) {
                return fromDocument;
            }
        }
        return Optional.empty();
    }

    private static Optional<String> documentProperty(String text, String dotted) {
        String trimmed = blankToNull(text);
        if (trimmed == null || !trimmed.contains(dotted.substring(0, rootLength(dotted)))) {
            return Optional.empty();
        }
        if (trimmed.contains("=")) {
            String fromProperties = propertiesValue(trimmed, dotted);
            if (fromProperties != null) {
                return Optional.of(fromProperties);
            }
        }
        if (trimmed.contains(":")) {
            String fromYaml = yamlValue(trimmed, dotted);
            if (fromYaml != null) {
                return Optional.of(fromYaml);
            }
        }
        return Optional.empty();
    }

    /**
     * Ключ {@code ad} (или {@code application/ad}) с YAML внутри и свойство {@code ad.enabled}
     * дают {@code enabled}. Ключ, не являющийся началом свойства, — null.
     */
    private static String restUnderKey(String key, String dotted) {
        if (key == null || key.isBlank()) {
            return null;
        }
        String[] segments = key.replaceAll("^/+|/+$", "").split("/");
        for (int start = 0; start < segments.length; start++) {
            String head = String.join(".", java.util.Arrays.copyOfRange(segments, start, segments.length));
            if (!head.isEmpty() && dotted.startsWith(head + ".")) {
                return dotted.substring(head.length() + 1);
            }
        }
        return null;
    }

    private static int rootLength(String dotted) {
        int dot = dotted.indexOf('.');
        return dot < 0 ? dotted.length() : dot;
    }

    private static String propertiesValue(String text, String dotted) {
        Properties properties = new Properties();
        try {
            properties.load(new StringReader(text));
        } catch (java.io.IOException ex) {
            return null;
        }
        return blankToNull(properties.getProperty(dotted));
    }

    private static String yamlValue(String text, String dotted) {
        try {
            Object loaded = new Yaml().load(text);
            Object cursor = loaded;
            for (String part : dotted.split("\\.")) {
                if (!(cursor instanceof Map<?, ?> map)) {
                    return null;
                }
                cursor = map.get(part);
                if (cursor == null) {
                    return null;
                }
            }
            if (cursor instanceof Map<?, ?> || cursor instanceof Iterable<?>) {
                return null;
            }
            return blankToNull(cursor.toString());
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private static String firstNonBlank(String primary, String fallback) {
        String value = blankToNull(primary);
        return value != null ? value : blankToNull(fallback);
    }

    private static String blankToNull(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim();
    }
}
