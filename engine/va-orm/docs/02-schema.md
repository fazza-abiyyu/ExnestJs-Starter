# Schema Definition

Cara mendefinisikan schema dengan `va.schema`.

## Schema Structure

```prisma
// va.schema

generator client {
  provider = "va-client-js"
  output   = "../generated"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  role      Role     @default(USER)
  posts     Post[]
  createdAt DateTime @default(now())

  @@index([email])
  @@map("users")
}

enum Role {
  USER
  ADMIN
}
```

## Blocks

### generator

```prisma
generator client {
  provider = "va-client-js"
  output   = "../generated"
  binaryTargets = ["native", "rhel-openssl-1.0.x"]
}
```

### datasource

```prisma
datasource db {
  provider = "postgresql" | "mysql" | "sqlite"
  url      = env("DATABASE_URL")
}
```

### model

```prisma
model User {
  // Fields
  id    Int    @id @default(autoincrement())
  name  String
  email String @unique

  // Model attributes
  @@index([name, email])
  @@unique([email])
  @@map("users")
}
```

### enum

```prisma
enum Status {
  ACTIVE
  INACTIVE
  DELETED
}
```

## Field Types

| Schema Type | TypeScript | PostgreSQL | MySQL | SQLite |
|-------------|------------|------------|-------|--------|
| `String` | `string` | VARCHAR(255) | VARCHAR(255) | TEXT |
| `Text` | `string` | TEXT | TEXT | TEXT |
| `Int` | `number` | INTEGER | INT | INTEGER |
| `BigInt` | `bigint` | BIGINT | BIGINT | INTEGER |
| `Float` | `number` | FLOAT | FLOAT | REAL |
| `Decimal` | `number` | DECIMAL | DECIMAL | REAL |
| `Boolean` | `boolean` | BOOLEAN | BOOLEAN | INTEGER |
| `DateTime` | `Date` | TIMESTAMP | DATETIME | TEXT |
| `Uuid` | `string` | UUID | VARCHAR(36) | TEXT |
| `Json` | `any` | JSON | JSON | TEXT |
| `Bytes` | `Buffer` | BYTEA | BLOB | BLOB |

## Field Attributes

### @id

```prisma
id Int @id
```

### @default

```prisma
id        Int      @id @default(autoincrement())
uuid      String   @default(uuid())
createdAt DateTime @default(now())
status    String   @default("active")
```

### @unique

```prisma
email String @unique
```

### @relation

```prisma
// Phase 2 feature
userId Int
user   User @relation(fields: [userId], references: [id])
```

### @map

```prisma
firstName String @map("first_name")
```

## Model Attributes

### @@id

```prisma
@@id([latitude, longitude])
```

### @@unique

```prisma
@@unique([firstName, lastName])
```

### @@index

```prisma
@@index([email])
@@index([name, email])
```

### @@map

```prisma
@@map("users")
```

## Field Modifiers

```prisma
name   String    // required
name   String?   // optional
tags   String[]  // array
```

## Parser Output

The `SchemaParser.parse()` method returns a `SchemaAST`:

```typescript
interface SchemaAST {
  generator: GeneratorBlock[]
  datasource: DatasourceBlock[]
  model: ModelBlock[]
  enum: EnumBlock[]
}

interface ModelBlock {
  name: string
  fields: FieldDefinition[]
  attributes: ModelAttribute[]
}

interface FieldDefinition {
  name: string
  type: string
  isArray: boolean
  isOptional: boolean
  attributes: FieldAttribute[]
}
```

## Validation

The `SchemaValidator.validate()` checks:

- Generator must have `provider`
- Datasource must have `provider` and `url`
- Model must have at least one field
- Model should have `@id` field
- Field types must be valid
- No duplicate models or enums
- Relation references must point to existing models
