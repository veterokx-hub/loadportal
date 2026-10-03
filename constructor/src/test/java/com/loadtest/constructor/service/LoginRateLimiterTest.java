package com.loadtest.constructor.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class LoginRateLimiterTest {

    @Test
    void locksAfterEightFailuresOnSameUserAndIp() {
        var limiter = new LoginRateLimiter();
        for (int i = 0; i < 7; i++) {
            limiter.recordFailure("Alice", "10.0.0.1");
        }
        assertDoesNotThrow(() -> limiter.assertAllowed("alice", "10.0.0.1"));

        limiter.recordFailure("alice", "10.0.0.1");
        assertThrows(IllegalArgumentException.class, () -> limiter.assertAllowed(" ALICE ", "10.0.0.1"));
        assertDoesNotThrow(() -> limiter.assertAllowed("alice", "10.0.0.2"));
        assertDoesNotThrow(() -> limiter.assertAllowed("bob", "10.0.0.1"));
    }

    @Test
    void successClearsTheWindow() {
        var limiter = new LoginRateLimiter();
        for (int i = 0; i < 8; i++) {
            limiter.recordFailure("alice", "10.0.0.1");
        }
        limiter.recordSuccess("Alice", "10.0.0.1");
        assertDoesNotThrow(() -> limiter.assertAllowed("alice", "10.0.0.1"));
    }
}
