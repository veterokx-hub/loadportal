package com.loadtest.constructor.web;

import com.loadtest.constructor.model.Scenario;
import com.loadtest.constructor.persistence.ProjectEntity;
import com.loadtest.constructor.persistence.ProjectRepository;
import com.loadtest.constructor.service.ScenarioService;
import com.loadtest.constructor.web.dto.ProjectDto;
import com.loadtest.constructor.web.dto.ScenarioSummary;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {

    private final ProjectRepository projectRepository;
    private final ScenarioService scenarioService;

    public ProjectController(ProjectRepository projectRepository, ScenarioService scenarioService) {
        this.projectRepository = projectRepository;
        this.scenarioService = scenarioService;
    }

    @GetMapping
    public List<ProjectDto> list() {
        return projectRepository.findAll().stream().map(ProjectDto::from).toList();
    }

    @PostMapping
    public ProjectDto create(@RequestBody Map<String, String> body) {
        String name = body.getOrDefault("name", "Untitled project");
        return ProjectDto.from(projectRepository.save(new ProjectEntity(name)));
    }

    @PostMapping("/{projectId}/scenarios")
    public ScenarioSummary saveScenario(@PathVariable UUID projectId, @RequestBody Scenario scenario) {
        return ScenarioSummary.from(scenarioService.save(projectId, scenario));
    }

    @GetMapping("/{projectId}/scenarios")
    public List<ScenarioSummary> listScenarios(@PathVariable UUID projectId) {
        return scenarioService.listByProject(projectId).stream().map(ScenarioSummary::from).toList();
    }
}
