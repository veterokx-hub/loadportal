package com.loadtest.jmeterbuilder.jmx;

import com.loadtest.jmeterbuilder.model.*;
import org.springframework.stereotype.Component;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import java.io.StringWriter;
import java.net.URI;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Сборка JMeter 5.6.3 .jmx из доменной модели Scenario.
 *
 * Модель нагрузки:
 *  - каждая ГРУППА (см. {@link ScenarioGrouping}) = Concurrency Thread Group (jpgc-casutg)
 *    + Throughput Shaping Timer (jpgc-tst), задающий профиль RPS;
 *  - связанные корреляцией/общим CSV запросы — в одной группе (единая интенсивность);
 *  - Constant Throughput Timer не используется.
 *
 * Требуются плагины JMeter: jpgc-casutg и jpgc-tst.
 */
@Component
public class JmxBuilder {

    private static final String JMETER_VERSION = "5.6.3";
    private static final double CONCURRENCY_SAFETY = 1.5;

    private static final String CTG = "com.blazemeter.jmeter.threads.concurrency.ConcurrencyThreadGroup";
    private static final String CTG_GUI = "com.blazemeter.jmeter.threads.concurrency.ConcurrencyThreadGroupGui";
    private static final String VUC = "com.blazemeter.jmeter.control.VirtualUserController";
    private static final String TST = "kg.apc.jmeter.timers.VariableThroughputTimer";
    private static final String TST_GUI = "kg.apc.jmeter.timers.VariableThroughputTimerGui";

    public String build(Scenario scenario) {
        try {
            Document doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().newDocument();

            Element testPlanTag = doc.createElement("jmeterTestPlan");
            testPlanTag.setAttribute("version", "1.2");
            testPlanTag.setAttribute("properties", "5.0");
            testPlanTag.setAttribute("jmeter", JMETER_VERSION);
            doc.appendChild(testPlanTag);

            Element rootHashTree = el(doc, "hashTree");
            testPlanTag.appendChild(rootHashTree);

            Element testPlan = testPlan(doc, scenario.name());
            Element testPlanChildren = appendWithHashTree(doc, rootHashTree, testPlan);

            UrlParts base = UrlParts.parse(scenario.baseUrl());
            appendWithHashTree(doc, testPlanChildren, httpDefaults(doc, base));

            AutoStop autostop = scenario.autostop();
            if (autostop.enabled()) {
                appendWithHashTree(doc, testPlanChildren, autoStopListener(doc, autostop));
            }

            appendWithHashTree(doc, testPlanChildren, influxBackendListener(doc, scenario));

            Map<String, Dataset> datasetsById = scenario.datasets().stream()
                    .collect(Collectors.toMap(Dataset::id, d -> d, (a, b) -> a, LinkedHashMap::new));

            LoadConfig load = scenario.load();

            for (ScenarioGrouping.Group grp : ScenarioGrouping.group(scenario)) {
                Element ctg = concurrencyThreadGroup(doc, grp, load);
                Element ctgChildren = appendWithHashTree(doc, testPlanChildren, ctg);

                // CSV Data Set Config для датасетов группы
                for (String dsId : grp.datasetIds()) {
                    Dataset ds = datasetsById.get(dsId);
                    if (ds != null && !ds.columns().isEmpty()) {
                        appendWithHashTree(doc, ctgChildren,
                                ds.random() ? randomCsvDataSet(doc, ds) : csvDataSet(doc, ds));
                    }
                }

                appendCounters(doc, ctgChildren, grp);

                // Throughput Shaping Timer — профиль RPS на всю группу
                appendWithHashTree(doc, ctgChildren, throughputShapingTimer(doc, grp.intensity(), load));

                // Сэмплеры в порядке
                for (Request req : grp.requests()) {
                    // repeat > 1 -> оборачиваем в Loop Controller (запрос N раз за итерацию потока),
                    // что даёт разную интенсивность внутри одной корреляционной группы.
                    Element parentChildren = ctgChildren;
                    if (req.repeatOrOne() > 1) {
                        Element loop = loopController(doc, req.repeatOrOne(), req.name());
                        parentChildren = appendWithHashTree(doc, ctgChildren, loop);
                    }
                    Element sampler = httpSampler(doc, req, base);
                    Element samplerChildren = appendWithHashTree(doc, parentChildren, sampler);

                    List<KeyValue> headers = effectiveHeaders(req);
                    if (!headers.isEmpty()) {
                        appendWithHashTree(doc, samplerChildren, headerManager(doc, headers));
                    }
                    for (Extraction ex : req.extractions()) {
                        appendWithHashTree(doc, samplerChildren, extractor(doc, ex));
                    }
                    // валидация: код ответа (всегда, если включено) + опциональный regex
                    Validation v = req.validation();
                    if (v.checkResponseCode()) {
                        appendWithHashTree(doc, samplerChildren, responseCodeAssertion(doc, v.expectedStatus()));
                    }
                    if (v.responseContains() != null && !v.responseContains().isBlank()) {
                        appendWithHashTree(doc, samplerChildren, responseContainsAssertion(doc, v.responseContains()));
                    }
                }
            }

            return serialize(doc);
        } catch (Exception e) {
            throw new JmxBuildException("Не удалось собрать .jmx: " + e.getMessage(), e);
        }
    }

    // --- Тред-группа и таймер -----------------------------------------------------

    private Element concurrencyThreadGroup(Document doc, ScenarioGrouping.Group grp, LoadConfig load) {
        Intensity in = grp.intensity();
        int concurrency = Math.max(1, (int) Math.ceil(in.targetRps() * load.assumedLatencySec() * CONCURRENCY_SAFETY));

        int cRamp;
        int cHold;
        if (load.testMode() == TestMode.MAX_SEARCH) {
            cRamp = load.stepDurationSec();
            cHold = Math.max(0, load.steps() * load.stepDurationSec() - load.stepDurationSec());
        } else {
            cRamp = in.rampUpSec();
            cHold = in.holdSec();
        }

        Element e = testElement(doc, CTG, CTG_GUI, CTG, grp.name());
        Element vuc = doc.createElement("elementProp");
        vuc.setAttribute("name", "ThreadGroup.main_controller");
        vuc.setAttribute("elementType", VUC);
        vuc.setAttribute("guiclass", "com.blazemeter.jmeter.control.VirtualUserControllerGui");
        vuc.setAttribute("testclass", VUC);
        vuc.setAttribute("testname", "Virtual User Controller");
        vuc.setAttribute("enabled", "true");
        e.appendChild(vuc);
        e.appendChild(stringProp(doc, "ThreadGroup.on_sample_error", "continue"));
        e.appendChild(stringProp(doc, "TargetLevel", String.valueOf(concurrency)));
        e.appendChild(stringProp(doc, "RampUp", String.valueOf(cRamp)));
        e.appendChild(stringProp(doc, "Steps", "1"));
        e.appendChild(stringProp(doc, "Hold", String.valueOf(cHold)));
        e.appendChild(stringProp(doc, "LogFilename", ""));
        e.appendChild(stringProp(doc, "Iterations", ""));
        e.appendChild(stringProp(doc, "Unit", "S"));
        return e;
    }

    private Element throughputShapingTimer(Document doc, Intensity in, LoadConfig load) {
        Element e = testElement(doc, TST, TST_GUI, TST, "jp@gc - Throughput Shaping Timer");
        Element profile = collectionProp(doc, "load_profile");

        List<double[]> rows = new ArrayList<>(); // {startRps, endRps, durationSec}
        double target = in.targetRps();
        if (load.testMode() == TestMode.MAX_SEARCH) {
            int steps = Math.max(1, load.steps());
            for (int i = 1; i <= steps; i++) {
                double level = target * i / steps;
                rows.add(new double[]{level, level, load.stepDurationSec()});
            }
        } else {
            if (in.rampUpSec() > 0) {
                double start = Math.min(1.0, target);
                rows.add(new double[]{start, target, in.rampUpSec()});
            }
            rows.add(new double[]{target, target, Math.max(1, in.holdSec())});
        }

        int idx = 0;
        for (double[] r : rows) {
            Element row = collectionProp(doc, "row_" + idx++);
            row.appendChild(stringProp(doc, "start", num(r[0])));
            row.appendChild(stringProp(doc, "end", num(r[1])));
            row.appendChild(stringProp(doc, "dur", num(r[2])));
            profile.appendChild(row);
        }
        e.appendChild(profile);
        return e;
    }

    // --- Валидация ----------------------------------------------------------------

    private Element responseCodeAssertion(Document doc, int status) {
        Element e = testElement(doc, "ResponseAssertion", "AssertionGui",
                "ResponseAssertion", "Проверка кода ответа = " + status);
        Element coll = collectionProp(doc, "Asserion.test_strings");
        coll.appendChild(stringProp(doc, "0", String.valueOf(status)));
        e.appendChild(coll);
        e.appendChild(stringProp(doc, "Assertion.custom_message", ""));
        e.appendChild(stringProp(doc, "Assertion.test_field", "Assertion.response_code"));
        e.appendChild(boolProp(doc, "Assertion.assume_success", false));
        e.appendChild(intProp(doc, "Assertion.test_type", 8)); // 8 = Equals
        return e;
    }

    private Element responseContainsAssertion(Document doc, String text) {
        Element e = testElement(doc, "ResponseAssertion", "AssertionGui",
                "ResponseAssertion", "Тело ответа содержит текст");
        Element coll = collectionProp(doc, "Asserion.test_strings");
        coll.appendChild(stringProp(doc, "0", text));
        e.appendChild(coll);
        e.appendChild(stringProp(doc, "Assertion.custom_message", "Ответ не содержит ожидаемый текст"));
        e.appendChild(stringProp(doc, "Assertion.test_field", "Assertion.response_data"));
        e.appendChild(boolProp(doc, "Assertion.assume_success", false));
        e.appendChild(intProp(doc, "Assertion.test_type", 2)); // 2 = Contains
        return e;
    }

    // --- Прочие элементы ----------------------------------------------------------

    private Element testPlan(Document doc, String name) {
        Element e = testElement(doc, "TestPlan", "TestPlanGui", "TestPlan",
                name == null ? "Test Plan" : name);
        e.appendChild(boolProp(doc, "TestPlan.functional_mode", false));
        e.appendChild(boolProp(doc, "TestPlan.tearDown_on_shutdown", true));
        e.appendChild(boolProp(doc, "TestPlan.serialize_threadgroups", false));
        Element udv = doc.createElement("elementProp");
        udv.setAttribute("name", "TestPlan.user_defined_variables");
        udv.setAttribute("elementType", "Arguments");
        udv.setAttribute("guiclass", "ArgumentsPanel");
        udv.setAttribute("testclass", "Arguments");
        udv.setAttribute("testname", "User Defined Variables");
        udv.setAttribute("enabled", "true");
        udv.appendChild(collectionProp(doc, "Arguments.arguments"));
        e.appendChild(udv);
        e.appendChild(stringProp(doc, "TestPlan.user_define_classpath", ""));
        return e;
    }

    private Element httpDefaults(Document doc, UrlParts base) {
        Element e = testElement(doc, "ConfigTestElement", "HttpDefaultsGui",
                "ConfigTestElement", "HTTP Request Defaults");
        e.appendChild(emptyHttpArguments(doc));
        e.appendChild(stringProp(doc, "HTTPSampler.domain", base.host));
        e.appendChild(stringProp(doc, "HTTPSampler.port", base.port));
        e.appendChild(stringProp(doc, "HTTPSampler.protocol", base.protocol));
        e.appendChild(stringProp(doc, "HTTPSampler.contentEncoding", "UTF-8"));
        e.appendChild(stringProp(doc, "HTTPSampler.path", ""));
        return e;
    }

    private Element httpSampler(Document doc, Request req, UrlParts base) {
        Element e = testElement(doc, "HTTPSamplerProxy", "HttpTestSampleGui",
                "HTTPSamplerProxy", req.name());

        boolean rawBody = req.body() != null && req.body().mode() != BodyMode.NONE
                && req.body().content() != null && !req.body().content().isEmpty();

        List<Param> queryParams = req.params().stream()
                .filter(p -> p.location() == ParamLocation.QUERY)
                .collect(Collectors.toList());

        Element args = emptyHttpArguments(doc);
        Element coll = (Element) args.getElementsByTagName("collectionProp").item(0);
        for (Param qp : queryParams) {
            if (qp.name() == null || qp.name().isBlank()) continue;
            appendQueryArgument(doc, coll, qp.name(), render(qp.source(), qp.name()));
        }
        if (rawBody) {
            appendBodyArgument(doc, coll, effectiveBody(req));
        }
        e.appendChild(args);

        // Собственный URL запроса переопределяет HTTP Request Defaults (base_url).
        UrlParts custom = req.hasCustomUrl() ? UrlParts.parseLenient(req.url()) : null;
        e.appendChild(stringProp(doc, "HTTPSampler.domain", custom == null ? "" : custom.host));
        e.appendChild(stringProp(doc, "HTTPSampler.port", custom == null ? "" : custom.port));
        e.appendChild(stringProp(doc, "HTTPSampler.protocol", custom == null ? "" : custom.protocol));
        e.appendChild(stringProp(doc, "HTTPSampler.contentEncoding", ""));
        e.appendChild(stringProp(doc, "HTTPSampler.path",
                custom == null ? effectivePath(req, base) : renderPathParams(req, custom.basePath)));
        e.appendChild(stringProp(doc, "HTTPSampler.method", req.method()));
        e.appendChild(boolProp(doc, "HTTPSampler.follow_redirects", true));
        e.appendChild(boolProp(doc, "HTTPSampler.auto_redirects", false));
        e.appendChild(boolProp(doc, "HTTPSampler.use_keepalive", true));
        e.appendChild(boolProp(doc, "HTTPSampler.DO_MULTIPART_POST", false));
        e.appendChild(stringProp(doc, "HTTPSampler.embedded_url_re", ""));
        e.appendChild(stringProp(doc, "HTTPSampler.connect_timeout", ""));
        e.appendChild(stringProp(doc, "HTTPSampler.response_timeout", ""));
        if (rawBody) {
            e.appendChild(boolProp(doc, "HTTPSampler.postBodyRaw", true));
        }
        return e;
    }

    private void appendQueryArgument(Document doc, Element coll, String name, String value) {
        Element arg = doc.createElement("elementProp");
        arg.setAttribute("name", name);
        arg.setAttribute("elementType", "HTTPArgument");
        arg.appendChild(boolProp(doc, "HTTPArgument.always_encode", false));
        arg.appendChild(stringProp(doc, "Argument.value", value));
        arg.appendChild(stringProp(doc, "Argument.metadata", "="));
        arg.appendChild(boolProp(doc, "HTTPArgument.use_equals", true));
        arg.appendChild(stringProp(doc, "Argument.name", name));
        coll.appendChild(arg);
    }

    private void appendBodyArgument(Document doc, Element coll, String content) {
        Element arg = doc.createElement("elementProp");
        arg.setAttribute("name", "");
        arg.setAttribute("elementType", "HTTPArgument");
        arg.appendChild(boolProp(doc, "HTTPArgument.always_encode", false));
        arg.appendChild(stringProp(doc, "Argument.value", content));
        arg.appendChild(stringProp(doc, "Argument.metadata", "="));
        coll.appendChild(arg);
    }

    private Element headerManager(Document doc, List<KeyValue> headers) {
        Element e = testElement(doc, "HeaderManager", "HeaderPanel",
                "HeaderManager", "HTTP Header Manager");
        Element coll = collectionProp(doc, "HeaderManager.headers");
        for (KeyValue h : headers) {
            Element hp = doc.createElement("elementProp");
            hp.setAttribute("name", h.key());
            hp.setAttribute("elementType", "Header");
            hp.appendChild(stringProp(doc, "Header.name", h.key()));
            hp.appendChild(stringProp(doc, "Header.value", h.value() == null ? "" : h.value()));
            coll.appendChild(hp);
        }
        e.appendChild(coll);
        return e;
    }

    private Element extractor(Document doc, Extraction ex) {
        switch (ex.type()) {
            case JSON -> {
                Element e = testElement(doc, "JSONPostProcessor", "JSONPostProcessorGui",
                        "JSONPostProcessor", "JSON Extractor: " + ex.variable());
                e.appendChild(stringProp(doc, "JSONPostProcessor.referenceNames", ex.variable()));
                e.appendChild(stringProp(doc, "JSONPostProcessor.jsonPathExprs", ex.expression()));
                e.appendChild(stringProp(doc, "JSONPostProcessor.match_numbers", String.valueOf(ex.matchNo())));
                e.appendChild(stringProp(doc, "JSONPostProcessor.defaultValues", ex.defaultValue()));
                return e;
            }
            case REGEX -> {
                Element e = testElement(doc, "RegexExtractor", "RegexExtractorGui",
                        "RegexExtractor", "Regex Extractor: " + ex.variable());
                e.appendChild(stringProp(doc, "RegexExtractor.useHeaders", "false"));
                e.appendChild(stringProp(doc, "RegexExtractor.refname", ex.variable()));
                e.appendChild(stringProp(doc, "RegexExtractor.regex", ex.expression()));
                e.appendChild(stringProp(doc, "RegexExtractor.template", "$1$"));
                e.appendChild(stringProp(doc, "RegexExtractor.default", ex.defaultValue()));
                e.appendChild(stringProp(doc, "RegexExtractor.match_number", String.valueOf(ex.matchNo())));
                return e;
            }
            case BOUNDARY -> {
                String[] lr = ex.expression().split("\\|", 2);
                Element e = testElement(doc, "BoundaryExtractor", "BoundaryExtractorGui",
                        "BoundaryExtractor", "Boundary Extractor: " + ex.variable());
                e.appendChild(stringProp(doc, "BoundaryExtractor.useHeaders", "false"));
                e.appendChild(stringProp(doc, "BoundaryExtractor.refname", ex.variable()));
                e.appendChild(stringProp(doc, "BoundaryExtractor.lboundary", lr.length > 0 ? lr[0] : ""));
                e.appendChild(stringProp(doc, "BoundaryExtractor.rboundary", lr.length > 1 ? lr[1] : ""));
                e.appendChild(stringProp(doc, "BoundaryExtractor.default", ex.defaultValue()));
                e.appendChild(stringProp(doc, "BoundaryExtractor.match_number", String.valueOf(ex.matchNo())));
                return e;
            }
            default -> throw new JmxBuildException("Неизвестный тип экстрактора: " + ex.type());
        }
    }

    private Element loopController(Document doc, int loops, String reqName) {
        Element e = testElement(doc, "LoopController", "LoopControlPanel",
                "LoopController", "Повтор ×" + loops + ": " + reqName);
        e.appendChild(boolProp(doc, "LoopController.continue_forever", false));
        e.appendChild(stringProp(doc, "LoopController.loops", String.valueOf(loops)));
        return e;
    }

    private Element influxBackendListener(Document doc, Scenario scenario) {
        PrometheusConfig p = scenario.prometheus();
        String testName = scenario.name() == null || scenario.name().isBlank() ? "scenario" : scenario.name();
        String application = p.application().isBlank() ? testName : p.application().trim();
        String influxUrl = p.influxdbUrl();
        if (influxUrl.indexOf(',') >= 0 || influxUrl.indexOf('}') >= 0) {
            throw new JmxBuildException(
                    "Адрес VictoriaMetrics не должен содержать запятую или }: JMeter обрежет ${__P(influxdb_url,...)}");
        }

        Element e = testElement(doc, "BackendListener", "BackendListenerGui",
                "BackendListener", "VictoriaMetrics (Influx)");
        e.appendChild(stringProp(doc, "classname",
                "org.apache.jmeter.visualizers.backend.influxdb.InfluxdbBackendListenerClient"));

        Element args = doc.createElement("elementProp");
        args.setAttribute("name", "arguments");
        args.setAttribute("elementType", "Arguments");
        args.setAttribute("guiclass", "ArgumentsPanel");
        args.setAttribute("testclass", "Arguments");
        args.setAttribute("testname", "Arguments");
        args.setAttribute("enabled", "true");
        Element coll = collectionProp(doc, "Arguments.arguments");

        addBackendArg(doc, coll, "influxdbMetricsSender",
                "org.apache.jmeter.visualizers.backend.influxdb.HttpMetricsSender");
        // Раннер перекрывает адрес через -Jinfluxdb_url, только если он непустой.
        addBackendArg(doc, coll, "influxdbUrl", "${__P(influxdb_url," + influxUrl + ")}");
        addBackendArg(doc, coll, "influxdbToken", p.influxdbToken());
        addBackendArg(doc, coll, "application", application);
        addBackendArg(doc, coll, "measurement", p.measurement());
        addBackendArg(doc, coll, "summaryOnly", p.summaryOnly() ? "true" : "false");
        addBackendArg(doc, coll, "samplersRegex", p.samplersRegExp());
        addBackendArg(doc, coll, "percentiles", p.percentiles());
        addBackendArg(doc, coll, "testTitle", testName);
        addBackendArg(doc, coll, "eventTags", "");
        addBackendArg(doc, coll, "TAG_runId", "${__P(runId,1)}");

        args.appendChild(coll);
        e.appendChild(args);
        return e;
    }

    private void addBackendArg(Document doc, Element coll, String name, String value) {
        Element arg = doc.createElement("elementProp");
        arg.setAttribute("name", name);
        arg.setAttribute("elementType", "Argument");
        arg.appendChild(stringProp(doc, "Argument.name", name));
        arg.appendChild(stringProp(doc, "Argument.value", value));
        arg.appendChild(stringProp(doc, "Argument.metadata", "="));
        coll.appendChild(arg);
    }

    private Element autoStopListener(Document doc, AutoStop a) {
        Element e = testElement(doc, "kg.apc.jmeter.reporters.AutoStop",
                "kg.apc.jmeter.reporters.AutoStopGui",
                "kg.apc.jmeter.reporters.AutoStop", "jp@gc - AutoStop");
        e.appendChild(stringProp(doc, "error_rate", num(a.errorRatePct())));
        e.appendChild(stringProp(doc, "error_rate_length", String.valueOf(a.errorRateSec())));
        e.appendChild(stringProp(doc, "avg_response_time", String.valueOf(a.avgResponseMs())));
        e.appendChild(stringProp(doc, "avg_response_time_length", String.valueOf(a.avgResponseSec())));
        e.appendChild(stringProp(doc, "avg_response_latency", "0"));
        e.appendChild(stringProp(doc, "avg_response_latency_length", "0"));
        e.appendChild(stringProp(doc, "percentile_response_time", "0"));
        e.appendChild(stringProp(doc, "percentile_response_time_secs", "0"));
        // поля перцентиля не используем в UI — валидные значения по умолчанию,
        // иначе плагин пишет ошибку парсинга при старте теста
        e.appendChild(stringProp(doc, "percentile_value", "100"));
        e.appendChild(stringProp(doc, "custom_validation_duration", "1"));
        return e;
    }

    private Element randomCsvDataSet(Document doc, Dataset ds) {
        Element e = testElement(doc, "com.blazemeter.jmeter.RandomCSVDataSetConfig",
                "com.blazemeter.jmeter.RandomCSVDataSetConfigGui",
                "com.blazemeter.jmeter.RandomCSVDataSetConfig",
                "bzm - Random CSV Data Set: " + ds.name());
        e.appendChild(stringProp(doc, "filename", ds.fileName()));
        e.appendChild(stringProp(doc, "fileEncoding", "UTF-8"));
        e.appendChild(stringProp(doc, "delimiter", ","));
        e.appendChild(stringProp(doc, "variableNames", String.join(",", ds.columns())));
        e.appendChild(boolProp(doc, "randomOrder", true));
        // Первая строка CSV — заголовки колонок (как в портале / k6).
        e.appendChild(boolProp(doc, "ignoreFirstLine", true));
        e.appendChild(boolProp(doc, "rewindOnTheEndOfList", true));
        e.appendChild(boolProp(doc, "independentListPerThread", false));
        return e;
    }

    private Element csvDataSet(Document doc, Dataset ds) {
        Element e = testElement(doc, "CSVDataSet", "TestBeanGUI", "CSVDataSet",
                "CSV Data Set: " + ds.name());
        e.appendChild(stringProp(doc, "delimiter", ","));
        e.appendChild(stringProp(doc, "fileEncoding", "UTF-8"));
        e.appendChild(stringProp(doc, "filename", ds.fileName()));
        // Первая строка CSV — заголовки колонок (как в портале / k6).
        e.appendChild(boolProp(doc, "ignoreFirstLine", true));
        e.appendChild(stringProp(doc, "variableNames", String.join(",", ds.columns())));
        e.appendChild(boolProp(doc, "quotedData", false));
        e.appendChild(boolProp(doc, "recycle", true));
        e.appendChild(stringProp(doc, "shareMode", "shareMode.all"));
        e.appendChild(boolProp(doc, "stopThread", false));
        return e;
    }

    // --- Рендеринг значений параметров -------------------------------------------

    private String effectivePath(Request req, UrlParts base) {
        String path = renderPathParams(req, req.path() == null ? "/" : req.path());
        String basePath = base.basePath == null ? "" : base.basePath;
        if (!basePath.isEmpty() && !path.startsWith(basePath)) {
            path = basePath + path;
        }
        return path;
    }

    /** Подставляет path-параметры {name} в шаблон пути. */
    private String renderPathParams(Request req, String template) {
        String path = template == null || template.isEmpty() ? "/" : template;
        for (Param p : req.params()) {
            if (p.location() == ParamLocation.PATH) {
                path = replacePlaceholder(path, p.name(), render(p.source(), p.name()));
            }
        }
        return path;
    }

    /** Подставляет body-параметры {name} в тело запроса ({name}, но не ${name}). */
    private String effectiveBody(Request req) {
        String content = req.body().content();
        for (Param p : req.params()) {
            if (p.location() == ParamLocation.BODY) {
                content = replacePlaceholder(content, p.name(), render(p.source(), p.name()));
            }
        }
        return content;
    }

    /** Замена {name} → value, не трогая JMeter-переменные ${name}. */
    private static String replacePlaceholder(String text, String name, String value) {
        if (text == null || name == null || name.isBlank()) return text;
        return text.replaceAll(
                "(?<!\\$)\\{" + java.util.regex.Pattern.quote(name) + "\\}",
                java.util.regex.Matcher.quoteReplacement(value == null ? "" : value));
    }

    private List<KeyValue> effectiveHeaders(Request req) {
        Map<String, String> byName = new LinkedHashMap<>();
        for (KeyValue h : req.headers()) {
            byName.put(h.key(), h.value() == null ? "" : h.value());
        }
        for (Param p : req.params()) {
            if (p.location() == ParamLocation.HEADER) {
                byName.put(p.name(), render(p.source(), p.name()));
            }
        }
        return byName.entrySet().stream()
                .filter(en -> en.getKey() != null && !en.getKey().isEmpty())
                .map(en -> new KeyValue(en.getKey(), en.getValue()))
                .collect(Collectors.toList());
    }

    private void appendCounters(Document doc, Element ctgChildren, ScenarioGrouping.Group grp) {
        LinkedHashMap<String, Generator> counters = new LinkedHashMap<>();
        for (Request req : grp.requests()) {
            for (Param p : req.params()) {
                if (p.source() instanceof ParamSource.GeneratorRef g
                        && g.generator() != null
                        && g.generator().type() == GeneratorType.COUNTER
                        && p.name() != null
                        && !p.name().isBlank()) {
                    counters.putIfAbsent(p.name(), g.generator());
                }
            }
        }
        for (Map.Entry<String, Generator> e : counters.entrySet()) {
            appendWithHashTree(doc, ctgChildren, counterConfig(doc, e.getKey(), e.getValue()));
        }
    }

    private Element counterConfig(Document doc, String name, Generator g) {
        Element e = testElement(doc, "CounterConfig", "CounterConfigGui", "CounterConfig", name);
        e.appendChild(stringProp(doc, "CounterConfig.start", String.valueOf(or(g.start(), 1))));
        int end = g.max() == null ? 0 : g.max();
        e.appendChild(stringProp(doc, "CounterConfig.end", end > 0 ? String.valueOf(end) : ""));
        e.appendChild(stringProp(doc, "CounterConfig.incr", String.valueOf(or(g.increment(), 1))));
        e.appendChild(stringProp(doc, "CounterConfig.name", name));
        e.appendChild(stringProp(doc, "CounterConfig.format", g.format() == null ? "" : g.format()));
        e.appendChild(boolProp(doc, "CounterConfig.per_user", true));
        e.appendChild(boolProp(doc, "CounterConfig.reset_on_tg_iteration", false));
        return e;
    }

    private String render(ParamSource source, String name) {
        if (source == null) return "";
        if (source instanceof ParamSource.Constant c) {
            return c.value() == null ? "" : c.value();
        }
        if (source instanceof ParamSource.Correlation c) {
            return "${" + c.variable() + "}";
        }
        if (source instanceof ParamSource.Csv c) {
            return "${" + c.column() + "}";
        }
        if (source instanceof ParamSource.GeneratorRef g) {
            return renderGenerator(g.generator(), name);
        }
        return "";
    }

    private String renderGenerator(Generator g, String name) {
        if (g == null || g.type() == null) return "";
        return switch (g.type()) {
            case UUID -> "${__UUID()}";
            case RANDOM_INT -> "${__Random(" + or(g.min(), 0) + "," + or(g.max(), 1000000) + ")}";
            case RANDOM_STRING -> "${__RandomString(" + or(g.length(), 8) + ","
                    + (g.chars() == null ? "abcdefghijklmnopqrstuvwxyz0123456789" : g.chars()) + ")}";
            case COUNTER -> "${" + name + "}";
            case TIMESTAMP -> "${__time(" + (g.format() == null ? "" : g.format()) + ")}";
        };
    }

    // --- Низкоуровневые помощники DOM --------------------------------------------

    private Element appendWithHashTree(Document doc, Element parentHashTree, Element element) {
        parentHashTree.appendChild(element);
        Element hashTree = el(doc, "hashTree");
        parentHashTree.appendChild(hashTree);
        return hashTree;
    }

    private Element testElement(Document doc, String tag, String guiclass, String testclass, String testname) {
        Element e = doc.createElement(tag);
        if (guiclass != null) e.setAttribute("guiclass", guiclass);
        if (testclass != null) e.setAttribute("testclass", testclass);
        if (testname != null) e.setAttribute("testname", testname);
        e.setAttribute("enabled", "true");
        return e;
    }

    private Element emptyHttpArguments(Document doc) {
        Element args = doc.createElement("elementProp");
        args.setAttribute("name", "HTTPsampler.Arguments");
        args.setAttribute("elementType", "Arguments");
        args.setAttribute("guiclass", "HTTPArgumentsPanel");
        args.setAttribute("testclass", "Arguments");
        args.setAttribute("testname", "User Defined Variables");
        args.setAttribute("enabled", "true");
        args.appendChild(collectionProp(doc, "Arguments.arguments"));
        return args;
    }

    private Element el(Document doc, String tag) {
        return doc.createElement(tag);
    }

    private Element stringProp(Document doc, String name, String value) {
        Element e = doc.createElement("stringProp");
        e.setAttribute("name", name);
        e.setTextContent(value == null ? "" : value);
        return e;
    }

    private Element boolProp(Document doc, String name, boolean value) {
        Element e = doc.createElement("boolProp");
        e.setAttribute("name", name);
        e.setTextContent(String.valueOf(value));
        return e;
    }

    private Element intProp(Document doc, String name, int value) {
        Element e = doc.createElement("intProp");
        e.setAttribute("name", name);
        e.setTextContent(String.valueOf(value));
        return e;
    }

    private Element collectionProp(Document doc, String name) {
        Element e = doc.createElement("collectionProp");
        e.setAttribute("name", name);
        return e;
    }

    private String serialize(Document doc) throws Exception {
        Transformer t = TransformerFactory.newInstance().newTransformer();
        t.setOutputProperty(OutputKeys.INDENT, "yes");
        t.setOutputProperty(OutputKeys.ENCODING, "UTF-8");
        t.setOutputProperty("{http://xml.apache.org/xslt}indent-amount", "2");
        StringWriter sw = new StringWriter();
        t.transform(new DOMSource(doc), new StreamResult(sw));
        return sw.toString();
    }

    private static int or(Integer v, int def) {
        return v == null ? def : v;
    }

    private static String num(double v) {
        if (v == Math.rint(v)) {
            return String.valueOf((long) v);
        }
        return String.valueOf(Math.round(v * 1000.0) / 1000.0);
    }

    private record UrlParts(String protocol, String host, String port, String basePath) {
        static UrlParts parse(String baseUrl) {
            if (baseUrl == null || baseUrl.isBlank()) {
                return new UrlParts("", "", "", "");
            }
            try {
                URI uri = URI.create(baseUrl.trim());
                String proto = uri.getScheme() == null ? "" : uri.getScheme();
                String host = uri.getHost() == null ? "" : uri.getHost();
                String port = uri.getPort() == -1 ? "" : String.valueOf(uri.getPort());
                String path = uri.getPath() == null ? "" : uri.getPath();
                if (path.endsWith("/")) path = path.substring(0, path.length() - 1);
                return new UrlParts(proto, host, port, path);
            } catch (Exception e) {
                return new UrlParts("", "", "", "");
            }
        }

        /**
         * Разбор без java.net.URI — переносит {param} и query в path без ошибок.
         * Нужен для собственных URL запросов, где путь может содержать {…}.
         */
        static UrlParts parseLenient(String url) {
            if (url == null || url.isBlank()) {
                return new UrlParts("", "", "", "");
            }
            String s = url.trim();
            String proto = "";
            int schemeIdx = s.indexOf("://");
            if (schemeIdx >= 0) {
                proto = s.substring(0, schemeIdx);
                s = s.substring(schemeIdx + 3);
            }
            int slash = s.indexOf('/');
            String authority = slash >= 0 ? s.substring(0, slash) : s;
            String path = slash >= 0 ? s.substring(slash) : "/";
            String host = authority;
            String port = "";
            int colon = authority.lastIndexOf(':');
            if (colon >= 0) {
                host = authority.substring(0, colon);
                port = authority.substring(colon + 1);
            }
            return new UrlParts(proto, host, port, path);
        }
    }

    static class JmxBuildException extends RuntimeException {
        JmxBuildException(String message, Throwable cause) {
            super(message, cause);
        }
        JmxBuildException(String message) {
            super(message);
        }
    }
}
