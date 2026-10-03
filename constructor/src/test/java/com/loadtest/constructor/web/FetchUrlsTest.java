package com.loadtest.constructor.web;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class FetchUrlsTest {

    @Test
    void blankIsIgnored() {
        assertDoesNotThrow(() -> FetchUrls.requireHttpUrl(null));
        assertDoesNotThrow(() -> FetchUrls.requireHttpUrl("  "));
    }

    @Test
    void httpAndHttpsPass() {
        assertDoesNotThrow(() -> FetchUrls.requireHttpUrl("https://api.example/v1"));
        assertDoesNotThrow(() -> FetchUrls.requireHttpUrl("  http://10.0.0.5:8080/spec  "));
    }

    @Test
    void otherSchemesAndMissingHostFail() {
        assertThrows(IllegalArgumentException.class, () -> FetchUrls.requireHttpUrl("javascript:alert(1)"));
        assertThrows(IllegalArgumentException.class, () -> FetchUrls.requireHttpUrl("ftp://files.example/a"));
        assertThrows(IllegalArgumentException.class, () -> FetchUrls.requireHttpUrl("http://"));
        assertThrows(IllegalArgumentException.class, () -> FetchUrls.requireHttpUrl("not a url"));
    }
}
