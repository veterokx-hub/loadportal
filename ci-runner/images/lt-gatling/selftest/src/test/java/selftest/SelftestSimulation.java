package selftest;

import static io.gatling.javaapi.core.CoreDsl.atOnceUsers;
import static io.gatling.javaapi.core.CoreDsl.scenario;

import io.gatling.javaapi.core.Simulation;
import java.time.Duration;

/** Симуляция без сети: проверяет, что компиляция, запуск и отчёт работают офлайн. */
public class SelftestSimulation extends Simulation {
    {
        setUp(scenario("selftest").pause(Duration.ofMillis(100)).injectOpen(atOnceUsers(1)));
    }
}
