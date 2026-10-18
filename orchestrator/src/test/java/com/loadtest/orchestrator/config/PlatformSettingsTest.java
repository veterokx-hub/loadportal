package com.loadtest.orchestrator.config;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PlatformSettingsTest {

    @Test
    void corporateConfigMapFillsDiscovery() {
        Map<String, String> raw = new HashMap<>();
        raw.put("discovery.consul.enabled", "true");
        raw.put("consul_host", "consul-ump-test.mbrd.ru:8081");
        raw.put("consul_config_path", "ump");
        raw.put("consul_config_acl_token", "acl-fallback");
        raw.put("spring.cloud.consul.host", "consul-ump-test.mbrd.ru");
        raw.put("spring.cloud.consul.port", "8081");
        raw.put("spring.cloud.consul.config.prefix", "ump/loadtest-portal");
        raw.put("spring.cloud.consul.config.acl-token", "acl-main");
        raw.put("spring.cloud.vault.uri", "http://vault-ump-test.mbrd.ru:8081");
        raw.put("spring.cloud.vault.kv.backend", "load-producer");
        raw.put("vault_role_id", "role-fallback");
        raw.put("spring.cloud.vault.app-role.role-id", "role-main");
        raw.put("spring.cloud.vault.app-role.secret-id", "secret-main");

        Map<String, Object> overlay = PlatformSettings.overlay(raw::get);

        assertEquals("true", overlay.get("loadtest.discovery.consul.enabled"));
        assertEquals("consul-ump-test.mbrd.ru", overlay.get("loadtest.discovery.consul.host"));
        assertEquals("8081", overlay.get("loadtest.discovery.consul.port"));
        assertEquals("ump/loadtest-portal/", overlay.get("loadtest.discovery.consul.kv-prefix"));
        assertEquals("acl-main", overlay.get("loadtest.discovery.consul.acl-token"));
        assertEquals("true", overlay.get("loadtest.discovery.vault.enabled"));
        assertEquals("http://vault-ump-test.mbrd.ru:8081", overlay.get("loadtest.discovery.vault.address"));
        assertEquals("load-producer", overlay.get("loadtest.discovery.vault.kv-path"));
        assertEquals("role-main", overlay.get("loadtest.discovery.vault.role-id"));
        assertEquals("secret-main", overlay.get("loadtest.discovery.vault.secret-id"));
    }

    @Test
    void blankFileLeavesYamlUntouched() {
        assertTrue(PlatformSettings.overlay(key -> "").isEmpty());
        assertTrue(PlatformSettings.overlay(key -> null).isEmpty());
    }

    @Test
    void gluedHostIsFallback() {
        Map<String, Object> overlay = PlatformSettings.overlay(key ->
                "consul_host".equals(key) ? "consul-ump-test.mbrd.ru:8081" : null);

        assertEquals("consul-ump-test.mbrd.ru", overlay.get("loadtest.discovery.consul.host"));
        assertEquals("8081", overlay.get("loadtest.discovery.consul.port"));
        assertEquals("true", overlay.get("loadtest.discovery.consul.enabled"));
    }

    @Test
    void explicitDisableStaysOff() {
        Map<String, String> raw = Map.of(
                "discovery.consul.enabled", "\"false\"",
                "spring.cloud.consul.host", "consul-ump-test.mbrd.ru");

        Map<String, Object> overlay = PlatformSettings.overlay(raw::get);

        assertEquals("false", overlay.get("loadtest.discovery.consul.enabled"));
        assertFalse(overlay.containsKey("loadtest.discovery.vault.enabled"));
    }

    @Test
    void shortVaultKeysWhenSpringOnesMissing() {
        Map<String, String> raw = Map.of(
                "vault_uri", "http://vault-ump-test.mbrd.ru:8081/",
                "vault_config_path", "load-producer",
                "vault_role_id", "role",
                "vault_secret_id", "secret");

        Map<String, Object> overlay = PlatformSettings.overlay(raw::get);

        assertEquals("http://vault-ump-test.mbrd.ru:8081/", overlay.get("loadtest.discovery.vault.address"));
        assertEquals("load-producer", overlay.get("loadtest.discovery.vault.kv-path"));
        assertEquals("role", overlay.get("loadtest.discovery.vault.role-id"));
        assertEquals("secret", overlay.get("loadtest.discovery.vault.secret-id"));
    }
}
