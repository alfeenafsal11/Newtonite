FROM node:22.12.0-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22.12.0-bookworm-slim AS final
WORKDIR /app
ENV NODE_ENV=production

# Install PostgreSQL server & contrib extensions (pg_trgm) for self-contained execution
RUN apt-get update && \
    apt-get install -y --no-install-recommends postgresql postgresql-contrib ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
RUN npm ci --omit=dev

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY scripts ./scripts
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000 7860

ENTRYPOINT ["/app/docker-entrypoint.sh"]
