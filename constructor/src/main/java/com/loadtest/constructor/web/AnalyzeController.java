package com.loadtest.constructor.web;

import com.loadtest.constructor.client.AnalyzerClient;
import com.loadtest.constructor.model.Scenario;
import com.loadtest.constructor.web.dto.AnalyzeRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class AnalyzeController {

    private final AnalyzerClient analyzerClient;

    public AnalyzeController(AnalyzerClient analyzerClient) {
        this.analyzerClient = analyzerClient;
    }

    /** Разбор спецификации (OpenAPI/Postman) в черновик сценария. Без сохранения. */
    @PostMapping("/analyze")
    public Scenario analyze(@RequestBody AnalyzeRequest request) {
        FetchUrls.requireHttpUrl(request.url());
        return analyzerClient.analyze(request);
    }
}
