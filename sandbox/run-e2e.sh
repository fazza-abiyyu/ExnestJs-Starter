#!/usr/bin/env bash
#
# Jalankan E2E terisolasi untuk konektor HTTP VA-ORM.
#
#   ./sandbox/run-e2e.sh            # semua (butuh PostgreSQL lokal)
#   ./sandbox/run-e2e.sh memory     # hanya backend in-memory (tanpa DB)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-all}"
export DATABASE_URL="${DATABASE_URL:-postgres://localhost:5432/va_orm_http_e2e}"

echo "==> pack ORM -> tarball -> install ke project e2e"
"$ROOT/sandbox/pack-orm.sh"

cd "$ROOT/sandbox/va-orm-http-e2e"

if [ "$MODE" = "memory" ]; then
  echo "==> e2e (backend in-memory)"
  bun test test/memory-http.test.ts
  bun test test/crud-logic-http.test.ts
  exit 0
fi

echo "==> e2e (backend in-memory)"
bun test test/memory-http.test.ts
bun test test/crud-logic-http.test.ts

echo "==> e2e (backend PostgreSQL asli)"
E2E_BACKEND=postgres bun test test/crud-logic-http.test.ts
bun test test/postgres-http.test.ts

echo "==> e2e (DB remote sungguhan — skip kalau env tidak ada)"
bun test test/remote-http.test.ts

echo "==> e2e (cli db push + role split DDL/DML)"
bun test test/cli-db-push.test.ts
