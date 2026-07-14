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

            appendWithHashTree(doc, testPlanChildren, prometheusBackendListener(doc, scenario));

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
            appendQueryArgument(doc, coll, qp.name(), render(qp.source()));
        }
        if (rawBody) {
            appendBodyArgument(doc, coll, req.body().content());
        }
        e.appendChild(args);

        e.appendChild(stringProp(doc, "HTTPSampler.domain", ""));
        e.appendChild(stringProp(doc, "HTTPSampler.port", ""));
        e.appendChild(stringProp(doc, "HTTPSampler.protocol", ""));
        e.appendChild(stringProp(doc, "HTTPSampler.contentEncoding", ""));
        e.appendChild(stringProp(doc, "HTTPSampler.path", effectivePath(req, base)));
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

    private Element prometheusBackendListener(Document doc, Scenario scenario) {
        PrometheusConfig p = scenario.prometheus();
        String testName = scenario.name() == null || scenario.name().isBlank() ? "scenario" : scenario.name();

        Element e = testElement(doc, "BackendListener", "BackendListenerGui",
                "BackendListener", "Prometheus (Kolesnikov)");
        e.appendChild(stringProp(doc, "classname", "com.github.kolesnikovm.PrometheusListener"));

        Element args = doc.createElement("elementProp");
        args.setAttribute("name", "arguments");
        args.setAttribute("elementType", "Arguments");
        args.setAttribute("guiclass", "ArgumentsPanel");
        args.setAttribute("testclass", "Arguments");
        args.setAttribute("testname", "Arguments");
        args.setAttribute("enabled", "true");
        Element coll = collectionProp(doc, "Arguments.arguments");

        addBackendArg(doc, coll, "testName", testName);
        addBackendArg(doc, coll, "runId", p.runId() == null ? "1" : p.runId());
        addBackendArg(doc, coll, "exporterPort", String.valueOf(p.exporterPort()));
        addBackendArg(doc, coll, "samplersRegExp", p.samplersRegExp() == null ? ".*" : p.samplersRegExp());
        addBackendArg(doc, coll, "sloLevels", p.sloLevels() == null ? "0.1;1" : p.sloLevels());

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
        e.appendChild(boolProp(doc, "ignoreFirstLine", false));
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
        e.appendChild(boolProp(doc, "ignoreFirstLine", false));
        e.appendChild(stringProp(doc, "variableNames", String.join(",", ds.columns())));
        e.appendChild(boolProp(doc, "quotedData", false));
        e.appendChild(boolProp(doc, "recycle", true));
        e.appendChild(stringProp(doc, "shareMode", "shareMode.all"));
        e.appendChild(boolProp(doc, "stopThread", false));
        return e;
    }

    // --- Рендеринг значений параметров -------------------------------------------

    private String effectivePath(Request req, UrlParts base) {
        String path = req.path() == null ? "/" : req.path();
        for (Param p : req.params()) {
            if (p.location() == ParamLocation.PATH) {
                path = path.replace("{" + p.name() + "}", render(p.source()));
            }
        }
        String basePath = base.basePath == null ? "" : base.basePath;
        if (!basePath.isEmpty() && !path.startsWith(basePath)) {
            path = basePath + path;
        }
        return path;
    }

    private List<KeyValue> effectiveHeaders(Request req) {
        Map<String, String> byName = new LinkedHashMap<>();
        for (KeyValue h : req.headers()) {
            byName.put(h.key(), h.value() == null ? "" : h.value());
        }
        for (Param p : req.params()) {
            if (p.location() == ParamLocation.HEADER) {
                byName.put(p.name(), render(p.source()));
            }
        }
        return byName.entrySet().stream()
                .filter(en -> en.getKey() != null && !en.getKey().isEmpty())
                .map(en -> new KeyValue(en.getKey(), en.getValue()))
                .collect(Collectors.toList());
    }

    private String render(ParamSource source) {
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
            return renderGenerator(g.generator());
        }
        return "";
    }

    private String renderGenerator(Generator g) {
        if (g == null || g.type() == null) return "";
        return switch (g.type()) {
            case UUID -> "${__UUID()}";
            case RANDOM_INT -> "${__Random(" + or(g.min(), 0) + "," + or(g.max(), 1000000) + ")}";
            case RANDOM_STRING -> "${__RandomString(" + or(g.length(), 8) + ","
                    + (g.chars() == null ? "abcdefghijklmnopqrstuvwxyz0123456789" : g.chars()) + ")}";
            case COUNTER -> "${__counter(FALSE)}";
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
