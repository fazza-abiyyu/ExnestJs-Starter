// VA-ORM Migrator

import type { DatabaseDriver } from '../core/types.js'
import * as fs from 'fs/promises'
import * as path from 'path'
import { splitSqlStatements } from '../core/security.js'

export interface Migration {
  name: string
  up: string
  down: string
}

export interface MigrationRecord {
  name: string
  appliedAt: Date
}

/** Migration names: safe path segment only (no separators / traversal). */
const MIGRATION_NAME_RE = /^[\w][\w.-]*$/

export function assertSafeMigrationName(name: string): void {
  if (!MIGRATION_NAME_RE.test(name) || name.includes('..')) {
    throw new Error(`Invalid migration name: ${JSON.stringify(name)}`)
  }
}

/** Resolve a file under baseDir and refuse path escape (CWE-22). */
export function resolveWithinBase(baseDir: string, ...segments: string[]): string {
  for (const segment of segments) {
    assertSafeMigrationName(segment)
  }
  const base = path.resolve(baseDir)
  const target = path.resolve(base, ...segments)
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`Path escapes base directory: ${segments.join('/')}`)
  }
  return target
}

export class Migrator {
  private migrationsDir: string
  private migrationsTableName = '_va_migrations'

  constructor(
    private driver: DatabaseDriver,
    migrationsDir: string = './migrations'
  ) {
    this.migrationsDir = migrationsDir
  }

  private ph(index: number): string {
    return this.driver.getPlaceholder(index)
  }

  async initialize(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS ${this.migrationsTableName} (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    await this.driver.execute(sql)
  }

  async getAppliedMigrations(): Promise<MigrationRecord[]> {
    const result = await this.driver.query<MigrationRecord>(
      `SELECT name, applied_at FROM ${this.migrationsTableName} ORDER BY name`
    )
    return result.rows
  }

  async getPendingMigrations(): Promise<Migration[]> {
    const applied = await this.getAppliedMigrations()
    const appliedNames = new Set(applied.map(m => m.name))

    const allMigrations = await this.loadMigrations()
    return allMigrations.filter(m => !appliedNames.has(m.name))
  }

  async migrate(): Promise<MigrationRecord[]> {
    await this.initialize()

    const pending = await this.getPendingMigrations()
    const applied: MigrationRecord[] = []

    for (const migration of pending) {
      await this.applyMigration(migration)
      applied.push({
        name: migration.name,
        appliedAt: new Date(),
      })
    }

    return applied
  }

  async rollback(steps: number = 1): Promise<MigrationRecord[]> {
    const applied = await this.getAppliedMigrations()
    const toRollback = applied.slice(-steps).reverse()

    const rolledBack: MigrationRecord[] = []

    for (const record of toRollback) {
      const migration = await this.loadMigration(record.name)
      if (migration) {
        await this.rollbackMigration(migration)
        await this.driver.execute(
          `DELETE FROM ${this.migrationsTableName} WHERE name = ${this.ph(1)}`,
          [record.name]
        )
        rolledBack.push(record)
      }
    }

    return rolledBack
  }

  async reset(): Promise<void> {
    const applied = await this.getAppliedMigrations()
    await this.rollback(applied.length)
  }

  async status(): Promise<{
    applied: MigrationRecord[]
    pending: Migration[]
  }> {
    await this.initialize()
    const applied = await this.getAppliedMigrations()
    const pending = await this.getPendingMigrations()

    return { applied, pending }
  }

  async createMigration(name: string, upSql = '', downSql = ''): Promise<string> {
    assertSafeMigrationName(name)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `${timestamp}_${name}.sql`

    await fs.mkdir(this.migrationsDir, { recursive: true })
    const filePath = resolveWithinBase(this.migrationsDir, filename)

    const template = `-- Migration: ${name}
-- Created at: ${new Date().toISOString()}

-- Up migration
${upSql}

-- Down migration
${downSql}
`
    await fs.writeFile(filePath, template)
    return filePath
  }

  async dev(name: string, upSql = '', downSql = ''): Promise<{ file: string; applied: MigrationRecord[] }> {
    const file = await this.createMigration(name, upSql, downSql)
    const applied = await this.migrate()
    return { file, applied }
  }

  async resolve(name: string, action: 'applied' | 'rolled-back'): Promise<void> {
    assertSafeMigrationName(name)
    await this.initialize()
    if (action === 'applied') {
      const applied = await this.getAppliedMigrations()
      if (!applied.some((m) => m.name === name)) {
        await this.driver.execute(
          `INSERT INTO ${this.migrationsTableName} (name) VALUES (${this.ph(1)})`,
          [name]
        )
      }
    } else {
      await this.driver.execute(
        `DELETE FROM ${this.migrationsTableName} WHERE name = ${this.ph(1)}`,
        [name]
      )
    }
  }

  private async loadMigrations(): Promise<Migration[]> {
    try {
      const files = await fs.readdir(this.migrationsDir)
      const sqlFiles = files
        .filter(f => f.endsWith('.sql'))
        .sort()

      const migrations: Migration[] = []

      for (const file of sqlFiles) {
        const migration = await this.loadMigration(file.replace('.sql', ''))
        if (migration) {
          migrations.push(migration)
        }
      }

      return migrations
    } catch {
      return []
    }
  }

  private async loadMigration(name: string): Promise<Migration | null> {
    try {
      const filePath = resolveWithinBase(this.migrationsDir, `${name}.sql`)
      const content = await fs.readFile(filePath, 'utf-8')

      const parts = content.split('-- Down migration')
      const up = parts[0]
        .replace(/-- Up migration[\s\S]*?\n/, '')
        .replace(/-- Migration:.*\n/, '')
        .replace(/-- Created at:.*\n/, '')
        .trim()

      const down = parts[1]?.trim() || ''

      return { name, up, down }
    } catch {
      return null
    }
  }

  private async applyMigration(migration: Migration): Promise<void> {
    const statements = splitSqlStatements(migration.up)

    for (const statement of statements) {
      await this.driver.execute(statement)
    }

    await this.driver.execute(
      `INSERT INTO ${this.migrationsTableName} (name) VALUES (${this.ph(1)})`,
      [migration.name]
    )
  }

  private async rollbackMigration(migration: Migration): Promise<void> {
    if (!migration.down) {
      throw new Error(`No down migration for "${migration.name}"`)
    }

    const statements = splitSqlStatements(migration.down)

    for (const statement of statements) {
      await this.driver.execute(statement)
    }
  }
}
