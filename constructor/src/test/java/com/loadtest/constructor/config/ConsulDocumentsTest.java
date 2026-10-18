package com.loadtest.constructor.config;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConsulDocumentsTest {

    @Test
    void treeKeyLoadtestPostgres() {
        Map<String, String> entries = Map.of(
                "loadtest/postgres/url", "jdbc:postgresql://ump-pg-c01l.mbrd.ru:5432/loadtest_db",
                "loadtest/postgres/username", "loadtest_adm");

        assertEquals(
                "jdbc:postgresql://ump-pg-c01l.mbrd.ru:5432/loadtest_db",
                ConsulDocuments.property(entries, "loadtest.postgres.url").orElseThrow());
        assertEquals("loadtest_adm", ConsulDocuments.property(entries, "loadtest.postgres.username").orElseThrow());
    }

    @Test
    void keyUnderApplicationContext() {
        Map<String, String> entries = Map.of(
                "application/loadtest/postgres/url", "jdbc:postgresql://ump-pg-c01l.mbrd.ru:5432/loadtest_db");

        assertEquals(
                "jdbc:postgresql://ump-pg-c01l.mbrd.ru:5432/loadtest_db",
                ConsulDocuments.property(entries, "loadtest.postgres.url").orElseThrow());
    }

    @Test
    void yamlDocumentAtDataKey() {
        String yaml = """
                loadtest:
                  postgres:
                    username: loadtest_adm
                    url: jdbc:postgresql://ump-pg-c01l.mbrd.ru:5432/loadtest_db
                """;

        assertEquals(
                "jdbc:postgresql://ump-pg-c01l.mbrd.ru:5432/loadtest_db",
                ConsulDocuments.property(Map.of("application/data", yaml), "loadtest.postgres.url").orElseThrow());
        assertEquals(
                "loadtest_adm",
                ConsulDocuments.property(Map.of("data", yaml), "loadtest.postgres.username").orElseThrow());
    }

    private static final String AD_YAML = """
            ad:
                enabled: true
                url: ldaps://ldap.mbrd.ru:636
                base-dn: dc=mbrd,dc=ru
                user-dn-pattern:
                user-search-base: dc=mbrd,dc=ru
                user-search-filter: (sAMAccountName={0})
                bind-dn: CN=lt_master,OU=Service Accounts,OU=MSK,OU=MBRD,DC=mbrd,DC=ru
            """;

    @Test
    void adTreeInsideDocument() {
        Map<String, String> entries = Map.of("application/data", AD_YAML);

        assertEquals("true", ConsulDocuments.property(entries, "ad.enabled").orElseThrow());
        assertEquals("ldaps://ldap.mbrd.ru:636", ConsulDocuments.property(entries, "ad.url").orElseThrow());
        assertEquals("(sAMAccountName={0})", ConsulDocuments.property(entries, "ad.user-search-filter").orElseThrow());
        assertEquals(
                "CN=lt_master,OU=Service Accounts,OU=MSK,OU=MBRD,DC=mbrd,DC=ru",
                ConsulDocuments.property(entries, "ad.bind-dn").orElseThrow());
        assertTrue(ConsulDocuments.property(entries, "ad.user-dn-pattern").isEmpty());
    }

    @Test
    void adDocumentStoredUnderKeyAd() {
        Map<String, String> entries = Map.of("ad", """
                enabled: true
                url: ldaps://ldap.mbrd.ru:636
                """);

        assertEquals("true", ConsulDocuments.property(entries, "ad.enabled").orElseThrow());
        assertEquals("ldaps://ldap.mbrd.ru:636", ConsulDocuments.property(entries, "ad.url").orElseThrow());
    }

    @Test
    void adSeparateKeys() {
        Map<String, String> entries = Map.of(
                "ad/enabled", "true",
                "application/ad/base-dn", "dc=mbrd,dc=ru");

        assertEquals("true", ConsulDocuments.property(entries, "ad.enabled").orElseThrow());
        assertEquals("dc=mbrd,dc=ru", ConsulDocuments.property(entries, "ad.base-dn").orElseThrow());
    }

    @Test
    void relativeKeyStripsPrefix() {
        assertEquals("loadtest/postgres/url", ConsulKv.relative(
                "ump/loadtest-portal/loadtest/postgres/url", "ump/loadtest-portal/"));
        assertTrue(ConsulDocuments.property(Map.of(), "loadtest.postgres.url").isEmpty());
    }
}
