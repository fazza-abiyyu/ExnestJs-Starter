// VA-ORM Expression Builder Spec

import { describe, it, expect } from 'bun:test'
import { ExpressionBuilder } from '../core/expression.js'

describe('ExpressionBuilder', () => {
  describe('comparison operators', () => {
    it('should build eq condition', () => {
      const builder = new ExpressionBuilder()
      builder.eq('name', 'John')
      const { sql, params } = builder.build()
      expect(sql).toBe('name = $1')
      expect(params).toEqual(['John'])
    })

    it('should build neq condition', () => {
      const builder = new ExpressionBuilder()
      builder.neq('status', 'deleted')
      const { sql, params } = builder.build()
      expect(sql).toBe('status != $1')
      expect(params).toEqual(['deleted'])
    })

    it('should build gt condition', () => {
      const builder = new ExpressionBuilder()
      builder.gt('age', 18)
      const { sql, params } = builder.build()
      expect(sql).toBe('age > $1')
      expect(params).toEqual([18])
    })

    it('should build gte condition', () => {
      const builder = new ExpressionBuilder()
      builder.gte('score', 100)
      const { sql, params } = builder.build()
      expect(sql).toBe('score >= $1')
      expect(params).toEqual([100])
    })

    it('should build lt condition', () => {
      const builder = new ExpressionBuilder()
      builder.lt('price', 50)
      const { sql, params } = builder.build()
      expect(sql).toBe('price < $1')
      expect(params).toEqual([50])
    })

    it('should build lte condition', () => {
      const builder = new ExpressionBuilder()
      builder.lte('quantity', 0)
      const { sql, params } = builder.build()
      expect(sql).toBe('quantity <= $1')
      expect(params).toEqual([0])
    })
  })

  describe('pattern operators', () => {
    it('should build like condition', () => {
      const builder = new ExpressionBuilder()
      builder.like('name', '%John%')
      const { sql, params } = builder.build()
      expect(sql).toBe('name LIKE $1')
      expect(params).toEqual(['%John%'])
    })

    it('should build not like condition', () => {
      const builder = new ExpressionBuilder()
      builder.notLike('email', '%test%')
      const { sql, params } = builder.build()
      expect(sql).toBe('email NOT LIKE $1')
      expect(params).toEqual(['%test%'])
    })

    it('should build ilike condition', () => {
      const builder = new ExpressionBuilder()
      builder.ilike('name', '%john%')
      const { sql, params } = builder.build()
      expect(sql).toBe('name ILIKE $1')
      expect(params).toEqual(['%john%'])
    })

    it('should build not ilike condition', () => {
      const builder = new ExpressionBuilder()
      builder.notIlike('name', '%admin%')
      const { sql, params } = builder.build()
      expect(sql).toBe('name NOT ILIKE $1')
      expect(params).toEqual(['%admin%'])
    })
  })

  describe('null operators', () => {
    it('should build is null condition', () => {
      const builder = new ExpressionBuilder()
      builder.isNull('deletedAt')
      const { sql, params } = builder.build()
      expect(sql).toBe('deletedAt IS NULL')
      expect(params).toEqual([])
    })

    it('should build is not null condition', () => {
      const builder = new ExpressionBuilder()
      builder.isNotNull('email')
      const { sql, params } = builder.build()
      expect(sql).toBe('email IS NOT NULL')
      expect(params).toEqual([])
    })
  })

  describe('in operators', () => {
    it('should build in condition', () => {
      const builder = new ExpressionBuilder()
      builder.in('status', ['active', 'pending'])
      const { sql, params } = builder.build()
      expect(sql).toBe('status IN ($1, $2)')
      expect(params).toEqual(['active', 'pending'])
    })

    it('should build not in condition', () => {
      const builder = new ExpressionBuilder()
      builder.notIn('id', [1, 2, 3])
      const { sql, params } = builder.build()
      expect(sql).toBe('id NOT IN ($1, $2, $3)')
      expect(params).toEqual([1, 2, 3])
    })

    it('should handle empty array', () => {
      const builder = new ExpressionBuilder()
      builder.in('id', [])
      const { sql, params } = builder.build()
      expect(sql).toBe('id IN ()')
      expect(params).toEqual([])
    })
  })

  describe('between operators', () => {
    it('should build between condition', () => {
      const builder = new ExpressionBuilder()
      builder.between('age', 18, 65)
      const { sql, params } = builder.build()
      expect(sql).toBe('age BETWEEN $1 AND $2')
      expect(params).toEqual([18, 65])
    })

    it('should build not between condition', () => {
      const builder = new ExpressionBuilder()
      builder.notBetween('price', 100, 500)
      const { sql, params } = builder.build()
      expect(sql).toBe('price NOT BETWEEN $1 AND $2')
      expect(params).toEqual([100, 500])
    })
  })

  describe('logical operators', () => {
    it('should build AND condition', () => {
      const builder = new ExpressionBuilder()
      builder.eq('a', 1).and().eq('b', 2)
      const { sql, params } = builder.build()
      expect(sql).toBe('a = $1 AND b = $2')
      expect(params).toEqual([1, 2])
    })

    it('should build OR condition', () => {
      const builder = new ExpressionBuilder()
      builder.eq('status', 'active').or().eq('status', 'pending')
      const { sql, params } = builder.build()
      expect(sql).toBe('status = $1 OR status = $2')
      expect(params).toEqual(['active', 'pending'])
    })

    it('should build NOT condition', () => {
      const builder = new ExpressionBuilder()
      builder.eq('deleted', false).not().eq('archived', true)
      const { sql, params } = builder.build()
      expect(sql).toBe('deleted = $1 NOT archived = $2')
      expect(params).toEqual([false, true])
    })

    it('should chain multiple conditions', () => {
      const builder = new ExpressionBuilder()
      builder
        .eq('a', 1)
        .and()
        .eq('b', 2)
        .or()
        .eq('c', 3)
      const { sql, params } = builder.build()
      expect(sql).toBe('a = $1 AND b = $2 OR c = $3')
      expect(params).toEqual([1, 2, 3])
    })
  })

  describe('nested groups', () => {
    it('should build grouped condition', () => {
      const builder = new ExpressionBuilder()
      builder.eq('a', 1).group((g) => {
        g.eq('b', 2).or().eq('c', 3)
      })
      const { sql, params } = builder.build()
      expect(sql).toBe('a = $1 AND (b = $2 OR c = $3)')
      expect(params).toEqual([1, 2, 3])
    })

    it('should handle nested groups', () => {
      const builder = new ExpressionBuilder()
      builder.eq('a', 1).group((g) => {
        g.eq('b', 2).group((gg) => {
          gg.eq('c', 3).or().eq('d', 4)
        })
      })
      const { sql, params } = builder.build()
      expect(sql).toBe('a = $1 AND (b = $2 AND (c = $3 OR d = $4))')
      expect(params).toEqual([1, 2, 3, 4])
    })
  })

  describe('raw conditions', () => {
    it('should build raw condition', () => {
      const builder = new ExpressionBuilder()
      builder.raw('NOW() > expires_at')
      const { sql, params } = builder.build()
      expect(sql).toBe('NOW() > expires_at')
      expect(params).toEqual([])
    })

    it('should build raw condition with params', () => {
      const builder = new ExpressionBuilder()
      builder.raw('created_at > ?', '2024-01-01')
      const { sql, params } = builder.build()
      expect(sql).toBe('created_at > $1')
      expect(params).toEqual(['2024-01-01'])
    })
  })

  describe('empty builder', () => {
    it('should return empty sql for empty builder', () => {
      const builder = new ExpressionBuilder()
      const { sql, params } = builder.build()
      expect(sql).toBe('')
      expect(params).toEqual([])
    })
  })

  describe('custom placeholder', () => {
    it('should use custom placeholder function', () => {
      const builder = new ExpressionBuilder((i) => `?${i}`)
      builder.eq('name', 'John')
      const { sql, params } = builder.build()
      expect(sql).toBe('name = ?1')
      expect(params).toEqual(['John'])
    })

    it('should use ? placeholder for MySQL', () => {
      const builder = new ExpressionBuilder(() => '?')
      builder.eq('name', 'John')
      const { sql, params } = builder.build()
      expect(sql).toBe('name = ?')
      expect(params).toEqual(['John'])
    })
  })

  describe('static methods', () => {
    it('should create new builder with create', () => {
      const builder = ExpressionBuilder.create()
      expect(builder).toBeInstanceOf(ExpressionBuilder)
    })

    it('should create builder from clauses', () => {
      const builder = ExpressionBuilder.from([
        { column: 'a', operator: '=', value: 1 },
        { column: 'b', operator: '=', value: 2, connector: 'AND' },
      ])
      const { sql, params } = builder.build()
      expect(sql).toBe('a = $1 AND b = $2')
      expect(params).toEqual([1, 2])
    })
  })

  describe('complex queries', () => {
    it('should build complex where clause', () => {
      const builder = new ExpressionBuilder()
      builder
        .eq('status', 'active')
        .and()
        .gt('age', 18)
        .and()
        .group((g) => {
          g.like('name', '%John%').or().like('name', '%Jane%')
        })
        .and()
        .in('role', ['admin', 'user'])
        .and()
        .between('score', 80, 100)

      const { sql, params } = builder.build()
      expect(sql).toBe(
        'status = $1 AND age > $2 AND (name LIKE $3 OR name LIKE $4) AND role IN ($5, $6) AND score BETWEEN $7 AND $8'
      )
      expect(params).toEqual(['active', 18, '%John%', '%Jane%', 'admin', 'user', 80, 100])
    })
  })
})
