package com.loadtest.constructor.config;

import com.loadtest.constructor.model.UserRole;
import com.loadtest.constructor.persistence.PortalSettingsEntity;
import com.loadtest.constructor.persistence.PortalSettingsRepository;
import com.loadtest.constructor.persistence.UserEntity;
import com.loadtest.constructor.persistence.UserRepository;
import com.loadtest.constructor.service.AuthService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class DataInitializer {

    private static final Logger log = LoggerFactory.getLogger(DataInitializer.class);

    @Bean
    CommandLineRunner seedUsers(UserRepository users,
                                PortalSettingsRepository settings,
                                AuthService authService) {
        return args -> {
            if (settings.findById(1L).isEmpty()) {
                settings.save(PortalSettingsEntity.defaults());
                log.info("Инициализированы настройки портала (LDAP)");
            }
            if (users.findByUsernameIgnoreCase("admin").isEmpty()) {
                String hash = authService.passwordEncoder().encode("admin");
                UserEntity admin = new UserEntity("admin", hash, UserRole.ADMIN, false);
                admin.setMustChangePassword(true);
                users.save(admin);
                log.info("Создан пользователь admin (пароль по умолчанию: admin, требуется смена при первом входе)");
            } else {
                users.findByUsernameIgnoreCase("admin").ifPresent(admin -> {
                    if (!admin.isMustChangePassword()
                            && authService.passwordEncoder().matches("admin", admin.getPasswordHash())) {
                        admin.setMustChangePassword(true);
                        users.save(admin);
                        log.info("admin всё ещё с паролем по умолчанию — включена обязательная смена");
                    }
                });
            }
        };
    }
}
