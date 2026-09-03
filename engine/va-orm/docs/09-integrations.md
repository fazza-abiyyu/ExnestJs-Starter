# Framework Integrations

Integrasi dengan NestJS dan Elysia.

## NestJS Integration

### VaModule

NestJS DynamicModule untuk dependency injection.

#### forRoot (Sync)

```typescript
import { Module } from '@nestjs/common'
import { VaModule } from '@exnest/va/nest'

@Module({
  imports: [
    VaModule.forRoot({
      driver: 'postgresql',
      dsn: process.env.DATABASE_URL,
      connection: {
        max: 20,
        min: 5,
        healthCheck: true,
      },
    }),
  ],
})
export class AppModule {}
```

#### forRootAsync (Async)

```typescript
import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { VaModule } from '@exnest/va/nest'

@Module({
  imports: [
    VaModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        driver: config.get('DB_DRIVER'),
        dsn: config.get('DATABASE_URL'),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

### VaService

Injectable service dengan lifecycle hooks.

#### Usage

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { VaService } from '@exnest/va/nest'

@Injectable()
export class UserService implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly va: VaService) {}

  async onModuleInit() {
    // Called when module initializes
    console.log('Database connected')
  }

  async onModuleDestroy() {
    // Called when module destroys
    console.log('Database disconnected')
  }

  async findAll() {
    return this.va.repository('user').findMany()
  }

  async create(data: CreateUserInput) {
    return this.va.repository('user').create(data)
  }

  async rawQuery() {
    return this.va.raw.query('SELECT * FROM users WHERE status = $1', ['active'])
  }
}
```

#### Available Methods

```typescript
@Injectable()
export class VaService {
  // Repository access
  repository<T>(name: string): Repository<T>

  // Raw SQL
  raw: RawQuery

  // Direct query methods
  query<T>(sql: string, params?: any[]): Promise<T[]>
  queryOne<T>(sql: string, params?: any[]): Promise<T | null>
  execute(sql: string, params?: any[]): Promise<{ rowCount: number }>

  // Tagged template
  sql<T>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]>
  sqlOne<T>(strings: TemplateStringsArray, ...values: any[]): Promise<T | null>

  // CTE & Subquery
  cte(): CTEBuilder
  subquery(): SubqueryBuilder

  // Transaction
  transaction<T>(fn: (client: VaClient) => Promise<T>): Promise<T>
}
```

### Complete Example

```typescript
// user.module.ts
import { Module } from '@nestjs/common'
import { VaModule } from '@exnest/va/nest'
import { UserService } from './user.service'
import { UserController } from './user.controller'

@Module({
  imports: [
    VaModule.forRoot({
      driver: 'postgresql',
      dsn: process.env.DATABASE_URL,
    }),
  ],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}

// user.service.ts
import { Injectable } from '@nestjs/common'
import { VaService } from '@exnest/va/nest'

@Injectable()
export class UserService {
  constructor(private readonly va: VaService) {}

  async findAll() {
    return this.va.repository('user').findMany({
      where: (eb) => eb.eq('status', 'active'),
      orderBy: { column: 'createdAt', direction: 'desc' },
    })
  }

  async findById(id: number) {
    return this.va.repository('user').findUnique({ id })
  }

  async create(data: CreateUserInput) {
    return this.va.repository('user').create(data)
  }
}
```

## Elysia Integration

### VaSingleton

Singleton pattern for VaClient.

#### Basic Usage

```typescript
import { VaSingleton } from '@exnest/va/elysia'

const va = VaSingleton.getInstance({
  driver: 'postgresql',
  dsn: process.env.DATABASE_URL,
})

// All VaClient methods are available
const users = await va.repository('user').findMany()
await va.transaction(async (tx) => {
  // ...
})
```

#### Lazy Initialization

```typescript
// First call creates the instance
const va = VaSingleton.getInstance(options)

// Subsequent calls return the same instance
const va2 = VaSingleton.getInstance()
// va === va2
```

### vaPlugin

Elysia plugin with lifecycle hooks.

```typescript
import { Elysia } from 'elysia'
import { vaPlugin } from '@exnest/va/elysia'

const app = new Elysia()
  .use(vaPlugin({
    driver: 'postgresql',
    dsn: process.env.DATABASE_URL,
    connection: {
      max: 20,
      min: 5,
    },
  }))
  .get('/users', async ({ va }) => {
    return va.repository('user').findMany()
  })
  .listen(3000)
```

### Plugin Lifecycle

```typescript
// Plugin automatically handles:
// - onStart: Initializes VaClient and connection pool
// - onEnd: Closes connection pool

const app = new Elysia()
  .use(vaPlugin(options))
  // va is available in all routes
```

### Complete Example

```typescript
import { Elysia } from 'elysia'
import { vaPlugin, VaSingleton } from '@exnest/va/elysia'

const app = new Elysia()
  .use(vaPlugin({
    driver: 'postgresql',
    dsn: process.env.DATABASE_URL,
  }))
  .get('/users', async ({ va }) => {
    const users = await va.repository('user').findMany({
      where: (eb) => eb.eq('status', 'active'),
    })
    return { data: users }
  })
  .get('/users/:id', async ({ va, params }) => {
    const user = await va.repository('user').findUnique({
      id: parseInt(params.id),
    })
    if (!user) {
      return { error: 'User not found' }, 404
    }
    return { data: user }
  })
  .post('/users', async ({ va, body }) => {
    const user = await va.repository('user').create(body)
    return { data: user }, 201
  })
  .listen(3000)

console.log(`Server running at http://localhost:3000`)
```

## Graceful Degradation

Both integrations gracefully degrade when framework packages are not installed:

```typescript
// If @nestjs/common is not installed:
// - VaModule uses no-op decorators
// - VaService works without lifecycle hooks

// If elysia is not installed:
// - VaSingleton works standalone
// - vaPlugin returns a no-op plugin
```

## Error Handling

```typescript
// NestJS
@Injectable()
export class UserService {
  async findAll() {
    try {
      return await this.va.repository('user').findMany()
    } catch (error) {
      // Handle database errors
      throw new BadRequestException('Failed to fetch users')
    }
  }
}

// Elysia
.get('/users', async ({ va }) => {
  try {
    const users = await va.repository('user').findMany()
    return { data: users }
  } catch (error) {
    return { error: 'Database error' }, 500
  }
})
```
