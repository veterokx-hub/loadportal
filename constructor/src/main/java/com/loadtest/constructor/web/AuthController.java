package com.loadtest.constructor.web;

import com.loadtest.constructor.service.AuthService;
import com.loadtest.constructor.web.dto.ChangeOwnPasswordRequest;
import com.loadtest.constructor.web.dto.LoginRequest;
import com.loadtest.constructor.web.dto.LoginResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public LoginResponse login(@RequestBody LoginRequest req) {
        try {
            return authService.login(req.username(), req.password());
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, e.getMessage());
        }
    }

    @PostMapping("/logout")
    public void logout(HttpServletRequest request) {
        String h = request.getHeader("Authorization");
        if (h != null && h.startsWith("Bearer ")) {
            authService.logout(h.substring(7).trim());
        }
    }

    /** Проверка живой сессии (frontend после F5 / пересоздания БД). */
    @GetMapping("/me")
    public LoginResponse me(HttpServletRequest request) {
        String h = request.getHeader("Authorization");
        if (h == null || !h.startsWith("Bearer ")) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Требуется авторизация");
        }
        var ctx = authService.resolve(h.substring(7).trim())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Сессия недействительна"));
        return new LoginResponse("", ctx.username(), ctx.role(), ctx.mustChangePassword());
    }

    @PostMapping("/change-password")
    public void changePassword(@RequestBody ChangeOwnPasswordRequest req, HttpServletRequest request) {
        String h = request.getHeader("Authorization");
        if (h == null || !h.startsWith("Bearer ")) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Требуется авторизация");
        }
        var ctx = authService.resolve(h.substring(7).trim())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Сессия недействительна"));
        try {
            authService.changeOwnPassword(ctx.username(), req.currentPassword(), req.newPassword());
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }
}
