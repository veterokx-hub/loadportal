package com.loadtest.constructor;

import com.loadtest.constructor.config.DiscoveryConfig;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableConfigurationProperties(DiscoveryConfig.class)
@EnableScheduling
public class ConstructorApplication {

    public static void main(String[] args) {
        SpringApplication.run(ConstructorApplication.class, args);
    }
}
