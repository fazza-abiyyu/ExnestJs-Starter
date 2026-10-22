# va-orm-http-e2e

Proyek konsumen **terisolasi** untuk menguji konektor HTTP VA-ORM.

```ts
import { VaClient } from '@v-va/orm';   // dari tarball, bukan dari source repo
```

Dependency `@v-va/orm` menunjuk ke `file:../packs/v-va-orm-<versi>-local.tgz`
(dihasilkan `../pack-orm.sh`). Tidak ada import dari `engine/va-orm/src`.

## Test

```sh
bun test                        # semua
bun test test/memory-http.test.ts   # backend in-memory (tanpa database)
bun test test/postgres-http.test.ts # backend PostgreSQL asli
```

Butuh PostgreSQL lokal untuk test postgres:

```sh
createdb va_orm_http_e2e
# atau override:
DATABASE_URL=postgres://user:pass@localhost:5432/va_orm_http_e2e bun test
```
