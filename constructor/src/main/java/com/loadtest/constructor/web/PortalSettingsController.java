package com.loadtest.constructor.web;

import com.loadtest.constructor.config.AuthInterceptor;
import com.loadtest.constructor.service.PortalSettingsService;
import com.loadtest.constructor.web.dto.LdapSettingsDto;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/settings")
public class PortalSettingsController {

    private final PortalSettingsService settingsService;

    public PortalSettingsController(PortalSettingsService settingsService) {
        this.settingsService = settingsService;
    }

    @GetMapping("/ldap")
    public LdapSettingsDto getLdap(HttpServletRequest request) {
        AuthInterceptor.requireAdmin(request);
        return settingsService.getLdap();
    }

    @PutMapping("/ldap")
    public LdapSettingsDto saveLdap(@RequestBody LdapSettingsDto dto, HttpServletRequest request) {
        AuthInterceptor.requireAdmin(request);
        return settingsService.saveLdap(dto);
    }
}
