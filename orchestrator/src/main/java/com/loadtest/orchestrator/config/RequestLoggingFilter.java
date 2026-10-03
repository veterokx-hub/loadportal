package com.loadtest.orchestrator.config;

import com.loadtest.orchestrator.security.AuthContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class RequestLoggingFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RequestLoggingFilter.class);
    private static final Pattern RUN_PATH = Pattern.compile("/api/runs/([0-9a-fA-F-]{36})");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        long start = System.currentTimeMillis();
        String runId = extractRunId(request);
        if (runId != null) {
            MDC.put("run_id", runId);
        }
        Object authAttr = request.getAttribute(AuthInterceptor.ATTR_AUTH);
        if (authAttr instanceof AuthContext ctx) {
            MDC.put("username", ctx.username());
        }
        try {
            chain.doFilter(request, response);
        } finally {
            long ms = System.currentTimeMillis() - start;
            if (!isHealthPath(request.getRequestURI())) {
                int status = response.getStatus();
                if (status >= 400) {
                    log.info("{} {} -> {} ({} ms) origin={} host={} auth={}",
                            request.getMethod(), request.getRequestURI(), status, ms,
                            request.getHeader("Origin"), request.getHeader("Host"),
                            request.getHeader("Authorization") != null ? "yes" : "no");
                } else {
                    log.info("{} {} -> {} ({} ms)", request.getMethod(), request.getRequestURI(),
                            status, ms);
                }
            }
            MDC.remove("run_id");
            MDC.remove("username");
        }
    }

    private static String extractRunId(HttpServletRequest request) {
        String header = request.getHeader("X-Run-Id");
        if (header != null && !header.isBlank()) {
            return header.trim();
        }
        Matcher m = RUN_PATH.matcher(request.getRequestURI());
        if (m.find()) {
            try {
                UUID.fromString(m.group(1));
                return m.group(1);
            } catch (IllegalArgumentException ignored) {
                return null;
            }
        }
        return null;
    }

    /** Служебные эндпоинты: логировать каждый scrape/probe бессмысленно. */
    private static boolean isHealthPath(String path) {
        return path.equals("/health") || path.equals("/ready") || path.equals("/metrics");
    }
}
