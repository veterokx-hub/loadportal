package com.loadtest.constructor.model;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class TestRunStatusTest {

    @Test
    void mapsGitLabStatuses() {
        assertEquals(TestRunStatus.QUEUED, TestRunStatus.fromGitLab(null));
        assertEquals(TestRunStatus.QUEUED, TestRunStatus.fromGitLab("pending"));
        assertEquals(TestRunStatus.RUNNING, TestRunStatus.fromGitLab("RUNNING"));
        assertEquals(TestRunStatus.SUCCEEDED, TestRunStatus.fromGitLab("success"));
        assertEquals(TestRunStatus.FAILED, TestRunStatus.fromGitLab("failed"));
        assertEquals(TestRunStatus.CANCELED, TestRunStatus.fromGitLab("cancelled"));
        assertEquals(TestRunStatus.CANCELED, TestRunStatus.fromGitLab("skipped"));
        assertEquals(TestRunStatus.QUEUED, TestRunStatus.fromGitLab("manual"));
    }
}
