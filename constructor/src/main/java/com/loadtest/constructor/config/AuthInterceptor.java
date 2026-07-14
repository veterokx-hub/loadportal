package com.loadtest.constructor.config;

import com.loadtest.constructor.security.AuthContext;
import com.loadtest.constructor.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

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
        if (path.startsWith("/api/auth/login")) {
            return true;
        }
        String token = extractToken(request);
        var ctx = authService.resolve(token);
        if (ctx.isEmpty()) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Требуется авторизация\"}");
            return false;
        }
        request.setAttribute(ATTR_AUTH, ctx.get());
        if (ctx.get().mustChangePassword()
                && !path.startsWith("/api/auth/change-password")
                && !path.startsWith("/api/auth/logout")) {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Требуется сменить пароль\"}");
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
}
