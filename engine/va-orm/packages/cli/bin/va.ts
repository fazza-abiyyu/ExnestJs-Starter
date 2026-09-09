#!/usr/bin/env bun

// VA-ORM CLI Runner
// Usage: va <command> [options]

import { validateCommand } from '../src/commands/validate.command.js'
import { generateCommand } from '../src/commands/generate.command.js'
import { migrateCommand } from '../src/commands/migrate.command.js'
import { pushCommand } from '../src/commands/push.command.js'
import { pullCommand } from '../src/commands/pull.command.js'

const args = process.argv.slice(2)
const command = args[0]

function showHelp() {
  console.log(`
  🦊 VA-ORM CLI

  Usage:
    va validate [options]              Validate schema file
    va generate [options]              Generate types, client, SQL
    va migrate <command> [options]     Run migrations

  Commands:
    validate                           Validate va.schema
      --schema <path>                  Schema file path (default: va.schema)

    generate                           Generate code from schema
      --schema <path>                  Schema file path (default: va.schema)
      --output <path>                  Output directory (default: ./generated)
      --sql                            Also generate schema.sql

    migrate                            Run database migrations
      up                               Apply pending migrations
      down                             Rollback last migration
      down --steps <n>                 Rollback N migrations
      status                           Show migration status
      reset                            Rollback all migrations
      create <name>                    Create new migration
      dev <name>                       Create + apply migration
      resolve <name> --to <state>      Mark migration applied|rolled-back

    db                                 Direct database commands
      push                             Push va.schema DDL directly
      pull                             Introspect database to schema

  Examples:
    va validate
    va validate --schema ./my-schema.prisma
    va generate --output ./src/generated --sql
    va migrate up
    va migrate down --steps 3
    va migrate status
    va migrate create add_users_table
    va migrate dev add_users_table
    va migrate resolve 20240101_x --to applied
    va db push
    va db pull --output ./va.pulled.schema
  `)
}

async function main() {
  if (!command || command === '--help' || command === '-h') {
    showHelp()
    return
  }

  switch (command) {
    case 'validate': {
      const schema = getArg('--schema')
      await validateCommand({ schema })
      break
    }

    case 'generate': {
      const schema = getArg('--schema')
      const output = getArg('--output')
      const sql = hasFlag('--sql')
      await generateCommand({ schema, output, sql })
      break
    }

    case 'migrate': {
      const subcommand = args[1]
      if (!subcommand || !['up', 'down', 'status', 'reset', 'create', 'dev', 'resolve'].includes(subcommand)) {
        console.error('\x1b[31mError: migrate requires a subcommand (up, down, status, reset, create, dev, resolve)\x1b[0m')
        showHelp()
        process.exit(1)
      }

      const steps = getArg('--steps') ? parseInt(getArg('--steps')!) : undefined
      const name = ['create', 'dev', 'resolve'].includes(subcommand) ? args[2] : undefined
      const to = getArg('--to') as 'applied' | 'rolled-back' | undefined

      await migrateCommand({
        command: subcommand as 'up' | 'down' | 'status' | 'reset' | 'create' | 'dev' | 'resolve',
        steps,
        name,
        to,
      })
      break
    }

    case 'db': {
      const subcommand = args[1]
      if (subcommand === 'push') {
        await pushCommand({ schema: getArg('--schema') })
      } else if (subcommand === 'pull') {
        const schemas = getArg('--schemas')?.split(',').map((s) => s.trim()).filter(Boolean)
        await pullCommand({ output: getArg('--output'), schemas })
      } else {
        console.error('\x1b[31mError: db requires a subcommand (push, pull)\x1b[0m')
        showHelp()
        process.exit(1)
      }
      break
    }

    default:
      console.error(`\x1b[31mUnknown command: ${command}\x1b[0m`)
      showHelp()
      process.exit(1)
  }
}

function getArg(flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  return args[index + 1]
}

function hasFlag(flag: string): boolean {
  return args.includes(flag)
}

main().catch((error) => {
  console.error('\x1b[31mError:\x1b[0m', error)
  process.exit(1)
})
