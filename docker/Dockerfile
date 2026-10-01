# Builds toadsbank-api and toadsbank-worker: docker build --target api|worker -f docker/Dockerfile .
FROM node:22.12.0-alpine3.21 AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/application/package.json packages/application/
COPY packages/adapters/postgres/package.json packages/adapters/postgres/
COPY packages/adapters/http/package.json packages/adapters/http/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
RUN npm ci --ignore-scripts
COPY packages packages
COPY apps apps
RUN npm run build -w @toadsbank/api && npm run build -w @toadsbank/worker

# Runtime: the self-contained bundle only. No npm, no sources, no node_modules.
FROM node:22.12.0-alpine3.21 AS base
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
ENV NODE_ENV=production
USER node

FROM base AS api
COPY --from=build /src/apps/api/dist/main.mjs ./main.mjs
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
ENTRYPOINT ["node", "main.mjs"]

FROM base AS worker
COPY --from=build /src/apps/worker/dist/main.mjs ./main.mjs
ENTRYPOINT ["node", "main.mjs"]
