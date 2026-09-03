// VA-ORM Subquery Builder Spec

import { describe, it, expect, beforeEach } from 'bun:test'
import { SubqueryBuilder } from '../raw/subquery.js'
import { QueryBuilder } from '../core/query-builder.js'
import { MockDriver } from '../../../../test-setup.js'

describe('SubqueryBuilder', () => {
  let driver: MockDriver
  let subquery: SubqueryBuilder

  beforeEach(() => {
    driver = new MockDriver()
    subquery = new SubqueryBuilder(driver)
  })

  describe('fromQueryBuilder', () => {
    it('should extract SQL from query builder', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.where((eb) => eb.eq('status', 'active'))
      const { sql, params } = subquery.fromQueryBuilder(builder)
      expect(sql).toBe('SELECT * FROM users WHERE status = $1')
      expect(params).toEqual(['active'])
    })
  })

  describe('fromRaw', () => {
    it('should create subquery from raw SQL', () => {
      const { sql, params } = subquery.fromRaw('SELECT id FROM users WHERE status = $1', ['active'])
      expect(sql).toBe('SELECT id FROM users WHERE status = $1')
      expect(params).toEqual(['active'])
    })
  })

  describe('inSubquery', () => {
    it('should build IN subquery', () => {
      const sub = subquery.fromRaw('SELECT id FROM users WHERE status = $1', ['active'])
      const condition = subquery.inSubquery('user_id', sub)
      expect(condition).toBe('user_id IN (SELECT id FROM users WHERE status = $1)')
    })
  })

  describe('notInSubquery', () => {
    it('should build NOT IN subquery', () => {
      const sub = subquery.fromRaw('SELECT id FROM deleted_users', [])
      const condition = subquery.notInSubquery('user_id', sub)
      expect(condition).toBe('user_id NOT IN (SELECT id FROM deleted_users)')
    })
  })

  describe('exists', () => {
    it('should build EXISTS subquery', () => {
      const sub = subquery.fromRaw('SELECT 1 FROM posts WHERE userId = users.id', [])
      const condition = subquery.exists(sub)
      expect(condition).toBe('EXISTS (SELECT 1 FROM posts WHERE userId = users.id)')
    })
  })

  describe('notExists', () => {
    it('should build NOT EXISTS subquery', () => {
      const sub = subquery.fromRaw('SELECT 1 FROM banned_users WHERE id = users.id', [])
      const condition = subquery.notExists(sub)
      expect(condition).toBe('NOT EXISTS (SELECT 1 FROM banned_users WHERE id = users.id)')
    })
  })

  describe('asTable', () => {
    it('should wrap subquery as table', () => {
      const sub = subquery.fromRaw('SELECT * FROM users WHERE status = $1', ['active'])
      const { sql, params } = subquery.asTable(sub, 'active_users')
      expect(sql).toBe('(SELECT * FROM users WHERE status = $1) AS active_users')
      expect(params).toEqual(['active'])
    })
  })

  describe('asColumn', () => {
    it('should wrap subquery as column', () => {
      const sub = subquery.fromRaw('SELECT COUNT(*) FROM posts WHERE userId = users.id', [])
      const result = subquery.asColumn(sub, 'post_count')
      expect(result).toBe('(SELECT COUNT(*) FROM posts WHERE userId = users.id) AS post_count')
    })
  })

  describe('scalar', () => {
    it('should wrap as scalar subquery', () => {
      const sub = subquery.fromRaw('SELECT MAX(age) FROM users', [])
      const result = subquery.scalar(sub)
      expect(result).toBe('(SELECT MAX(age) FROM users)')
    })
  })

  describe('aggregate subqueries', () => {
    it('should build count subquery', () => {
      const sub = subquery.fromRaw('SELECT * FROM posts WHERE userId = $1', [1])
      const result = subquery.countSubquery(sub)
      expect(result).toBe('(SELECT COUNT(*) FROM (SELECT * FROM posts WHERE userId = $1) AS _subquery)')
    })

    it('should build sum subquery', () => {
      const sub = subquery.fromRaw('SELECT amount FROM transactions WHERE userId = $1', [1])
      const result = subquery.sumSubquery('amount', sub)
      expect(result).toBe('(SELECT SUM(amount) FROM (SELECT amount FROM transactions WHERE userId = $1) AS _subquery)')
    })

    it('should build avg subquery', () => {
      const sub = subquery.fromRaw('SELECT score FROM scores WHERE userId = $1', [1])
      const result = subquery.avgSubquery('score', sub)
      expect(result).toBe('(SELECT AVG(score) FROM (SELECT score FROM scores WHERE userId = $1) AS _subquery)')
    })

    it('should build min subquery', () => {
      const sub = subquery.fromRaw('SELECT price FROM products WHERE categoryId = $1', [1])
      const result = subquery.minSubquery('price', sub)
      expect(result).toBe('(SELECT MIN(price) FROM (SELECT price FROM products WHERE categoryId = $1) AS _subquery)')
    })

    it('should build max subquery', () => {
      const sub = subquery.fromRaw('SELECT price FROM products WHERE categoryId = $1', [1])
      const result = subquery.maxSubquery('price', sub)
      expect(result).toBe('(SELECT MAX(price) FROM (SELECT price FROM products WHERE categoryId = $1) AS _subquery)')
    })
  })

  describe('static', () => {
    it('should create instance with create', () => {
      const instance = SubqueryBuilder.create(driver)
      expect(instance).toBeInstanceOf(SubqueryBuilder)
    })
  })
})
