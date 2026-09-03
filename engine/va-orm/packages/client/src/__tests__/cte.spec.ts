// VA-ORM CTE Builder Spec

import { describe, it, expect, beforeEach } from 'bun:test'
import { CTEBuilder } from '../raw/cte.js'
import { MockDriver } from '../../../../test-setup.js'

describe('CTEBuilder', () => {
  let driver: MockDriver
  let cte: CTEBuilder

  beforeEach(() => {
    driver = new MockDriver()
    cte = new CTEBuilder(driver)
  })

  describe('with', () => {
    it('should add CTE', () => {
      cte.with('active_users', 'SELECT * FROM users WHERE status = $1', ['active'])
      const { sql, params } = cte.select('SELECT * FROM active_users').build()
      expect(sql).toBe('WITH active_users AS (SELECT * FROM users WHERE status = $1) SELECT * FROM active_users')
      expect(params).toEqual(['active'])
    })

    it('should add multiple CTEs', () => {
      cte
        .with('active_users', 'SELECT * FROM users WHERE status = $1', ['active'])
        .with('admin_users', 'SELECT * FROM users WHERE role = $2', ['admin'])

      const { sql, params } = cte.select('SELECT * FROM active_users JOIN admin_users ON active_users.id = admin_users.id').build()
      expect(sql).toContain('WITH active_users AS')
      expect(sql).toContain('admin_users AS')
      expect(params).toEqual(['active', 'admin'])
    })

    it('should add CTE with columns', () => {
      cte.with('user_stats', 'SELECT id, COUNT(*) as count FROM posts GROUP BY id', [], {
        columns: ['id', 'count'],
      })
      const { sql } = cte.select('SELECT * FROM user_stats').build()
      expect(sql).toContain('user_stats (id, count) AS')
    })

    it('should add materialized CTE', () => {
      cte.with('cached_data', 'SELECT * FROM expensive_query', [], {
        materialized: true,
      })
      const { sql } = cte.select('SELECT * FROM cached_data').build()
      expect(sql).toContain('cached_data AS MATERIALIZED')
    })

    it('should add not materialized CTE', () => {
      cte.with('temp_data', 'SELECT * FROM temp_table', [], {
        materialized: false,
      })
      const { sql } = cte.select('SELECT * FROM temp_data').build()
      expect(sql).toContain('temp_data AS NOT MATERIALIZED')
    })
  })

  describe('withRecursive', () => {
    it('should add recursive CTE', () => {
      cte.withRecursive(
        'tree',
        'SELECT id, parent_id, name FROM categories WHERE parent_id IS NULL UNION ALL SELECT c.id, c.parent_id, c.name FROM categories c JOIN tree t ON c.parent_id = t.id',
        []
      )
      const { sql } = cte.select('SELECT * FROM tree').build()
      expect(sql).toContain('WITH RECURSIVE tree AS')
    })
  })

  describe('build', () => {
    it('should build without CTE', () => {
      const { sql, params } = cte.select('SELECT * FROM users').build()
      expect(sql).toBe('SELECT * FROM users')
      expect(params).toEqual([])
    })

    it('should build with CTE and main query params', () => {
      cte.with('active_users', 'SELECT * FROM users WHERE status = $1', ['active'])
      const { sql, params } = cte.select('SELECT * FROM active_users WHERE id = $2', [1]).build()
      expect(sql).toBe('WITH active_users AS (SELECT * FROM users WHERE status = $1) SELECT * FROM active_users WHERE id = $2')
      expect(params).toEqual(['active', 1])
    })
  })

  describe('execute', () => {
    it('should execute CTE query', async () => {
      driver.setResult({ rows: [{ id: 1 }], rowCount: 1 })
      cte.with('active_users', 'SELECT * FROM users WHERE status = $1', ['active'])
      const result = await cte.select('SELECT * FROM active_users').execute()
      expect(result).toEqual([{ id: 1 }])
    })

    it('should execute one', async () => {
      driver.setResult({ rows: [{ id: 1 }], rowCount: 1 })
      cte.with('active_users', 'SELECT * FROM users WHERE status = $1', ['active'])
      const result = await cte.select('SELECT * FROM active_users').executeOne()
      expect(result).toEqual({ id: 1 })
    })

    it('should return null for executeOne when no rows', async () => {
      driver.setResult({ rows: [], rowCount: 0 })
      cte.with('active_users', 'SELECT * FROM users WHERE status = $1', ['active'])
      const result = await cte.select('SELECT * FROM active_users').executeOne()
      expect(result).toBeNull()
    })
  })

  describe('static', () => {
    it('should create instance with create', () => {
      const instance = CTEBuilder.create(driver)
      expect(instance).toBeInstanceOf(CTEBuilder)
    })
  })
})
