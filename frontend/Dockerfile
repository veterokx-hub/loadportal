FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Пустое значение = same-origin (/api через Next rewrites → constructor/orchestrator).
ARG NEXT_PUBLIC_CORE_API_BASE_URL=
ENV NEXT_PUBLIC_CORE_API_BASE_URL=$NEXT_PUBLIC_CORE_API_BASE_URL
# Destinations для rewrites (next.config.mjs читает при `npm run build`).
ARG CONSTRUCTOR_API_URL=http://constructor:8080
ARG ORCHESTRATOR_API_URL=http://orchestrator:8082
ENV CONSTRUCTOR_API_URL=$CONSTRUCTOR_API_URL
ENV ORCHESTRATOR_API_URL=$ORCHESTRATOR_API_URL
RUN npm run build

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV HOME=/tmp

RUN addgroup -S -g 888 app \
    && adduser -S -u 888 -G app -H -h /tmp -s /sbin/nologin app

COPY --from=build --chown=root:root /app/public ./public
COPY --from=build --chown=root:root /app/.next/standalone ./
COPY --from=build --chown=root:root /app/.next/static ./.next/static

# Next пишет image/fetch cache сюда; исходники остаются root/read-only.
RUN mkdir -p /app/.next/cache \
    && chown 888:888 /app/.next/cache

USER 888:888
EXPOSE 3000
CMD ["node", "server.js"]
