package com.loadtest.constructor.web.dto;

import com.loadtest.constructor.model.UserRole;

public record CreateUserRequest(String username, String password, UserRole role, boolean ldapOnly) {
}
