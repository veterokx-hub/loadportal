package com.loadtest.jmeterbuilder.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** /generate/* закрыт общим секретом с constructor. Health/metrics без токена. */
@Component
@Order(0)
public class InternalTokenFilter extends OncePerRequestFilter {

    private final String expected;

    public InternalTokenFilter(@Value("${loadtest.internal-token:}") String expected) {
        this.expected = expected == null ? "" : expected;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = request.getRequestURI();
        if (expected.isBlank() || !path.startsWith("/generate")) {
            chain.doFilter(request, response);
            return;
        }
        String provided = request.getHeader("X-Internal-Token");
        if (!secretsEqual(expected, provided == null ? "" : provided)) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"error\":\"Требуется внутренний токен\"}");
            return;
        }
        chain.doFilter(request, response);
    }

    private static boolean secretsEqual(String expected, String provided) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] left = md.digest(expected.getBytes(StandardCharsets.UTF_8));
            md.reset();
            byte[] right = md.digest(provided.getBytes(StandardCharsets.UTF_8));
            return MessageDigest.isEqual(left, right);
        } catch (NoSuchAlgorithmException ex) {
            return expected.equals(provided);
        }
    }
}
