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
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
RUN npm ci --omit=dev
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
COPY --from=build /app/apps/web/dist ./apps/web/dist
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
