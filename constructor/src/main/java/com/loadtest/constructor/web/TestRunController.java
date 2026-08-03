package com.loadtest.constructor.web;

import com.loadtest.constructor.config.AuthInterceptor;
import com.loadtest.constructor.service.TestRunService;
import com.loadtest.constructor.web.dto.CreateTestRunRequest;
import com.loadtest.constructor.web.dto.TestRunDto;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/runs")
public class TestRunController {

    private final TestRunService testRunService;

    public TestRunController(TestRunService testRunService) {
        this.testRunService = testRunService;
    }

    @PostMapping
    public TestRunDto create(@RequestBody CreateTestRunRequest body, HttpServletRequest request) {
        return testRunService.create(body, AuthInterceptor.requireAuth(request));
    }

    @GetMapping
    public List<TestRunDto> list(HttpServletRequest request) {
        return testRunService.listRuns(AuthInterceptor.requireAuth(request));
    }

    @GetMapping("/{id}")
    public TestRunDto get(@PathVariable UUID id, HttpServletRequest request) {
        return testRunService.getRun(id, AuthInterceptor.requireAuth(request));
    }
}
