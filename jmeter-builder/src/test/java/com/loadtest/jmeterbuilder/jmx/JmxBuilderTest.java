package com.loadtest.jmeterbuilder.jmx;

import com.loadtest.jmeterbuilder.model.*;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class JmxBuilderTest {

    private final JmxBuilder builder = new JmxBuilder();

    private Scenario sampleScenario(TestMode mode) {
        // login использует датасет ds1 и извлекает authToken
        Request login = new Request(
                "login", 1, "POST /login", "POST", "/login", null,
                List.of(new KeyValue("Content-Type", "application/json")),
                List.of(),
                new Body(BodyMode.JSON, "application/json",
                        "{\"username\":\"${username}\",\"password\":\"${password}\"}"),
                List.of(
                        new Param("username", ParamLocation.BODY, new ParamSource.Csv("username"), "string", null, true),
                        new Param("password", ParamLocation.BODY, new ParamSource.Csv("password"), "string", null, true)
                ),
                List.of(new Extraction("authToken", ExtractionType.JSON, "$.token", 1, "NOT_FOUND")),
                new Intensity(10.0, 30, 60),
                new Validation(true, 200, "\"token\""),
                "ds1",
                1
        );
        // profile коррелирует с login (использует ${authToken}) -> та же группа
        Request profile = new Request(
                "profile", 2, "GET /users/{userId}", "GET", "/users/{userId}", null,
                List.of(),
                List.of(),
                Body.none(),
                List.of(
                        new Param("Authorization", ParamLocation.HEADER,
                                new ParamSource.Constant("Bearer ${authToken}"), "string", null, true),
                        new Param("userId", ParamLocation.PATH,
                                new ParamSource.GeneratorRef(new Generator(GeneratorType.UUID, null, null, null, null, null, null)),
                                "string", null, true)
                ),
                List.of(),
                new Intensity(10.0, 30, 60),
                new Validation(true, 200, ""),
                null,
                3
        );
        // независимый запрос -> отдельная группа
        Request search = new Request(
                "search", 3, "GET /search", "GET", "/search", null,
                List.of(), List.of(), Body.none(), List.of(), List.of(),
                new Intensity(50.0, 20, 120),
                new Validation(true, 200, ""),
                null,
                1
        );

        Dataset ds = new Dataset("ds1", "Учётки", "auth.csv",
                List.of("username", "password"),
                List.of(List.of("u1", "p1"), List.of("u2", "p2")),
                false);

        LoadConfig load = new LoadConfig(mode, 4, 30, 1.0);

        return new Scenario("demo-api", SourceType.OPENAPI, "https://api.demo.com/v1",
                load, List.of(ds), List.of(login, profile, search), AutoStop.disabled(),
                PrometheusConfig.defaults());
    }

    @Test
    void groupsCorrelatedAndDatasetSharingRequests() throws Exception {
        String jmx = builder.build(sampleScenario(TestMode.RAMP_HOLD));

        assertTrue(jmx.contains("jmeter=\"5.6.3\""));
        // корреляция login->profile => одна группа; search => отдельная => 2 Concurrency Thread Group
        assertEquals(2, countOccurrences(jmx, "<com.blazemeter.jmeter.threads.concurrency.ConcurrencyThreadGroup "));
        // Throughput Shaping Timer на каждую группу
        assertEquals(2, countOccurrences(jmx, "<kg.apc.jmeter.timers.VariableThroughputTimer "));
        // Constant Throughput Timer больше не используется
        assertFalse(jmx.contains("ConstantThroughputTimer"));
        // валидация: код + regex
        assertTrue(jmx.contains("Assertion.response_code"));
        assertTrue(jmx.contains("Assertion.response_data"));
        // CSV Data Set присутствует
        assertTrue(jmx.contains("CSVDataSet"));
        assertTrue(jmx.contains("auth.csv"));
        // корреляция сохранена
        assertTrue(jmx.contains("Bearer ${authToken}"));
        assertTrue(jmx.contains("${__UUID()}"));
        // repeat=3 у profile -> Loop Controller на 3 повтора
        assertTrue(jmx.contains("<LoopController "));
        assertTrue(jmx.contains(">3</stringProp>"));
        // Prometheus Backend Listener (Kolesnikov)
        assertTrue(jmx.contains("<BackendListener "));
        assertTrue(jmx.contains("com.github.kolesnikovm.PrometheusListener"));
        assertTrue(jmx.contains(">demo-api</stringProp>"));
        assertTrue(jmx.contains(">9001</stringProp>"));

        Document doc = DocumentBuilderFactory.newInstance().newDocumentBuilder()
                .parse(new ByteArrayInputStream(jmx.getBytes(StandardCharsets.UTF_8)));
        assertEquals("jmeterTestPlan", doc.getDocumentElement().getNodeName());

        java.nio.file.Files.writeString(java.nio.file.Path.of("build", "generated-demo.jmx"), jmx);
    }

    @Test
    void maxSearchProducesStaircase() {
        String jmx = builder.build(sampleScenario(TestMode.MAX_SEARCH));
        // 4 ступени на группу
        assertEquals(2 * 4, countOccurrences(jmx, "<collectionProp name=\"row_"));
    }

    @Test
    void queryParamsGoToHttpArgumentsNotPath() {
        Request req = new Request(
                "q", 1, "GET list", "GET", "/debit-cards-work-cards/v1/activeSoftblockDebitCardList", null,
                List.of(), List.of(), Body.none(),
                List.of(new Param("param", ParamLocation.QUERY,
                        new ParamSource.Constant("prp"), "string", null, false)),
                List.of(),
                new Intensity(1.0, 1, 1),
                Validation.defaults(),
                null,
                1
        );
        Scenario s = new Scenario("q-test", SourceType.OPENAPI, "https://api.example.com",
                LoadConfig.defaults(), List.of(), List.of(req), AutoStop.disabled(),
                PrometheusConfig.defaults());
        String jmx = builder.build(s);
        assertTrue(jmx.contains("Argument.name\">param</stringProp>"));
        assertTrue(jmx.contains("Argument.value\">prp</stringProp>"));
        assertFalse(jmx.contains("activeSoftblockDebitCardList/prp"));
        assertFalse(jmx.contains("activeSoftblockDebitCardList?param=prp"));
    }

    private static int countOccurrences(String haystack, String needle) {
        int c = 0, i = 0;
        while ((i = haystack.indexOf(needle, i)) != -1) {
            c++;
            i += needle.length();
        }
        return c;
    }
}
