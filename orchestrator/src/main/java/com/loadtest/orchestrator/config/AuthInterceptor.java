package com.loadtest.orchestrator.config;

import com.loadtest.orchestrator.security.AuthContext;
import com.loadtest.orchestrator.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.nio.charset.StandardCharsets;

@Component
public class AuthInterceptor implements HandlerInterceptor {

    public static final String ATTR_AUTH = "authContext";

    private final AuthService authService;

    public AuthInterceptor(AuthService authService) {
        this.authService = authService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }
        String path = request.getRequestURI();
        // Login живёт в constructor; orchestrator пропускает только webhook (свой секрет).
        if (path.startsWith("/api/runs/webhook/")) {
            return true;
        }
        String token = extractToken(request);
        var ctx = authService.resolve(token);
        if (ctx.isEmpty()) {
            writeJsonError(response, HttpServletResponse.SC_UNAUTHORIZED, "Требуется авторизация");
            return false;
        }
        request.setAttribute(ATTR_AUTH, ctx.get());
        if (ctx.get().mustChangePassword()
                && !path.startsWith("/api/auth/change-password")
                && !path.startsWith("/api/auth/logout")) {
            writeJsonError(response, HttpServletResponse.SC_FORBIDDEN, "Требуется сменить пароль");
            return false;
        }
        return true;
    }

    public static AuthContext requireAdmin(HttpServletRequest request) {
        AuthContext ctx = (AuthContext) request.getAttribute(ATTR_AUTH);
        if (ctx == null || !ctx.isAdmin()) {
            throw new IllegalArgumentException("Доступ только для администратора");
        }
        return ctx;
    }

    public static AuthContext requireAuth(HttpServletRequest request) {
        AuthContext ctx = (AuthContext) request.getAttribute(ATTR_AUTH);
        if (ctx == null) {
            throw new IllegalArgumentException("Требуется авторизация");
        }
        return ctx;
    }

    private static String extractToken(HttpServletRequest request) {
        String h = request.getHeader("Authorization");
        if (h != null && h.startsWith("Bearer ")) {
            return h.substring(7).trim();
        }
        return null;
    }

    /** Servlet по умолчанию пишет JSON в ISO-8859-1 — кириллица превращается в «???». */
    private static void writeJsonError(HttpServletResponse response, int status, String message)
            throws java.io.IOException {
        response.setStatus(status);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        String escaped = message.replace("\\", "\\\\").replace("\"", "\\\"");
        response.getWriter().write("{\"error\":\"" + escaped + "\"}");
    }
}
