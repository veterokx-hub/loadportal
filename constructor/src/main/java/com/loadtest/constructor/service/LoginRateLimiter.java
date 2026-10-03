package com.loadtest.constructor.service;

import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;

/** In-memory lockout логина: 8 неудач / 15 минут на пару логин+IP. */
@Component
public class LoginRateLimiter {

    private static final int MAX_FAILURES = 8;
    private static final long WINDOW_MS = 15 * 60 * 1000L;

    private final ConcurrentHashMap<String, Slot> slots = new ConcurrentHashMap<>();

    public void assertAllowed(String username, String ip) {
        Slot slot = slots.get(key(username, ip));
        if (slot == null) {
            return;
        }
        long now = System.currentTimeMillis();
        if (now - slot.windowStart > WINDOW_MS) {
            slots.remove(key(username, ip), slot);
            return;
        }
        if (slot.failures >= MAX_FAILURES) {
            throw new IllegalArgumentException("Слишком много попыток, подождите");
        }
    }

    public void recordFailure(String username, String ip) {
        String k = key(username, ip);
        slots.compute(k, (ignored, prev) -> {
            long now = System.currentTimeMillis();
            if (prev == null || now - prev.windowStart > WINDOW_MS) {
                return new Slot(now, 1);
            }
            return new Slot(prev.windowStart, prev.failures + 1);
        });
    }

    public void recordSuccess(String username, String ip) {
        slots.remove(key(username, ip));
    }

    private static String key(String username, String ip) {
        String user = username == null ? "" : username.trim().toLowerCase();
        String addr = ip == null ? "" : ip;
        return user + "|" + addr;
    }

    private record Slot(long windowStart, int failures) {
    }
}
