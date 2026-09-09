# Relations

Relasi antar model ala Prisma: `include`, filter relasi, dan nested writes.

## Setup

Teruskan `schema` ke `VaClient` agar registry relasi dibangun otomatis:

```typescript
import { VaClient } from '@exnest/va'
import { SchemaParser } from '@exnest/va-schema'
import * as fs from 'fs/promises'

const ast = new SchemaParser().parse(await fs.readFile('va.schema', 'utf-8'))

const client = VaClient.create({
  driver: 'postgres',
  dsn: process.env.DATABASE_URL,
  schema: ast,
  modelOptions: {
    User: { tableName: 'identity.users' },
  },
})
```

## Include

```typescript
const users = await client.model('User').findMany({
  include: { posts: true },
})
// [{ id: 1, name: 'John', posts: [{ id: 10, title: 'A' }] }]

// Nested include + filter di relasi
const users = await client.model('User').findMany({
  include: {
    posts: {
      where: { title: { contains: 'A' } },
      orderBy: { title: 'desc' },
      take: 5,
      include: { tags: true },
    },
  },
})
```

Strategi: 1 query utama + 1 query per level relasi (tanpa N+1, tanpa fan-out).

## Select Projection

```typescript
const users = await client.model('User').findMany({
  select: ['name', 'email'],
})
// [{ name: 'John', email: 'john@x.com' }]
// SQL: SELECT "name", "email", "id" FROM "users"

// select di dalam include (nested juga bisa)
const users = await client.model('User').findMany({
  include: {
    posts: { select: ['title'] },
  },
})
// [{ ..., posts: [{ title: 'A' }] }]
```

Primary key dan FK yang dibutuhkan untuk mapping ikut di-fetch otomatis
lalu di-strip dari hasil, jadi output sesuai `select` yang diminta.

## Where Prisma-style

```typescript
await client.model('User').findMany({
  where: {
    status: 'active',
    age: { gte: 18, lt: 65 },
    name: { contains: 'Jo' },
    role: { in: ['admin', 'mod'] },
    deletedAt: null,
    AND: [{ status: 'a' }],
    OR: [{ status: 'a' }, { status: 'b' }],
    NOT: { status: 'c' },
  },
})
```

Operator: `equals`, `not`, `in`, `notIn`, `lt`, `lte`, `gt`, `gte`,
`contains`, `startsWith`, `endsWith` (+ `mode: 'insensitive'` → `ILIKE`).

## Relation Filters

```typescript
// Punya minimal 1 post published
{ posts: { some: { title: 'Hello' } } }

// Semua post published
{ posts: { every: { title: 'Pub' } } }

// Tidak punya post draft
{ posts: { none: { title: 'Draft' } } }

// Relasi 1:1 cocok
{ profile: { is: { bio: 'Hi' } } }

// Relasi 1:1 tidak cocok (termasuk yang null)
{ profile: { isNot: { bio: 'Hi' } } }
```

Di SQL menjadi `EXISTS` / `NOT EXISTS` subquery.

## Nested Writes

Semua dijalankan atomik dalam transaksi:

```typescript
// Create + nested create
await client.model('User').create({
  data: { name: 'John', posts: { create: [{ title: 'A' }] } },
})

// Connect ke record yang ada
await client.model('User').create({
  data: { name: 'John', posts: { connect: [{ id: 10 }] } },
})

// Connect atau create
await client.model('User').create({
  data: {
    name: 'John',
    posts: { connectOrCreate: { where: { id: 10 }, create: { title: 'A' } } },
  },
})

// Disconnect / set / nested update
await client.model('User').update({
  where: { id: 1 },
  data: {
    posts: {
      disconnect: [{ id: 10 }],
      set: [{ id: 11 }],
      update: { where: { id: 11 }, data: { title: 'New' } },
    },
  },
})
```

## Schema Relasi

```prisma
model User {
  id    String @id @default(uuid())
  posts Post[]
}

model Post {
  id     String @id @default(uuid())
  userId String
  author User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// Named relation
model Post {
  authorId String
  editorId String?
  author   User  @relation("Author", fields: [authorId], references: [id])
  editor   User? @relation("Editor", fields: [editorId], references: [id])
}

// Self-relation
model User {
  parentId String?
  parent   User?  @relation("Tree", fields: [parentId], references: [id])
  children User[] @relation("Tree")
}

// Implicit M:N (join table _PostToTag otomatis)
model Post {
  tags Tag[]
}

model Tag {
  posts Post[]
}
```

## Identifier Quoting

Semua identifier di layer relasi di-quote (`"userId"`, `"identity"."users"`)
agar kolom camelCase aman di PostgreSQL. MySQL memakai backtick otomatis.
