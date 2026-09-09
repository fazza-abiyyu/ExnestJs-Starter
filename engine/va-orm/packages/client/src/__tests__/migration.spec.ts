// VA-ORM Migration Spec

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Migrator } from '../migration/migrator.js'
import { MigrationTracker } from '../migration/tracker.js'
import { MockDriver } from '../../../../test-setup.js'

describe('Migration', () => {
  let driver: MockDriver

  beforeEach(() => {
    driver = new MockDriver()
  })

  describe('Migrator', () => {
    let migrator: Migrator

    beforeEach(() => {
      migrator = new Migrator(driver, './test-migrations')
    })

    it('should create migrator instance', () => {
      expect(migrator).toBeDefined()
    })

    it('should initialize', async () => {
      driver.setResult({ rows: [], rowCount: 0 })
      await migrator.initialize()
      expect(driver.getQueries().length).toBeGreaterThan(0)
    })

    it('should get status', async () => {
      driver.setResult({ rows: [], rowCount: 0 })
      driver.setResult({ rows: [], rowCount: 0 })
      const status = await migrator.status()
      expect(status).toHaveProperty('applied')
      expect(status).toHaveProperty('pending')
    })

    it('should create migration file', async () => {
      const fs = await import('fs/promises')
      const path = await import('path')
      const testDir = './test-migrations-create'

      try {
        await fs.mkdir(testDir, { recursive: true })
        const testMigrator = new Migrator(driver, testDir)
        const filePath = await testMigrator.createMigration('test-migration')
        expect(filePath).toContain('test-migration')

        const content = await fs.readFile(filePath, 'utf-8')
        expect(content).toContain('test-migration')
        expect(content).toContain('-- Up migration')
        expect(content).toContain('-- Down migration')

        await fs.rm(testDir, { recursive: true })
      } catch (error) {
        // Cleanup on error
        try {
          await fs.rm(testDir, { recursive: true })
        } catch {}
        throw error
      }
    })

    it('should run dev migration (create + apply)', async () => {
      const fs = await import('fs/promises')
      const testDir = './test-migrations-dev'

      try {
        const testMigrator = new Migrator(driver, testDir)
        driver.setResult({ rows: [], rowCount: 0 })
        driver.setResult({ rows: [], rowCount: 0 })
        driver.setResult({ rows: [], rowCount: 0 })

        const { file, applied } = await testMigrator.dev('add_users', 'CREATE TABLE users (id INT)')
        expect(file).toContain('add_users')

        const content = await fs.readFile(file, 'utf-8')
        expect(content).toContain('CREATE TABLE users (id INT)')

        expect(applied.length).toBe(1)
        expect(applied[0].name).toContain('add_users')

        await fs.rm(testDir, { recursive: true })
      } catch (error) {
        try {
          const fs = await import('fs/promises')
          await fs.rm(testDir, { recursive: true })
        } catch {}
        throw error
      }
    })

    it('should resolve migration as applied', async () => {
      driver.setResult({ rows: [], rowCount: 0 })
      driver.setResult({ rows: [], rowCount: 0 })
      driver.setResult({ rowCount: 1 })

      const testMigrator = new Migrator(driver, './test-migrations')
      await testMigrator.resolve('20240101_add_users', 'applied')

      const queries = driver.getQueries()
      const insert = queries.find((q) => q.sql.startsWith('INSERT INTO _va_migrations'))
      expect(insert).toBeDefined()
      expect(insert!.params).toEqual(['20240101_add_users'])
    })

    it('should resolve migration as rolled-back', async () => {
      driver.setResult({ rows: [], rowCount: 0 })

      const testMigrator = new Migrator(driver, './test-migrations')
      await testMigrator.resolve('20240101_add_users', 'rolled-back')

      const queries = driver.getQueries()
      const del = queries.find((q) => q.sql.startsWith('DELETE FROM _va_migrations'))
      expect(del).toBeDefined()
      expect(del!.params).toEqual(['20240101_add_users'])
    })

    it('should not duplicate applied record on resolve', async () => {
      driver.setResult({ rows: [], rowCount: 0 })
      driver.setResult({ rows: [{ name: '20240101_add_users' }], rowCount: 1 })

      const testMigrator = new Migrator(driver, './test-migrations')
      await testMigrator.resolve('20240101_add_users', 'applied')

      const queries = driver.getQueries()
      expect(queries.some((q) => q.sql.startsWith('INSERT INTO _va_migrations'))).toBe(false)
    })
  })

  describe('MigrationTracker', () => {
    let tracker: MigrationTracker

    beforeEach(() => {
      tracker = new MigrationTracker(driver)
    })

    it('should create tracker instance', () => {
      expect(tracker).toBeDefined()
    })

    it('should initialize', async () => {
      driver.setResult({ rows: [], rowCount: 0 })
      await tracker.initialize()
      expect(driver.getQueries().length).toBeGreaterThan(0)
    })

    it('should record migration', async () => {
      driver.setResult({ rows: [], rowCount: 0 })
      await tracker.record('001_test', 'abc123', 100)
      expect(driver.getQueries().length).toBe(1)
      expect(driver.getQueries()[0].params).toContain('001_test')
    })

    it('should remove migration', async () => {
      driver.setResult({ rows: [], rowCount: 0 })
      await tracker.remove('001_test')
      expect(driver.getQueries().length).toBe(1)
    })

    it('should get applied migrations', async () => {
      driver.setResult({
        rows: [
          { name: '001_test', checksum: 'abc123', appliedAt: new Date(), executionTimeMs: 100 },
        ],
        rowCount: 1,
      })
      const applied = await tracker.getApplied()
      expect(applied.length).toBe(1)
      expect(applied[0].name).toBe('001_test')
    })

    it('should check if migration is applied', async () => {
      driver.setResult({ rows: [{ name: '001_test' }], rowCount: 1 })
      const isApplied = await tracker.isApplied('001_test')
      expect(isApplied).toBe(true)
    })

    it('should return false for unapplied migration', async () => {
      driver.setResult({ rows: [], rowCount: 0 })
      const isApplied = await tracker.isApplied('002_test')
      expect(isApplied).toBe(false)
    })

    it('should get checksum', async () => {
      driver.setResult({ rows: [{ checksum: 'abc123' }], rowCount: 1 })
      const checksum = await tracker.getChecksum('001_test')
      expect(checksum).toBe('abc123')
    })

    it('should verify migrations', async () => {
      driver.setResult({
        rows: [
          { name: '001_test', checksum: 'abc123', appliedAt: new Date(), executionTimeMs: 100 },
        ],
        rowCount: 1,
      })
      const status = await tracker.verify()
      expect(status.length).toBe(1)
      expect(status[0].applied).toBe(true)
    })

    it('should check for conflicts', async () => {
      driver.setResult({
        rows: [
          { name: '001_test', checksum: 'abc123', appliedAt: new Date(), executionTimeMs: 100 },
          { name: '001_test', checksum: 'abc123', appliedAt: new Date(), executionTimeMs: 100 },
        ],
        rowCount: 2,
      })
      const hasConflicts = await tracker.hasConflicts()
      expect(hasConflicts).toBe(true)
    })

    it('should return false when no conflicts', async () => {
      driver.setResult({
        rows: [
          { name: '001_test', checksum: 'abc123', appliedAt: new Date(), executionTimeMs: 100 },
        ],
        rowCount: 1,
      })
      const hasConflicts = await tracker.hasConflicts()
      expect(hasConflicts).toBe(false)
    })
  })
})
