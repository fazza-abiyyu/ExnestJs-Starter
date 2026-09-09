// VA-ORM CLI - Main Entry Point

export { validateCommand } from './commands/validate.command.js'
export { generateCommand } from './commands/generate.command.js'
export { migrateCommand } from './commands/migrate.command.js'
export { pushCommand } from './commands/push.command.js'
export { pullCommand } from './commands/pull.command.js'
export { SchemaIntrospector } from './introspect/schema.introspector.js'
export { mapColumnType, mapDefault } from './introspect/schema.introspector.js'

export type { ValidateOptions } from './commands/validate.command.js'
export type { GenerateOptions } from './commands/generate.command.js'
export type { MigrateOptions } from './commands/migrate.command.js'
export type { PushOptions } from './commands/push.command.js'
export type { PullOptions } from './commands/pull.command.js'
