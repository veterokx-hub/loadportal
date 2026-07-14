package com.loadtest.constructor.model;

/**
 * Настройки AutoStop Listener (плагин jpgc-autostop).
 * Останавливает тест при превышении порогов — полезно для «поиска максимума».
 * Значение 0 в пороге отключает соответствующий критерий.
 */
public record AutoStop(
        boolean enabled,
        double errorRatePct,     // % ошибок
        int errorRateSec,        // ...удерживается N секунд
        int avgResponseMs,       // средний отклик, мс
        int avgResponseSec       // ...удерживается N секунд
) {
    public static AutoStop disabled() {
        return new AutoStop(false, 0, 0, 0, 0);
    }
}
