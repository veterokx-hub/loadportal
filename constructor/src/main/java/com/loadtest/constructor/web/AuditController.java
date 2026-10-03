package com.loadtest.constructor.web;

import com.loadtest.constructor.config.AuthInterceptor;
import com.loadtest.constructor.service.AuditService;
import com.loadtest.constructor.web.dto.AuditEventDto;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/audit")
public class AuditController {

    private final AuditService auditService;

    public AuditController(AuditService auditService) {
        this.auditService = auditService;
    }

    @GetMapping
    public List<AuditEventDto> list(HttpServletRequest request) {
        AuthInterceptor.requireAdmin(request);
        return auditService.recent().stream()
                .map(e -> new AuditEventDto(
                        e.getId(), e.getCreatedAt(), e.getUsername(), e.getAction(), e.getDetail()))
                .toList();
    }
}
