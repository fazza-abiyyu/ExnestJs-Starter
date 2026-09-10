// VA-ORM Shadow Database

import type { DatabaseDriver } from '../core/types.js'
import { Migrator } from './migrator.js'

export interface ShadowDbConfig {
  driver: DatabaseDriver
  schema: string
  migrationsDir: string
}

export class ShadowDatabase {
  private driver: DatabaseDriver
  private shadowTableName = '_va_shadow_schema'
  private schema: string
  private migrationsDir: string

  constructor(config: ShadowDbConfig) {
    this.driver = config.driver
    this.schema = config.schema
    this.migrationsDir = config.migrationsDir
  }

  async detectDrift(devDriver: DatabaseDriver): Promise<DriftResult> {
    const shadowSchema = await this.introspectSchema(this.driver)
    const devSchema = await this.introspectSchema(devDriver)

    return this.compareSchemas(shadowSchema, devSchema)
  }

  private async introspectSchema(driver: DatabaseDriver): Promise<SchemaSnapshot> {
    const tables = await driver.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
    )

    const snapshot: SchemaSnapshot = { tables: new Map() }

    for (const { tablename } of tables.rows) {
      const columns = await driver.query<{
        column_name: string
        data_type: string
        is_nullable: string
        column_default: string | null
      }>(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_name = $1 AND table_schema = 'public'
         ORDER BY ordinal_position`,
        [tablename]
      )

      snapshot.tables.set(tablename, {
        columns: columns.rows.map(c => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === 'YES',
          default: c.column_default,
        })),
      })
    }

    return snapshot
  }

  private compareSchemas(shadow: SchemaSnapshot, dev: SchemaSnapshot): DriftResult {
    const drifts: Drift[] = []

    // Check for missing tables in dev
    for (const [tableName] of shadow.tables) {
      if (!dev.tables.has(tableName)) {
        drifts.push({
          type: 'table_missing',
          table: tableName,
          message: `Table "${tableName}" exists in shadow but not in dev`,
        })
      }
    }

    // Check for extra tables in dev
    for (const [tableName] of dev.tables) {
      if (!shadow.tables.has(tableName)) {
        drifts.push({
          type: 'table_added',
          table: tableName,
          message: `Table "${tableName}" was added in dev`,
        })
      }
    }

    // Check for column differences
    for (const [tableName, shadowTable] of shadow.tables) {
      const devTable = dev.tables.get(tableName)
      if (!devTable) continue

      const shadowCols = new Map(shadowTable.columns.map(c => [c.name, c]))
      const devCols = new Map(devTable.columns.map(c => [c.name, c]))

      for (const [colName, shadowCol] of shadowCols) {
        const devCol = devCols.get(colName)
        if (!devCol) {
          drifts.push({
            type: 'column_missing',
            table: tableName,
            column: colName,
            message: `Column "${colName}" in table "${tableName}" exists in shadow but not in dev`,
          })
        } else if (shadowCol.type !== devCol.type) {
          drifts.push({
            type: 'column_type_changed',
            table: tableName,
            column: colName,
            message: `Column "${colName}" in table "${tableName}" type changed from "${shadowCol.type}" to "${devCol.type}"`,
          })
        }
      }

      for (const [colName] of devCols) {
        if (!shadowCols.has(colName)) {
          drifts.push({
            type: 'column_added',
            table: tableName,
            column: colName,
            message: `Column "${colName}" was added to table "${tableName}" in dev`,
          })
        }
      }
    }

    return {
      hasDrift: drifts.length > 0,
      drifts,
    }
  }
}

interface SchemaSnapshot {
  tables: Map<string, {
    columns: {
      name: string
      type: string
      nullable: boolean
      default: string | null
    }[]
  }>
}

export interface Drift {
  type: 'table_missing' | 'table_added' | 'column_missing' | 'column_added' | 'column_type_changed'
  table: string
  column?: string
  message: string
}

export interface DriftResult {
  hasDrift: boolean
  drifts: Drift[]
}
