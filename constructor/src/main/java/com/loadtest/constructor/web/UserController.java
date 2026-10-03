package com.loadtest.constructor.web;

import com.loadtest.constructor.config.AuthInterceptor;
import com.loadtest.constructor.service.UserService;
import com.loadtest.constructor.web.dto.ChangePasswordRequest;
import com.loadtest.constructor.web.dto.ChangeRoleRequest;
import com.loadtest.constructor.web.dto.CreateUserRequest;
import com.loadtest.constructor.web.dto.UserDto;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping
    public List<UserDto> list(HttpServletRequest request) {
        AuthInterceptor.requireAdmin(request);
        return userService.list();
    }

    @PostMapping
    public UserDto create(@RequestBody CreateUserRequest req, HttpServletRequest request) {
        AuthInterceptor.requireAdmin(request);
        return userService.create(req);
    }

    @PutMapping("/{username}/password")
    public void changePassword(@PathVariable String username,
                               @RequestBody ChangePasswordRequest req,
                               HttpServletRequest request) {
        AuthInterceptor.requireAdmin(request);
        userService.setPassword(username, req.password());
    }

    @PutMapping("/{username}/role")
    public UserDto setRole(
            @PathVariable String username,
            @RequestBody ChangeRoleRequest req,
            HttpServletRequest request) {
        AuthInterceptor.requireAdmin(request);
        return userService.setRole(username, req.role());
    }

    @DeleteMapping("/{username}")
    public void delete(@PathVariable String username, HttpServletRequest request) {
        AuthInterceptor.requireAdmin(request);
        userService.delete(username);
    }
}
