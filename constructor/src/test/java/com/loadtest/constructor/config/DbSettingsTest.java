package com.loadtest.constructor.config;

import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;

class DbSettingsTest {

    @Test
    void consulAndVaultWin() {
        DbSettings settings = DbSettings.resolve(
                Optional.of(" jdbc:consul "),
                "jdbc:env",
                "jdbc:yaml",
                "jdbc:default",
                Optional.of("consul-user"),
                "env-user",
                "yaml-user",
                "default-user",
                Optional.of("vault-pass"),
                "default-pass");

        assertEquals("jdbc:consul", settings.url());
        assertEquals("consul-user", settings.username());
        assertEquals("vault-pass", settings.password());
    }

    @Test
    void envWinsOverConfigWhenConsulIsOff() {
        DbSettings settings = DbSettings.resolve(
                Optional.empty(),
                "jdbc:env",
                "jdbc:yaml",
                "jdbc:default",
                Optional.empty(),
                "env-user",
                "yaml-user",
                "default-user",
                Optional.empty(),
                "default-pass");

        assertEquals("jdbc:env", settings.url());
        assertEquals("env-user", settings.username());
        assertEquals("default-pass", settings.password());
    }

    @Test
    void configThenSpringDefault() {
        DbSettings settings = DbSettings.resolve(
                Optional.of("  "),
                "",
                "jdbc:yaml",
                "jdbc:default",
                Optional.empty(),
                null,
                "yaml-user",
                "default-user",
                Optional.empty(),
                "loadtest");

        assertEquals("jdbc:yaml", settings.url());
        assertEquals("yaml-user", settings.username());
        assertEquals("loadtest", settings.password());
    }
}
