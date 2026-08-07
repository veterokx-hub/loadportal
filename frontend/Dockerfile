FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM node:20-alpine AS build
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

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Без HOSTNAME standalone-сервер слушает только IPv6 — healthcheck/probe по 127.0.0.1 падает.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
