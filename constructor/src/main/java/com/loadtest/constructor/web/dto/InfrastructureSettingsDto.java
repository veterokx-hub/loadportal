package com.loadtest.constructor.web.dto;

public record InfrastructureSettingsDto(
        boolean consulEnabled,
        String consulHost,
        int consulPort,
        String consulDatacenter,
        String consulKvPrefix,
        String consulServiceAnalyzer,
        String consulServiceK6,
        String consulServiceJmeter,
        String analyzerUrl,
        String k6GeneratorUrl,
        String jmeterBuilderUrl,
        /** Текущие резолвнутые URL (readonly для UI). */
        String resolvedAnalyzerUrl,
        String resolvedK6GeneratorUrl,
        String resolvedJmeterBuilderUrl,
        boolean consulReachable
) {
}
