package com.loadtest.orchestrator.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class TextSupportTest {

    @Test
    void blanksAndFirstValue() {
        assertEquals("", TextSupport.nullToEmpty(null));
        assertEquals("a", TextSupport.nullToEmpty("a"));
        assertEquals("keep", TextSupport.firstNonBlank(null, "  ", " keep "));
        assertEquals("", TextSupport.firstNonBlank());
    }

    @Test
    void requireNonBlankTrims() {
        assertEquals("name", TextSupport.requireNonBlank(" name ", "имя"));
        assertThrows(IllegalArgumentException.class, () -> TextSupport.requireNonBlank("  ", "имя"));
    }

    @Test
    void filenameAndTruncate() {
        assertEquals("script", TextSupport.stripFilename(null));
        assertEquals("script", TextSupport.stripFilename("  "));
        assertEquals("c.txt", TextSupport.stripFilename("a/b/c.txt"));
        assertEquals("c.txt", TextSupport.stripFilename("a\\b\\c.txt"));
        assertEquals("", TextSupport.truncate(null, 2));
        assertEquals("ab", TextSupport.truncate("abcd", 2));
        assertEquals("ab", TextSupport.truncate("ab", 5));
    }
}
