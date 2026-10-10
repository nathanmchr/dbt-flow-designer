#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_ROOT="${PROJECT_ROOT}/.local/postgres"
PG_DATA="${PG_ROOT}/data"
PG_LOG="${PG_ROOT}/postgres.log"
PG_SOCKET="/tmp/dbt-flow-designer-pg"
PG_PORT="5432"
DATABASE_NAME="dbt_flow_test"
SEED_FILE="${PROJECT_ROOT}/backend/sql/local_test_seed.sql"

if [[ -x "/opt/homebrew/opt/postgresql@15/bin/postgres" ]]; then
  PG_BIN="/opt/homebrew/opt/postgresql@15/bin"
elif command -v postgres >/dev/null 2>&1; then
  PG_BIN="$(dirname "$(command -v postgres)")"
else
  echo "PostgreSQL server binaries were not found. Install PostgreSQL 15 first." >&2
  exit 1
fi

initialize_cluster() {
  if [[ -f "${PG_DATA}/PG_VERSION" ]]; then
    return
  fi

  mkdir -p "${PG_ROOT}" "${PG_SOCKET}"
  "${PG_BIN}/initdb" \
    --pgdata="${PG_DATA}" \
    --auth-local=trust \
    --auth-host=scram-sha-256 \
    --no-locale \
    --encoding=UTF8
}

start_server() {
  initialize_cluster
  mkdir -p "${PG_SOCKET}"

  if "${PG_BIN}/pg_ctl" --pgdata="${PG_DATA}" status >/dev/null 2>&1; then
    return
  fi

  "${PG_BIN}/pg_ctl" \
    --pgdata="${PG_DATA}" \
    --log="${PG_LOG}" \
    --options="-p ${PG_PORT} -h 127.0.0.1 -k ${PG_SOCKET}" \
    --wait start
}

setup_database() {
  start_server

  if ! "${PG_BIN}/psql" \
    --host="${PG_SOCKET}" \
    --port="${PG_PORT}" \
    --dbname=postgres \
    --tuples-only \
    --no-align \
    --command="SELECT 1 FROM pg_database WHERE datname = '${DATABASE_NAME}'" \
    | tr -d '[:space:]' | grep -qx 1; then
    "${PG_BIN}/createdb" \
      --host="${PG_SOCKET}" \
      --port="${PG_PORT}" \
      "${DATABASE_NAME}"
  fi

  "${PG_BIN}/psql" \
    --host="${PG_SOCKET}" \
    --port="${PG_PORT}" \
    --dbname="${DATABASE_NAME}" \
    --file="${SEED_FILE}"
}

stop_server() {
  if [[ ! -f "${PG_DATA}/PG_VERSION" ]]; then
    echo "Local PostgreSQL test instance is not initialized."
    return
  fi

  if "${PG_BIN}/pg_ctl" --pgdata="${PG_DATA}" status >/dev/null 2>&1; then
    "${PG_BIN}/pg_ctl" --pgdata="${PG_DATA}" --wait stop
  else
    echo "Local PostgreSQL test instance is already stopped."
  fi
}

show_status() {
  if [[ ! -f "${PG_DATA}/PG_VERSION" ]]; then
    echo "Local PostgreSQL test instance is not initialized."
    exit 1
  fi
  "${PG_BIN}/pg_ctl" --pgdata="${PG_DATA}" status
}

case "${1:-}" in
  setup)
    setup_database
    ;;
  start)
    start_server
    ;;
  stop)
    stop_server
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: $0 {setup|start|stop|status}" >&2
    exit 1
    ;;
esac
