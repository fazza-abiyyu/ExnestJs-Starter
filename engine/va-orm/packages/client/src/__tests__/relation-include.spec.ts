// VA-ORM Relation Include & Filters Spec

import { describe, it, expect } from 'bun:test'
import { MockDriver } from '../../../../test-setup.js'
import type { ModelMeta } from '../core/types.js'
import { ModelDelegate } from '../repository/model.delegate.js'
import { buildWhere } from '../relation/filters.js'
import { JoinBuilder } from '../relation/join.builder.js'

function userModel(): ModelMeta {
  return {
    name: 'User',
    table: 'users',
    primaryKey: 'id',
    relations: new Map([
      ['posts', {
        field: 'posts', targetModel: 'Post', isList: true, kind: 'one-to-many',
        fkModel: 'Post', fkFields: ['userId'], pkModel: 'User', pkFields: ['id'],
        onDelete: 'Cascade', backField: 'author', isFkHolder: false,
      }],
      ['profile', {
        field: 'profile', targetModel: 'Profile', isList: false, kind: 'one-to-one',
        fkModel: 'Profile', fkFields: ['userId'], pkModel: 'User', pkFields: ['id'],
        backField: 'user', isFkHolder: false,
      }],
    ]),
  }
}

function postModel(): ModelMeta {
  return {
    name: 'Post',
    table: 'posts',
    primaryKey: 'id',
    relations: new Map([
      ['author', {
        field: 'author', targetModel: 'User', isList: false, kind: 'many-to-one',
        fkModel: 'Post', fkFields: ['userId'], pkModel: 'User', pkFields: ['id'],
        onDelete: 'Cascade', backField: 'posts', isFkHolder: true,
      }],
      ['tags', {
        field: 'tags', targetModel: 'Tag', isList: true, kind: 'many-to-many-implicit',
        fkModel: 'Post', fkFields: [], pkModel: 'Post', pkFields: ['id'],
        backField: 'posts', isFkHolder: false, joinTable: '_PostToTag',
      }],
    ]),
  }
}

function profileModel(): ModelMeta {
  return {
    name: 'Profile',
    table: 'profiles',
    primaryKey: 'id',
    relations: new Map([
      ['user', {
        field: 'user', targetModel: 'User', isList: false, kind: 'one-to-one',
        fkModel: 'Profile', fkFields: ['userId'], pkModel: 'User', pkFields: ['id'],
        backField: 'profile', isFkHolder: true,
      }],
    ]),
  }
}

function tagModel(): ModelMeta {
  return {
    name: 'Tag',
    table: 'tags',
    primaryKey: 'id',
    relations: new Map([
      ['posts', {
        field: 'posts', targetModel: 'Post', isList: true, kind: 'many-to-many-implicit',
        fkModel: 'Tag', fkFields: [], pkModel: 'Tag', pkFields: ['id'],
        backField: 'tags', isFkHolder: false, joinTable: '_PostToTag',
      }],
    ]),
  }
}

function registry(): Map<string, ModelMeta> {
  return new Map([
    ['User', userModel()],
    ['Post', postModel()],
    ['Profile', profileModel()],
    ['Tag', tagModel()],
  ])
}

describe('JoinBuilder', () => {
  it('should build one-to-many join condition', () => {
    const meta = userModel().relations.get('posts')!
    expect(JoinBuilder.joinCondition(meta, 'u', 'p')).toBe('"p"."userId" = "u"."id"')
  })

  it('should build many-to-one join condition', () => {
    const meta = postModel().relations.get('author')!
    expect(JoinBuilder.joinCondition(meta, 'p', 'u')).toBe('"p"."userId" = "u"."id"')
  })

  it('should build M:N join clauses', () => {
    const meta = postModel().relations.get('tags')!
    const clauses = JoinBuilder.joinClause({
      meta,
      parentTable: 'posts',
      parentAlias: 'p',
      parentModel: 'Post',
      childTable: 'tags',
      childAlias: 't',
      childModel: 'Tag',
    })
    expect(clauses).toHaveLength(2)
    expect(clauses[0]).toContain('_PostToTag')
    expect(clauses[1]).toContain('"tags" AS t')
  })
})

describe('ModelDelegate include', () => {
  it('should eager-load one-to-many relation', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }], rowCount: 2 })
    driver.setResult({ rows: [{ id: 10, userId: 1, title: 'A' }, { id: 11, userId: 1, title: 'B' }], rowCount: 2 })

    const users = new ModelDelegate(driver, userModel(), registry())
    const result = await users.findMany({ include: { posts: true } })

    expect(result).toHaveLength(2)
    expect(result[0].posts).toHaveLength(2)
    expect(result[1].posts).toHaveLength(0)

    const queries = driver.getQueries()
    expect(queries[0].sql).toBe('SELECT * FROM "users"')
    expect(queries[1].sql).toContain('FROM "posts"')
    expect(queries[1].sql).toContain('"userId" IN')
    expect(queries[1].params).toEqual([1, 2])
  })

  it('should eager-load many-to-one relation', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 10, userId: 1, title: 'A' }], rowCount: 1 })
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })

    const posts = new ModelDelegate(driver, postModel(), registry())
    const result = await posts.findMany({ include: { author: true } })

    expect(result[0].author).toEqual({ id: 1, name: 'John' })
    const queries = driver.getQueries()
    expect(queries[1].sql).toContain('FROM "users"')
    expect(queries[1].params).toEqual([1])
  })

  it('should eager-load nested include', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
    driver.setResult({ rows: [{ id: 10, userId: 1, title: 'A' }], rowCount: 1 })
    driver.setResult({
      rows: [{ id: 100, __parent_key: 10, name: 'tech' }],
      rowCount: 1,
    })

    const users = new ModelDelegate(driver, userModel(), registry())
    const result = await users.findMany({ include: { posts: { include: { tags: true } } } })

    expect(result[0].posts[0].tags).toEqual([{ id: 100, name: 'tech' }])
    expect(driver.getQueries()).toHaveLength(3)
  })

  it('should apply where/orderBy/take on included relation', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
    driver.setResult({ rows: [{ id: 10, userId: 1, title: 'A' }], rowCount: 1 })

    const users = new ModelDelegate(driver, userModel(), registry())
    await users.findMany({
      include: {
        posts: {
          where: { title: { contains: 'A' } },
          orderBy: { title: 'desc' },
          take: 5,
        },
      },
    })

    const queries = driver.getQueries()
    expect(queries[1].sql).toContain('LIKE')
    expect(queries[1].sql).toContain('ORDER BY "title" DESC')
    expect(queries[1].sql).toContain('LIMIT 5')
  })

  it('should throw for unknown relation', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1 }], rowCount: 1 })
    const users = new ModelDelegate(driver, userModel(), registry())
    await expect(users.findMany({ include: { nope: true } as any })).rejects.toThrow(
      'Relation "nope" is not defined on model "User"'
    )
  })
})

describe('buildWhere relation filters', () => {
  it('should translate scalar operators', () => {
    const reg = registry()
    const { sql, params } = buildWhere(
      {
        status: 'active',
        age: { gte: 18, lt: 65 },
        name: { contains: 'Jo' },
        role: { in: ['admin', 'mod'] },
        deletedAt: null,
      },
      userModel(),
      reg
    )
    expect(sql).toContain('"status" = $1')
    expect(sql).toContain('"age" < $2')
    expect(sql).toContain('"age" >= $3')
    expect(sql).toContain('"name" LIKE $4')
    expect(sql).toContain('"role" IN ($5, $6)')
    expect(sql).toContain('"deletedAt" IS NULL')
    expect(params).toEqual(['active', 65, 18, '%Jo%', 'admin', 'mod'])
  })

  it('should translate some filter to EXISTS', () => {
    const { sql, params } = buildWhere(
      { posts: { some: { title: 'Hello' } } },
      userModel(),
      registry()
    )
    expect(sql).toContain('EXISTS (SELECT 1 FROM "posts" AS __rel')
    expect(sql).toContain('"__rel"."userId" = "users"."id"')
    expect(sql).toContain('"title" = $1')
    expect(params).toEqual(['Hello'])
  })

  it('should translate none filter to NOT EXISTS', () => {
    const { sql } = buildWhere(
      { posts: { none: { title: 'Draft' } } },
      userModel(),
      registry()
    )
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM "posts" AS __rel')
  })

  it('should translate every filter', () => {
    const { sql } = buildWhere(
      { posts: { every: { title: 'Pub' } } },
      userModel(),
      registry()
    )
    expect(sql).toContain('NOT EXISTS')
    expect(sql).toContain('NOT (')
  })

  it('should translate is/isNot filters', () => {
    const isSql = buildWhere(
      { profile: { is: { bio: 'Hi' } } },
      userModel(),
      registry()
    ).sql
    expect(isSql).toContain('EXISTS (SELECT 1 FROM "profiles" AS __rel')

    const isNotSql = buildWhere(
      { profile: { isNot: { bio: 'Hi' } } },
      userModel(),
      registry()
    ).sql
    expect(isNotSql).toContain('NOT EXISTS')
  })

  it('should translate AND/OR/NOT groups', () => {
    const { sql } = buildWhere(
      {
        OR: [{ status: 'a' }, { status: 'b' }],
        NOT: { status: 'c' },
      },
      userModel(),
      registry()
    )
    expect(sql).toContain('OR')
    expect(sql).toContain('NOT (')
  })

  it('should use unique aliases for nested relation filters', () => {
    const reg = new Map<string, ModelMeta>([
      ['Department', {
        name: 'Department', table: 'departments', primaryKey: 'id',
        relations: new Map([['employees', {
          field: 'employees', targetModel: 'Employee', isList: true, kind: 'one-to-many',
          fkModel: 'Employee', fkFields: ['departmentId'], pkModel: 'Department', pkFields: ['id'],
          backField: 'department', isFkHolder: false,
        }]]),
      }],
      ['Employee', {
        name: 'Employee', table: 'employees', primaryKey: 'id',
        relations: new Map([
          ['department', {
            field: 'department', targetModel: 'Department', isList: false, kind: 'many-to-one',
            fkModel: 'Employee', fkFields: ['departmentId'], pkModel: 'Department', pkFields: ['id'],
            backField: 'employees', isFkHolder: true,
          }],
          ['authored', {
            field: 'authored', targetModel: 'Post', isList: true, kind: 'one-to-many',
            fkModel: 'Post', fkFields: ['authorId'], pkModel: 'Employee', pkFields: ['id'],
            backField: 'author', isFkHolder: false,
          }],
        ]),
      }],
      ['Post', {
        name: 'Post', table: 'posts', primaryKey: 'id',
        relations: new Map([['author', {
          field: 'author', targetModel: 'Employee', isList: false, kind: 'many-to-one',
          fkModel: 'Post', fkFields: ['authorId'], pkModel: 'Employee', pkFields: ['id'],
          backField: 'authored', isFkHolder: true,
        }]]),
      }],
    ])
    const { sql } = buildWhere(
      { employees: { some: { authored: { some: { title: 'Hi' } } } } },
      reg.get('Department')!,
      reg
    )
    expect(sql).toContain('AS __rel')
    expect(sql).toContain('AS __rel2')
    expect(sql).toContain('"__rel2"."authorId" = "__rel"."id"')
  })
})
