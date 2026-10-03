# syntax=docker/dockerfile:1.7
# lt-k6: статический бинарь k6 из официального образа поверх lt-base.
# Taurus здесь не участвует: bzt 1.17.1 запускает k6 с --iterations 1, что
# отбрасывает options.scenarios портала, и игнорирует проваленные thresholds.
ARG K6_IMAGE
ARG LT_BASE_IMAGE
FROM ${K6_IMAGE} AS k6

FROM ${LT_BASE_IMAGE}
COPY --from=k6 /usr/bin/k6 /usr/local/bin/k6
