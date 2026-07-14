package com.loadtest.jmeterbuilder.model;

/** Профиль интенсивности группы. targetRps трактуется как ПИК. */
public record Intensity(
        double targetRps,
        int rampUpSec,
        int holdSec
) {
    public static Intensity defaults() {
        return new Intensity(10.0, 30, 60);
    }
}
