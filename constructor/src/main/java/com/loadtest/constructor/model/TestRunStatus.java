package com.loadtest.constructor.model;

public enum TestRunStatus {
    QUEUED,
    RUNNING,
    SUCCEEDED,
    FAILED,
    CANCELED;

    public static TestRunStatus fromGitLab(String gitlabStatus) {
        if (gitlabStatus == null) {
            return QUEUED;
        }
        return switch (gitlabStatus.toLowerCase()) {
            case "created", "waiting_for_resource", "preparing", "pending", "scheduled" -> QUEUED;
            case "running" -> RUNNING;
            case "success" -> SUCCEEDED;
            case "failed" -> FAILED;
            case "canceled", "cancelled", "skipped" -> CANCELED;
            default -> QUEUED;
        };
    }
}
