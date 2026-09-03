#!/usr/bin/env bun

// VA-ORM CLI Runner
// Usage: va <command> [options]

import { validateCommand } from '../src/commands/validate.command.js'
import { generateCommand } from '../src/commands/generate.command.js'
import { migrateCommand } from '../src/commands/migrate.command.js'

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

  Examples:
    va validate
    va validate --schema ./my-schema.prisma
    va generate --output ./src/generated --sql
    va migrate up
    va migrate down --steps 3
    va migrate status
    va migrate create add_users_table
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
      if (!subcommand || !['up', 'down', 'status', 'reset', 'create'].includes(subcommand)) {
        console.error('\x1b[31mError: migrate requires a subcommand (up, down, status, reset, create)\x1b[0m')
        showHelp()
        process.exit(1)
      }

      const steps = getArg('--steps') ? parseInt(getArg('--steps')!) : undefined
      const name = subcommand === 'create' ? args[2] : undefined

      await migrateCommand({
        command: subcommand as 'up' | 'down' | 'status' | 'reset' | 'create',
        steps,
        name,
      })
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
