package com.loadtest.constructor.web;

import com.loadtest.constructor.config.AuthInterceptor;
import com.loadtest.constructor.service.AuthService;
import com.loadtest.constructor.service.LoginRateLimiter;
import com.loadtest.constructor.web.dto.ChangeOwnPasswordRequest;
import com.loadtest.constructor.web.dto.LoginRequest;
import com.loadtest.constructor.web.dto.LoginResponse;
import com.loadtest.constructor.web.dto.SessionDto;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final LoginRateLimiter loginRateLimiter;

    public AuthController(AuthService authService, LoginRateLimiter loginRateLimiter) {
        this.authService = authService;
        this.loginRateLimiter = loginRateLimiter;
    }

    @PostMapping("/login")
    public LoginResponse login(@RequestBody LoginRequest req, HttpServletRequest request) {
        String ip = clientIp(request);
        try {
            loginRateLimiter.assertAllowed(req.username(), ip);
            LoginResponse ok = authService.login(req.username(), req.password());
            loginRateLimiter.recordSuccess(req.username(), ip);
            return ok;
        } catch (IllegalArgumentException e) {
            if (e.getMessage() != null && e.getMessage().contains("попыток")) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, e.getMessage());
            }
            loginRateLimiter.recordFailure(req.username(), ip);
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, e.getMessage());
        }
    }

    @PostMapping("/logout")
    public void logout(HttpServletRequest request) {
        String token = bearer(request);
        if (token != null) {
            authService.logout(token);
        }
    }

    @PostMapping("/logout-all")
    public void logoutAll(HttpServletRequest request) {
        var ctx = AuthInterceptor.requireAuth(request);
        authService.revokeAllSessions(ctx.username());
    }

    @GetMapping("/sessions")
    public List<SessionDto> sessions(HttpServletRequest request) {
        var ctx = AuthInterceptor.requireAuth(request);
        return authService.listSessions(ctx.username(), bearer(request));
    }

    @DeleteMapping("/sessions/{id}")
    public void revokeSession(@PathVariable UUID id, HttpServletRequest request) {
        var ctx = AuthInterceptor.requireAuth(request);
        try {
            authService.revokeSession(ctx.username(), id);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    /** Проверка живой сессии (frontend после F5 / пересоздания БД). */
    @GetMapping("/me")
    public LoginResponse me(HttpServletRequest request) {
        String token = bearer(request);
        if (token == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Требуется авторизация");
        }
        var ctx = authService.resolve(token)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Сессия недействительна"));
        return new LoginResponse("", ctx.username(), ctx.role(), ctx.mustChangePassword());
    }

    @PostMapping("/change-password")
    public void changePassword(@RequestBody ChangeOwnPasswordRequest req, HttpServletRequest request) {
        String token = bearer(request);
        if (token == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Требуется авторизация");
        }
        var ctx = authService.resolve(token)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Сессия недействительна"));
        try {
            authService.changeOwnPassword(ctx.username(), req.currentPassword(), req.newPassword());
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    private static String bearer(HttpServletRequest request) {
        String h = request.getHeader("Authorization");
        if (h != null && h.startsWith("Bearer ")) {
            return h.substring(7).trim();
        }
        return null;
    }

    private static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr() == null ? "" : request.getRemoteAddr();
    }
}
