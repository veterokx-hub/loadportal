package com.loadtest.orchestrator.config;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;

/**
 * Плоский ConfigMap ({@code spring.cloud.*} и короткие дубли) → {@code loadtest.discovery.*}.
 * Пустые значения не затирают yaml.
 */
final class PlatformSettings {

    private PlatformSettings() {
    }

    static Map<String, Object> overlay(Function<String, String> property) {
        Map<String, Object> map = new LinkedHashMap<>();
        String enabled = value(property, "discovery.consul.enabled");
        String host = value(property, "spring.cloud.consul.host");
        String port = value(property, "spring.cloud.consul.port");
        if (host == null) {
            String[] glued = splitHost(value(property, "consul_host"));
            host = glued[0];
            if (port == null) {
                port = glued[1];
            }
        }
        if (enabled != null) {
            map.put("loadtest.discovery.consul.enabled", enabled);
        } else if (host != null) {
            map.put("loadtest.discovery.consul.enabled", "true");
        }
        if (host != null) {
            map.put("loadtest.discovery.consul.host", host);
        }
        if (port != null) {
            map.put("loadtest.discovery.consul.port", port);
        }
        String prefix = first(property, "spring.cloud.consul.config.prefix", "consul_config_path");
        if (prefix != null) {
            map.put("loadtest.discovery.consul.kv-prefix", prefix.endsWith("/") ? prefix : prefix + "/");
        }
        String acl = first(property, "spring.cloud.consul.config.acl-token", "consul_config_acl_token");
        if (acl != null) {
            map.put("loadtest.discovery.consul.acl-token", acl);
        }
        String uri = first(property, "spring.cloud.vault.uri", "vault_uri");
        if (uri != null) {
            map.put("loadtest.discovery.vault.address", uri);
            map.put("loadtest.discovery.vault.enabled", "true");
        }
        String backend = first(property, "spring.cloud.vault.kv.backend", "vault_config_path");
        if (backend != null) {
            map.put("loadtest.discovery.vault.kv-path", backend);
        }
        String role = first(property, "spring.cloud.vault.app-role.role-id", "vault_role_id");
        if (role != null) {
            map.put("loadtest.discovery.vault.role-id", role);
        }
        String secret = first(property, "spring.cloud.vault.app-role.secret-id", "vault_secret_id");
        if (secret != null) {
            map.put("loadtest.discovery.vault.secret-id", secret);
        }
        return map;
    }

    private static String first(Function<String, String> property, String primary, String fallback) {
        String value = value(property, primary);
        return value != null ? value : value(property, fallback);
    }

    private static String value(Function<String, String> property, String key) {
        String raw = property.apply(key);
        if (raw == null) {
            return null;
        }
        String trimmed = unquote(raw.trim());
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String unquote(String value) {
        if (value.length() >= 2) {
            char quote = value.charAt(0);
            if ((quote == '"' || quote == '\'') && value.charAt(value.length() - 1) == quote) {
                return value.substring(1, value.length() - 1).trim();
            }
        }
        return value;
    }

    /** {@code host:port}, если после последнего двоеточия число. Иначе вся строка — host. */
    private static String[] splitHost(String glued) {
        if (glued == null) {
            return new String[] {null, null};
        }
        int colon = glued.lastIndexOf(':');
        if (colon > 0 && glued.substring(colon + 1).chars().allMatch(Character::isDigit)) {
            return new String[] {glued.substring(0, colon), glued.substring(colon + 1)};
        }
        return new String[] {glued, null};
    }
}
