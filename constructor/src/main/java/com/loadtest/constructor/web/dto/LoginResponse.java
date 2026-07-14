package com.loadtest.constructor.web.dto;

import com.loadtest.constructor.model.UserRole;

public record LoginResponse(String token, String username, UserRole role, boolean mustChangePassword) {
}
