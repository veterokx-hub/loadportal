FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Пустое значение = same-origin (/api через Ingress). Локально: http://localhost:8080
ARG NEXT_PUBLIC_CORE_API_BASE_URL=http://localhost:8080
ENV NEXT_PUBLIC_CORE_API_BASE_URL=$NEXT_PUBLIC_CORE_API_BASE_URL
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
