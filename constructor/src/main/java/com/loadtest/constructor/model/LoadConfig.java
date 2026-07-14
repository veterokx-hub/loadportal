package com.loadtest.constructor.model;

/** Параметры нагрузки уровня сценария. */
public record LoadConfig(
        TestMode testMode,
        int steps,
        int stepDurationSec,
        double assumedLatencySec
) {
    public static LoadConfig defaults() {
        return new LoadConfig(TestMode.RAMP_HOLD, 5, 60, 1.0);
    }

    public TestMode testMode() {
        return testMode != null ? testMode : TestMode.RAMP_HOLD;
    }
}
