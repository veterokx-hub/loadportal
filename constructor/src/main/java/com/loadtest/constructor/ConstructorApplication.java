package com.loadtest.constructor;

import com.loadtest.constructor.config.DiscoveryConfig;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(DiscoveryConfig.class)
public class ConstructorApplication {

    public static void main(String[] args) {
        SpringApplication.run(ConstructorApplication.class, args);
    }
}
