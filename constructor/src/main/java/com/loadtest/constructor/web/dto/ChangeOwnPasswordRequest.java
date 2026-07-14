package com.loadtest.constructor.web.dto;

public record ChangeOwnPasswordRequest(String currentPassword, String newPassword) {
}
