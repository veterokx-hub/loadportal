package com.loadtest.jmeterbuilder.jmx;

import com.loadtest.jmeterbuilder.model.*;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Группировка запросов в тред-группы.
 *
 * Правила:
 *  - запросы, связанные корреляцией (используют ${var}, извлечённую экстрактором
 *    другого запроса), попадают в одну группу;
 *  - запросы с одним и тем же dataset_id попадают в одну группу (единая интенсивность).
 * Одиночный запрос = отдельная группа.
 */
public final class ScenarioGrouping {

    private static final Pattern VAR = Pattern.compile("\\$\\{([a-zA-Z0-9_]+)\\}");

    public record Group(List<Request> requests, Set<String> datasetIds) {
        public Intensity intensity() {
            return requests.get(0).intensity();
        }
        public String name() {
            if (requests.size() == 1) {
                return "TG: " + requests.get(0).name();
            }
            return "TG (journey x" + requests.size() + "): " + requests.get(0).name();
        }
    }

    private ScenarioGrouping() {
    }

    public static List<Group> group(Scenario scenario) {
        List<Request> requests = scenario.requests().stream()
                .sorted(Comparator.comparingInt(Request::order))
                .collect(Collectors.toList());
        if (requests.isEmpty()) {
            return List.of();
        }

        Map<String, Integer> indexById = new HashMap<>();
        for (int i = 0; i < requests.size(); i++) {
            indexById.put(requests.get(i).id(), i);
        }

        UnionFind uf = new UnionFind(requests.size());

        // владельцы переменных экстракторов
        Map<String, Integer> varOwner = new HashMap<>();
        for (int i = 0; i < requests.size(); i++) {
            for (Extraction ex : requests.get(i).extractions()) {
                if (ex.variable() != null && !ex.variable().isBlank()) {
                    varOwner.put(ex.variable(), i);
                }
            }
        }

        // рёбра по корреляции: ${var} в текстовых поверхностях запроса
        for (int i = 0; i < requests.size(); i++) {
            for (String var : referencedVars(requests.get(i))) {
                Integer owner = varOwner.get(var);
                if (owner != null && owner != i) {
                    uf.union(owner, i);
                }
            }
        }

        // рёбра по общему датасету
        Map<String, Integer> firstByDataset = new HashMap<>();
        for (int i = 0; i < requests.size(); i++) {
            String ds = requests.get(i).datasetId();
            if (ds != null && !ds.isBlank()) {
                Integer first = firstByDataset.putIfAbsent(ds, i);
                if (first != null) {
                    uf.union(first, i);
                }
            }
        }

        // собрать компоненты, сохранив порядок
        Map<Integer, List<Request>> comps = new LinkedHashMap<>();
        for (int i = 0; i < requests.size(); i++) {
            comps.computeIfAbsent(uf.find(i), k -> new ArrayList<>()).add(requests.get(i));
        }

        List<Group> groups = new ArrayList<>();
        for (List<Request> members : comps.values()) {
            members.sort(Comparator.comparingInt(Request::order));
            Set<String> dsIds = members.stream()
                    .map(Request::datasetId)
                    .filter(Objects::nonNull)
                    .filter(s -> !s.isBlank())
                    .collect(Collectors.toCollection(LinkedHashSet::new));
            groups.add(new Group(members, dsIds));
        }
        // упорядочить группы по минимальному order участника
        groups.sort(Comparator.comparingInt(g -> g.requests().get(0).order()));
        return groups;
    }

    private static Set<String> referencedVars(Request req) {
        Set<String> vars = new HashSet<>();
        for (KeyValue h : req.headers()) {
            addVars(vars, h.value());
        }
        for (Param p : req.params()) {
            if (p.source() instanceof ParamSource.Correlation c) {
                if (c.variable() != null) vars.add(c.variable());
            } else if (p.source() instanceof ParamSource.Constant cst) {
                addVars(vars, cst.value());
            }
        }
        if (req.body() != null) {
            addVars(vars, req.body().content());
        }
        addVars(vars, req.path());
        return vars;
    }

    private static void addVars(Set<String> vars, String text) {
        if (text == null) return;
        Matcher m = VAR.matcher(text);
        while (m.find()) {
            vars.add(m.group(1));
        }
    }

    private static final class UnionFind {
        private final int[] parent;

        UnionFind(int n) {
            parent = new int[n];
            for (int i = 0; i < n; i++) parent[i] = i;
        }

        int find(int x) {
            while (parent[x] != x) {
                parent[x] = parent[parent[x]];
                x = parent[x];
            }
            return x;
        }

        void union(int a, int b) {
            int ra = find(a), rb = find(b);
            if (ra != rb) parent[ra] = rb;
        }
    }
}
