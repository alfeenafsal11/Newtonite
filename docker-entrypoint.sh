#!/usr/bin/env bash
set -e

export PORT="${PORT:-7860}"
export API_PORT="${PORT}"
export NODE_ENV="production"
export JWT_SECRET="${JWT_SECRET:-opsflow_jwt_secret_must_be_at_least_32_characters_super_secure_key}"
export WEB_ORIGIN="${WEB_ORIGIN:-*}"

echo "[OpsFlow Entrypoint] Starting up on PORT=${PORT}..."

# If DATABASE_URL is not set or points to localhost/127.0.0.1, initialize embedded PostgreSQL
if [ -z "$DATABASE_URL" ] || [[ "$DATABASE_URL" == *"localhost"* ]] || [[ "$DATABASE_URL" == *"127.0.0.1"* ]]; then
  echo "[OpsFlow Entrypoint] Starting embedded PostgreSQL service..."
  service postgresql start || /etc/init.d/postgresql start

  # Wait for postgres to be ready
  for i in $(seq 1 30); do
    if su - postgres -c "pg_isready" >/dev/null 2>&1; then
      break
    fi
    echo "[OpsFlow Entrypoint] Waiting for PostgreSQL to accept connections..."
    sleep 1
  done

  # Setup opsflow user and database
  su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='opsflow'\" | grep -q 1 || psql -c \"CREATE USER opsflow WITH PASSWORD 'opsflow' SUPERUSER;\""
  su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='opsflow'\" | grep -q 1 || psql -c \"CREATE DATABASE opsflow OWNER opsflow;\""

  export DATABASE_URL="postgres://opsflow:opsflow@127.0.0.1:5432/opsflow"
fi

echo "[OpsFlow Entrypoint] Applying database migrations..."
npx node-pg-migrate up -m apps/api/migrations --database-url-var DATABASE_URL || true

echo "[OpsFlow Entrypoint] Seeding initial demo accounts..."
npx tsx scripts/seed.ts || true

echo "[OpsFlow Entrypoint] Starting transactional outbox background worker..."
node apps/api/dist/worker/main.js &

echo "[OpsFlow Entrypoint] Starting production HTTP API & Web application..."
exec node apps/api/dist/server.js
