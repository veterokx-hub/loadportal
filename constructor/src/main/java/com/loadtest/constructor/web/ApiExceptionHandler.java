package com.loadtest.constructor.web;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> handleBadRequest(IllegalArgumentException ex) {
        String msg = ex.getMessage() == null ? "" : ex.getMessage();
        HttpStatus status = msg.contains("администратора") || msg.contains("авторизация")
                ? HttpStatus.FORBIDDEN
                : HttpStatus.NOT_FOUND;
        return ResponseEntity.status(status).body(Map.of("error", msg.isBlank() ? "Ошибка запроса" : msg));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleGeneric(Exception ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", ex.getMessage() == null ? ex.toString() : ex.getMessage()));
    }
}
