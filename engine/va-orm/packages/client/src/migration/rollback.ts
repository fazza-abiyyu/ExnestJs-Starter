// VA-ORM Migration Rollback

import * as fs from 'fs'
import * as path from 'path'

export interface RollbackOptions {
  steps?: number
  to?: string
}

export interface RollbackResult {
  rolledBack: string[]
  errors: string[]
}

export class MigrationRollback {
  private migrationsDir: string
  private tracker: any

  constructor(migrationsDir: string, tracker: any) {
    this.migrationsDir = migrationsDir
    this.tracker = tracker
  }

  async rollback(options: RollbackOptions = {}): Promise<RollbackResult> {
    const applied = await this.tracker.getApplied()
    const result: RollbackResult = { rolledBack: [], errors: [] }

    if (applied.length === 0) {
      return result
    }

    let toRollback: typeof applied

    if (options.to) {
      const targetIndex = applied.findIndex((m: { name: string }) => m.name === options.to)
      if (targetIndex === -1) {
        result.errors.push(`Migration "${options.to}" not found in applied migrations`)
        return result
      }
      toRollback = applied.slice(targetIndex).reverse()
    } else if (options.steps) {
      toRollback = applied.slice(-options.steps).reverse()
    } else {
      toRollback = [applied[applied.length - 1]]
    }

    for (const migration of toRollback) {
      try {
        await this.executeRollback(migration.name)
        await this.tracker.remove(migration.name)
        result.rolledBack.push(migration.name)
      } catch (error: any) {
        result.errors.push(`Failed to rollback "${migration.name}": ${error.message}`)
        break
      }
    }

    return result
  }

  private async executeRollback(migrationName: string): Promise<void> {
    const migrationDir = path.join(this.migrationsDir, migrationName)
    const migrationFile = path.join(migrationDir, 'migration.sql')

    if (!fs.existsSync(migrationFile)) {
      throw new Error(`Migration file not found: ${migrationFile}`)
    }

    const content = fs.readFileSync(migrationFile, 'utf-8')
    const downSql = this.extractDownSql(content)

    if (!downSql) {
      throw new Error(`No down migration found in ${migrationFile}`)
    }

    const statements = downSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0)

    for (const statement of statements) {
      await this.tracker.driver.execute(statement)
    }
  }

  private extractDownSql(content: string): string | null {
    const downMatch = content.match(/-- Down migration\s*\n([\s\S]*?)(?=-- Up migration|$)/i)
    return downMatch?.[1]?.trim() ?? null
  }

  getRollbackSql(migrationName: string): string | null {
    const migrationDir = path.join(this.migrationsDir, migrationName)
    const migrationFile = path.join(migrationDir, 'migration.sql')

    if (!fs.existsSync(migrationFile)) {
      return null
    }

    const content = fs.readFileSync(migrationFile, 'utf-8')
    return this.extractDownSql(content)
  }

  async getPendingRollbacks(): Promise<string[]> {
    const applied = await this.tracker.getApplied()
    return applied.map((m: { name: string }) => m.name).reverse()
  }
}
