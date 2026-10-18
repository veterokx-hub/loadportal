package com.loadtest.constructor.config;

import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

import java.util.Map;

/** После загрузки ConfigMap перекладывает плоские ключи в {@code loadtest.discovery}. */
public class PlatformConfigImporter implements EnvironmentPostProcessor, Ordered {

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        Map<String, Object> overlay = PlatformSettings.overlay(environment::getProperty);
        if (!overlay.isEmpty()) {
            environment.getPropertySources().addFirst(new MapPropertySource("loadtest-platform", overlay));
        }
    }

    @Override
    public int getOrder() {
        return Ordered.LOWEST_PRECEDENCE;
    }
}
