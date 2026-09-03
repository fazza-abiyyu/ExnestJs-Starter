// VA-ORM Query Builder Spec

import { describe, it, expect, beforeEach } from 'bun:test'
import { QueryBuilder } from '../core/query-builder.js'
import { MockDriver } from '../../../../test-setup.js'

describe('QueryBuilder', () => {
  let driver: MockDriver

  beforeEach(() => {
    driver = new MockDriver()
  })

  describe('SELECT queries', () => {
    it('should build simple select all', () => {
      const builder = new QueryBuilder(driver, 'users')
      const { sql } = builder.build()
      expect(sql).toBe('SELECT * FROM users')
    })

    it('should build select with specific columns', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.select('id', 'name', 'email')
      const { sql } = builder.build()
      expect(sql).toBe('SELECT id, name, email FROM users')
    })

    it('should build select distinct', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.select('role').distinct()
      const { sql } = builder.build()
      expect(sql).toBe('SELECT DISTINCT role FROM users')
    })

    it('should build select with alias', () => {
      const builder = new QueryBuilder(driver, 'users', 'u')
      builder.select('u.id', 'u.name')
      const { sql } = builder.build()
      expect(sql).toBe('SELECT u.id, u.name FROM users AS u')
    })
  })

  describe('WHERE clauses', () => {
    it('should build where with eq', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.where((eb) => eb.eq('status', 'active'))
      const { sql, params } = builder.build()
      expect(sql).toBe('SELECT * FROM users WHERE status = $1')
      expect(params).toEqual(['active'])
    })

    it('should build where with multiple conditions', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.where((eb) => {
        eb.eq('status', 'active').and().gt('age', 18)
      })
      const { sql, params } = builder.build()
      expect(sql).toBe('SELECT * FROM users WHERE status = $1 AND age > $2')
      expect(params).toEqual(['active', 18])
    })

    it('should build where with OR', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.where((eb) => {
        eb.eq('role', 'admin').or().eq('role', 'superadmin')
      })
      const { sql, params } = builder.build()
      expect(sql).toBe('SELECT * FROM users WHERE role = $1 OR role = $2')
      expect(params).toEqual(['admin', 'superadmin'])
    })

    it('should build where with IN', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.where((eb) => eb.in('id', [1, 2, 3]))
      const { sql, params } = builder.build()
      expect(sql).toBe('SELECT * FROM users WHERE id IN ($1, $2, $3)')
      expect(params).toEqual([1, 2, 3])
    })

    it('should build where with IS NULL', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.where((eb) => eb.isNull('deletedAt'))
      const { sql } = builder.build()
      expect(sql).toBe('SELECT * FROM users WHERE deletedAt IS NULL')
    })

    it('should build where with BETWEEN', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.where((eb) => eb.between('age', 18, 65))
      const { sql, params } = builder.build()
      expect(sql).toBe('SELECT * FROM users WHERE age BETWEEN $1 AND $2')
      expect(params).toEqual([18, 65])
    })
  })

  describe('JOIN clauses', () => {
    it('should build inner join', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.join('posts', 'users.id = posts.userId')
      const { sql } = builder.build()
      expect(sql).toBe('SELECT * FROM users INNER JOIN posts ON users.id = posts.userId')
    })

    it('should build left join', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.leftJoin('posts', 'users.id = posts.userId')
      const { sql } = builder.build()
      expect(sql).toBe('SELECT * FROM users LEFT JOIN posts ON users.id = posts.userId')
    })

    it('should build right join', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.rightJoin('posts', 'users.id = posts.userId')
      const { sql } = builder.build()
      expect(sql).toBe('SELECT * FROM users RIGHT JOIN posts ON users.id = posts.userId')
    })

    it('should build cross join', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.crossJoin('roles')
      const { sql } = builder.build()
      expect(sql).toBe('SELECT * FROM users CROSS JOIN roles')
    })

    it('should build join with alias', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.join('posts', 'users.id = posts.userId', 'p')
      const { sql } = builder.build()
      expect(sql).toBe('SELECT * FROM users INNER JOIN posts AS p ON users.id = posts.userId')
    })

    it('should build multiple joins', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder
        .leftJoin('posts', 'users.id = posts.userId')
        .leftJoin('comments', 'posts.id = comments.postId')
      const { sql } = builder.build()
      expect(sql).toBe(
        'SELECT * FROM users LEFT JOIN posts ON users.id = posts.userId LEFT JOIN comments ON posts.id = comments.postId'
      )
    })
  })

  describe('ORDER BY', () => {
    it('should build order by ascending', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.orderBy('name')
      const { sql } = builder.build()
      expect(sql).toBe('SELECT * FROM users ORDER BY name ASC')
    })

    it('should build order by descending', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.orderBy('createdAt', 'desc')
      const { sql } = builder.build()
      expect(sql).toBe('SELECT * FROM users ORDER BY createdAt DESC')
    })

    it('should build multiple order by', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.orderBy('lastName', 'asc').orderBy('firstName', 'asc')
      const { sql } = builder.build()
      expect(sql).toBe('SELECT * FROM users ORDER BY lastName ASC, firstName ASC')
    })

    it('should build order by with table prefix', () => {
      const builder = new QueryBuilder(driver, 'users', 'u')
      builder.orderBy('name', 'asc', 'u')
      const { sql } = builder.build()
      expect(sql).toBe('SELECT * FROM users AS u ORDER BY u.name ASC')
    })
  })

  describe('GROUP BY & HAVING', () => {
    it('should build group by', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.select('role').groupBy('role')
      const { sql } = builder.build()
      expect(sql).toBe('SELECT role FROM users GROUP BY role')
    })

    it('should build multiple group by', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.select('role', 'status').groupBy('role', 'status')
      const { sql } = builder.build()
      expect(sql).toBe('SELECT role, status FROM users GROUP BY role, status')
    })

    it('should build group by with having', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder
        .select('role')
        .groupBy('role')
        .having((eb) => eb.raw('COUNT(*) > ?', 5))
      const { sql, params } = builder.build()
      expect(sql).toBe('SELECT role FROM users GROUP BY role HAVING COUNT(*) > $1')
      expect(params).toEqual([5])
    })
  })

  describe('LIMIT & OFFSET', () => {
    it('should build limit', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.limit(10)
      const { sql } = builder.build()
      expect(sql).toBe('SELECT * FROM users LIMIT 10')
    })

    it('should build offset', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.offset(20)
      const { sql } = builder.build()
      expect(sql).toBe('SELECT * FROM users OFFSET 20')
    })

    it('should build limit and offset', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.limit(10).offset(20)
      const { sql } = builder.build()
      expect(sql).toBe('SELECT * FROM users LIMIT 10 OFFSET 20')
    })

    it('should build take and skip', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.take(10).skip(20)
      const { sql } = builder.build()
      expect(sql).toBe('SELECT * FROM users LIMIT 10 OFFSET 20')
    })
  })

  describe('FOR UPDATE', () => {
    it('should build for update', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.where((eb) => eb.eq('id', 1)).forUpdate()
      const { sql, params } = builder.build()
      expect(sql).toBe('SELECT * FROM users WHERE id = $1 FOR UPDATE')
      expect(params).toEqual([1])
    })
  })

  describe('aggregate methods', () => {
    it('should count rows', async () => {
      driver.setResult({ rows: [{ count: 10 }], rowCount: 1 })
      const builder = new QueryBuilder(driver, 'users')
      const count = await builder.count()
      expect(count).toBe(10)
    })

    it('should check exists', async () => {
      driver.setResult({ rows: [{ count: 1 }], rowCount: 1 })
      const builder = new QueryBuilder(driver, 'users')
      const exists = await builder.exists()
      expect(exists).toBe(true)
    })

    it('should return false for exists when count is 0', async () => {
      driver.setResult({ rows: [{ count: 0 }], rowCount: 1 })
      const builder = new QueryBuilder(driver, 'users')
      const exists = await builder.exists()
      expect(exists).toBe(false)
    })
  })

  describe('execute methods', () => {
    it('should execute query and return rows', async () => {
      driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
      const builder = new QueryBuilder(driver, 'users')
      const rows = await builder.execute()
      expect(rows).toEqual([{ id: 1, name: 'John' }])
    })

    it('should execute first and return single row', async () => {
      driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
      const builder = new QueryBuilder(driver, 'users')
      const row = await builder.first()
      expect(row).toEqual({ id: 1, name: 'John' })
    })

    it('should return null for first when no rows', async () => {
      driver.setResult({ rows: [], rowCount: 0 })
      const builder = new QueryBuilder(driver, 'users')
      const row = await builder.first()
      expect(row).toBeNull()
    })
  })

  describe('complex queries', () => {
    it('should build complex query with all clauses', () => {
      const builder = new QueryBuilder(driver, 'users', 'u')
      builder
        .select('u.id', 'u.name', 'COUNT(p.id) as postCount')
        .leftJoin('posts', 'u.id = p.userId', 'p')
        .where((eb) => {
          eb.eq('u.status', 'active').and().gt('u.age', 18)
        })
        .groupBy('u.id', 'u.name')
        .having((eb) => eb.raw('COUNT(p.id) > ?', 5))
        .orderBy('postCount', 'desc')
        .limit(10)
        .offset(0)

      const { sql, params } = builder.build()
      expect(sql).toBe(
        'SELECT u.id, u.name, COUNT(p.id) as postCount FROM users AS u LEFT JOIN posts AS p ON u.id = p.userId WHERE u.status = $1 AND u.age > $2 GROUP BY u.id, u.name HAVING COUNT(p.id) > $3 ORDER BY postCount DESC LIMIT 10 OFFSET 0'
      )
      expect(params).toEqual(['active', 18, 5])
    })
  })
})
